import { query, transaction } from '../db/client.js';

interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string;
      version: string;
      description: string;
      keywords: string[];
      links: { npm: string; homepage?: string; repository?: string };
      publisher: { username: string };
      date: string;
    };
    score: {
      final: number;
      detail: { quality: number; popularity: number; maintenance: number };
    };
    downloads?: number;
  }>;
  total: number;
}

interface NpmPackageDetail {
  name: string;
  description: string;
  keywords: string[];
  repository?: { url: string };
  mcp?: {
    tools?: Array<{ name: string; description?: string; inputSchema?: object }>;
  };
}

const SEARCH_SIZE = 250;
const DELAY_MS = 1000;

function slugify(name: string): string {
  return 'npm-' + name.replace(/@/g, '').replace(/\//g, '-').replace(/[^a-z0-9-]/g, '');
}

async function searchNpm(text: string, offset: number = 0): Promise<NpmSearchResult> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=${SEARCH_SIZE}&from=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm search error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<NpmSearchResult>;
}

async function fetchPackageDetail(name: string): Promise<NpmPackageDetail | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json() as Promise<NpmPackageDetail>;
  } catch {
    return null;
  }
}

function deriveTagsFromPackage(pkg: NpmSearchResult['objects'][0]['package'], detail: NpmPackageDetail | null): string[] {
  const tags = new Set<string>();

  const keywords = detail?.keywords || pkg.keywords || [];
  for (const kw of keywords) {
    const normalized = kw.toLowerCase().replace(/-/g, '_');
    if (normalized !== 'mcp' && normalized !== 'mcp_server' && normalized.length > 2) {
      tags.add(normalized);
    }
  }

  // From description
  const desc = (pkg.description || '').toLowerCase();
  const knownTags = [
    'code', 'git', 'github', 'database', 'sql', 'api', 'web', 'search',
    'file', 'email', 'slack', 'docker', 'aws', 'security', 'testing',
    'browser', 'scraping', 'notion', 'jira', 'python', 'typescript',
  ];
  for (const kw of knownTags) {
    if (desc.includes(kw)) tags.add(kw);
  }

  return Array.from(tags).slice(0, 20);
}

async function upsertNpmAgent(
  pkg: NpmSearchResult['objects'][0],
  detail: NpmPackageDetail | null
): Promise<void> {
  const agentId = slugify(pkg.package.name);
  const tags = deriveTagsFromPackage(pkg.package, detail);
  const tools = detail?.mcp?.tools || [];
  const sourceUrl = pkg.package.links.repository || pkg.package.links.npm;
  // Use npm score popularity as proxy for use_count (0-1 → 0-10000 scale)
  const useCount = Math.round((pkg.score.detail.popularity || 0) * 10000);

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO agents (id, name, description, provider, source_url, tags, last_crawled, status, use_count, crawl_source)
       VALUES ($1, $2, $3, 'mcp', $4, $5, NOW(), 'active', $6, 'npm')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         source_url = EXCLUDED.source_url,
         tags = EXCLUDED.tags,
         last_crawled = NOW(),
         status = 'active',
         use_count = EXCLUDED.use_count,
         updated_at = NOW()`,
      [agentId, pkg.package.name, pkg.package.description || '', sourceUrl, tags, useCount]
    );

    // Replace tools if manifest found
    if (tools.length > 0) {
      await client.query('DELETE FROM tools WHERE agent_id = $1', [agentId]);
      for (const tool of tools) {
        await client.query(
          `INSERT INTO tools (agent_id, name, description, input_schema)
           VALUES ($1, $2, $3, $4)`,
          [agentId, tool.name, tool.description || '', JSON.stringify(tool.inputSchema || {})]
        );
      }
    }
  });
}

export async function crawlNpm(maxResults: number = 500): Promise<{ total: number; processed: number }> {
  console.log('Starting npm MCP package crawl...');

  const searches = [
    'keywords:mcp-server',
    'keywords:model-context-protocol',
    'mcp server',
  ];

  let totalProcessed = 0;
  let totalFound = 0;
  const seen = new Set<string>();

  for (const searchText of searches) {
    try {
      const data = await searchNpm(searchText);
      totalFound += data.total;
      console.log(`  Query "${searchText}": ${data.total} packages`);

      for (const obj of data.objects) {
        if (seen.has(obj.package.name)) continue;
        seen.add(obj.package.name);

        if (totalProcessed >= maxResults) break;

        try {
          const detail = await fetchPackageDetail(obj.package.name);
          await upsertNpmAgent(obj, detail);
          totalProcessed++;
        } catch (err) {
          console.warn(`  Failed to process ${obj.package.name}:`, err);
        }

        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    } catch (err) {
      console.error(`  npm search "${searchText}" failed:`, err);
    }
  }

  console.log(`npm crawl complete: ${totalProcessed} packages processed`);
  return { total: totalFound, processed: totalProcessed };
}

// CLI runner
if (process.argv[1]?.includes('npm')) {
  const maxResults = process.argv[2] ? parseInt(process.argv[2]) : 200;
  crawlNpm(maxResults)
    .then((result) => {
      console.log(`Done. ${result.processed} agents indexed from npm.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('npm crawl failed:', err);
      process.exit(1);
    });
}
