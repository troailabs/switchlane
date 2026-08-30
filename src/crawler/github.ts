import { config } from '../config.js';
import { query, transaction } from '../db/client.js';

interface GitHubRepo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  updated_at: string;
  topics: string[];
  owner: { login: string };
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubRepo[];
}

interface McpManifest {
  name?: string;
  description?: string;
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: object;
  }>;
}

const PER_PAGE = 30;
const DELAY_BETWEEN_REQUESTS_MS = 2000; // GitHub rate limit: 30 req/min with token

function slugify(fullName: string): string {
  return 'gh-' + fullName.toLowerCase().replace(/\//g, '-').replace(/[^a-z0-9-]/g, '');
}

async function githubFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Switchlane-Crawler/0.1',
  };
  if (config.GITHUB_TOKEN) {
    headers.Authorization = `token ${config.GITHUB_TOKEN}`;
  }
  return fetch(url, { headers });
}

async function searchRepos(query_str: string, page: number): Promise<GitHubSearchResponse> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query_str)}&sort=stars&order=desc&per_page=${PER_PAGE}&page=${page}`;
  const res = await githubFetch(url);
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error(`GitHub rate limited: ${res.status}`);
    }
    throw new Error(`GitHub search error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<GitHubSearchResponse>;
}

async function fetchMcpManifest(repo: GitHubRepo): Promise<McpManifest | null> {
  // Try fetching mcp.json from repo root
  const paths = ['mcp.json', 'mcp-manifest.json', 'package.json'];
  for (const path of paths) {
    const url = `https://raw.githubusercontent.com/${repo.full_name}/main/${path}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const content = await res.json() as any;
        // package.json: look for mcp config section
        if (path === 'package.json' && content.mcp) {
          return content.mcp as McpManifest;
        }
        if (path !== 'package.json') {
          return content as McpManifest;
        }
      }
    } catch {
      // skip
    }
  }
  return null;
}

function deriveTagsFromRepo(repo: GitHubRepo, manifest: McpManifest | null): string[] {
  const tags = new Set<string>();

  // From GitHub topics
  for (const topic of repo.topics) {
    if (topic !== 'mcp-server' && topic !== 'mcp' && topic.length > 2) {
      tags.add(topic.replace(/-/g, '_'));
    }
  }

  // From manifest tools
  if (manifest?.tools) {
    for (const tool of manifest.tools) {
      const parts = tool.name.toLowerCase().split(/[_\-./]/);
      for (const part of parts) {
        if (part.length > 2) tags.add(part);
      }
    }
  }

  // From description
  const desc = (repo.description || '').toLowerCase();
  const keywords = [
    'code', 'git', 'database', 'sql', 'api', 'web', 'search', 'file',
    'email', 'slack', 'docker', 'kubernetes', 'aws', 'security', 'testing',
    'monitoring', 'analytics', 'ai', 'ml', 'browser', 'scraping',
    'notion', 'jira', 'python', 'typescript', 'rust', 'go',
  ];
  for (const kw of keywords) {
    if (desc.includes(kw)) tags.add(kw);
  }

  return Array.from(tags).slice(0, 20);
}

async function upsertGitHubAgent(repo: GitHubRepo, manifest: McpManifest | null): Promise<void> {
  const agentId = slugify(repo.full_name);
  const name = manifest?.name || repo.name;
  const description = manifest?.description || repo.description || '';
  const tags = deriveTagsFromRepo(repo, manifest);
  const tools = manifest?.tools || [];

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO agents (id, name, description, provider, source_url, tags, last_crawled, status, use_count, crawl_source)
       VALUES ($1, $2, $3, 'mcp', $4, $5, NOW(), 'active', $6, 'github')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         source_url = EXCLUDED.source_url,
         tags = EXCLUDED.tags,
         last_crawled = NOW(),
         status = 'active',
         use_count = EXCLUDED.use_count,
         updated_at = NOW()`,
      [agentId, name, description, repo.html_url, tags, repo.stargazers_count]
    );

    // Replace tools
    await client.query('DELETE FROM tools WHERE agent_id = $1', [agentId]);
    for (const tool of tools) {
      await client.query(
        `INSERT INTO tools (agent_id, name, description, input_schema)
         VALUES ($1, $2, $3, $4)`,
        [agentId, tool.name, tool.description || '', JSON.stringify(tool.inputSchema || {})]
      );
    }
  });
}

export async function crawlGitHub(maxPages: number = 5): Promise<{ total: number; processed: number }> {
  if (!config.GITHUB_TOKEN) {
    console.warn('GITHUB_TOKEN not set — GitHub crawl will be rate-limited (10 req/min)');
  }

  console.log('Starting GitHub MCP server crawl...');

  const searches = [
    'topic:mcp-server',
    'topic:model-context-protocol',
    '"mcp.json" in:path filename:mcp.json',
  ];

  let totalProcessed = 0;
  let totalFound = 0;
  const seen = new Set<string>();

  for (const searchQuery of searches) {
    try {
      const firstPage = await searchRepos(searchQuery, 1);
      totalFound += firstPage.total_count;
      const pages = Math.min(maxPages, Math.ceil(firstPage.total_count / PER_PAGE));

      console.log(`  Query "${searchQuery}": ${firstPage.total_count} repos, crawling ${pages} pages`);

      for (let page = 1; page <= pages; page++) {
        const data = page === 1 ? firstPage : await searchRepos(searchQuery, page);

        for (const repo of data.items) {
          if (seen.has(repo.full_name)) continue;
          seen.add(repo.full_name);

          try {
            const manifest = await fetchMcpManifest(repo);
            await upsertGitHubAgent(repo, manifest);
            totalProcessed++;
          } catch (err) {
            console.warn(`  Failed to process ${repo.full_name}:`, err);
          }

          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));
        }

        console.log(`  Page ${page}/${pages} done (${totalProcessed} processed)`);
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));
      }
    } catch (err) {
      console.error(`  Search "${searchQuery}" failed:`, err);
    }
  }

  console.log(`GitHub crawl complete: ${totalProcessed} agents processed`);
  return { total: totalFound, processed: totalProcessed };
}

// CLI runner
if (process.argv[1]?.includes('github')) {
  const maxPages = process.argv[2] ? parseInt(process.argv[2]) : 3;
  crawlGitHub(maxPages)
    .then((result) => {
      console.log(`Done. ${result.processed} agents indexed from GitHub.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('GitHub crawl failed:', err);
      process.exit(1);
    });
}
