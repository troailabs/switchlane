import { query } from '../db/client.js';
import { isLlmAvailable, llmComplete } from '../llm/openai-compatible.js';

export interface TaskProfile {
  category: string;
  subcategory: string | null;
  language: string | null;
  input_type: string | null;
  output_type: string | null;
  complexity: 'simple' | 'medium' | 'complex';
}

export interface LlmMatch {
  agent_id: string;
  agent_name: string;
  agent_description: string;
  score: number;
  match_reason: string;
}

const SYSTEM_PROMPT = `You are a task classifier for an AI agent routing system. Given a user's task description, extract a structured profile.

Respond ONLY with valid JSON, no markdown:
{
  "category": "string - main task category (e.g. code_review, data_analysis, web_scraping, file_management, database, api_testing, security, devops, writing, search, social_media, math, translation, image_processing)",
  "subcategory": "string or null - specific subcategory",
  "language": "string or null - programming language if relevant",
  "input_type": "string or null - what the input is (source_code, url, text, image, data, etc)",
  "output_type": "string or null - what the output should be (report, code, data, text, etc)",
  "complexity": "simple | medium | complex",
  "keywords": ["array", "of", "relevant", "keywords", "for", "matching"]
}`;

/**
 * Path B: LLM Intent Mapping — extract a structured task profile through an
 * optional OpenAI-compatible endpoint.
 * Used when Path A (embedding match) doesn't find confident matches.
 */
export async function extractTaskProfile(taskText: string): Promise<TaskProfile & { keywords: string[] }> {
  if (!isLlmAvailable()) {
    // Fallback: return a basic profile from heuristic parsing
    return heuristicProfile(taskText);
  }

  try {
    const content = await llmComplete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: taskText },
      ],
      { temperature: 0.1, max_tokens: 300 }
    );

    if (!content) return heuristicProfile(taskText);

    const cleaned = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      category: parsed.category || 'unknown',
      subcategory: parsed.subcategory || null,
      language: parsed.language || null,
      input_type: parsed.input_type || null,
      output_type: parsed.output_type || null,
      complexity: parsed.complexity || 'medium',
      keywords: parsed.keywords || [],
    };
  } catch (err) {
    console.warn('LLM intent extraction failed:', err);
    return heuristicProfile(taskText);
  }
}

/**
 * Match a task profile against indexed agents using tag/keyword overlap.
 */
export async function matchByProfile(
  profile: TaskProfile & { keywords: string[] },
  limit: number = 10
): Promise<LlmMatch[]> {
  const searchTerms = [
    profile.category,
    profile.subcategory,
    profile.language,
    ...profile.keywords,
  ].filter(Boolean) as string[];

  if (searchTerms.length === 0) return [];

  // Build a query that scores agents by tag overlap + description match
  const searchPattern = searchTerms.map(t => t.replace(/[%_]/g, '')).join('|');
  const result = await query<{
    id: string;
    name: string;
    description: string;
    overlap: number;
    tag_count: number;
  }>(
    `SELECT
       a.id, a.name, a.description,
       (
         SELECT COUNT(*)::int FROM UNNEST(a.tags) tag
         WHERE tag = ANY($1)
       ) as overlap,
       array_length(a.tags, 1) as tag_count
     FROM agents a
     WHERE a.status = 'active'
       AND (a.tags && $1 OR a.description ~* $3)
     ORDER BY overlap DESC
     LIMIT $2`,
    [searchTerms, limit, searchPattern]
  );

  return result.rows.map((r) => ({
      agent_id: r.id,
      agent_name: r.name,
      agent_description: r.description,
      // Score: overlap ratio, minimum 0.1 for description-only matches
      score: Math.max(r.overlap / Math.max(searchTerms.length, 1), 0.1),
      match_reason: `LLM intent match: ${profile.category}${profile.subcategory ? '.' + profile.subcategory : ''} (${r.overlap} tag overlap)`,
    }));
}

/**
 * Heuristic fallback when no LLM API key is available.
 */
function heuristicProfile(taskText: string): TaskProfile & { keywords: string[] } {
  const lower = taskText.toLowerCase();
  const keywords: string[] = [];

  // Extract potential keywords
  const categoryMap: Record<string, string[]> = {
    security: ['security', 'vulnerability', 'injection', 'xss', 'secret', 'audit'],
    code_review: ['code', 'review', 'refactor', 'lint'],
    database: ['sql', 'database', 'query', 'postgres', 'mysql', 'mongodb'],
    web_scraping: ['scrape', 'crawl', 'extract', 'website', 'browser'],
    search: ['search', 'find', 'lookup', 'query'],
    file_management: ['file', 'directory', 'folder', 'read', 'write', 'move'],
    api_testing: ['api', 'endpoint', 'request', 'http', 'rest'],
    devops: ['deploy', 'docker', 'kubernetes', 'ci', 'cd', 'pipeline'],
    writing: ['write', 'draft', 'email', 'blog', 'content', 'summarize'],
    math: ['calculate', 'math', 'compute', 'formula', 'statistics'],
    social_media: ['twitter', 'reddit', 'instagram', 'post', 'social'],
    git: ['git', 'github', 'commit', 'branch', 'merge', 'pull request'],
  };

  let bestCategory = 'unknown';
  let bestScore = 0;

  for (const [cat, terms] of Object.entries(categoryMap)) {
    const score = terms.filter((t) => lower.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
    keywords.push(...terms.filter((t) => lower.includes(t)));
  }

  // Extract programming languages
  const langs = ['python', 'javascript', 'typescript', 'rust', 'go', 'java', 'ruby', 'php', 'c++', 'c#'];
  const detectedLang = langs.find((l) => lower.includes(l)) || null;

  return {
    category: bestCategory,
    subcategory: null,
    language: detectedLang,
    input_type: null,
    output_type: null,
    complexity: 'medium',
    keywords: [...new Set(keywords)],
  };
}

// ============================================================
// LLM Rerank — the big accuracy win
// ============================================================

const RERANK_SYSTEM_PROMPT = `You are an AI agent routing evaluator. Given a user's task and a list of candidate MCP agents, rate how well each agent can handle the task.

Respond ONLY with valid JSON — an array sorted by relevance (best first):
[{"id": "agent-id", "score": 0.95, "reason": "2 words why"}]

Scoring guide:
- 0.90-1.00: Agent is PURPOSE-BUILT for this exact task (e.g. Slack agent for "send Slack message")
- 0.70-0.89: Agent has strong relevant tools, good match
- 0.40-0.69: Partial relevance, could work but not ideal
- 0.10-0.39: Weak or tangential match
- 0.00-0.09: No relevance

Be strict. Most agents should score below 0.5. Only score 0.9+ for near-perfect matches.`;

export interface RerankResult {
  agent_id: string;
  score: number;
  reason: string;
}

/**
 * LLM Rerank: send top candidates to LLM with descriptions + tool names + popularity.
 * Returns rerank scores (0–1) per agent, sorted best-first.
 */
export async function rerankAgents(
  task: string,
  candidates: Array<{ id: string; name: string; description: string; tools: string[]; use_count: number }>
): Promise<RerankResult[]> {
  if (candidates.length === 0) return [];
  if (!isLlmAvailable()) return heuristicRerank(task, candidates);

  // Build candidate list for LLM
  const candidateLines = candidates.map((c, i) => {
    const toolStr = c.tools.slice(0, 5).join(', ') || 'no tools listed';
    const pop = c.use_count > 0 ? ` (${c.use_count.toLocaleString()} uses)` : '';
    return `${i + 1}. ${c.id}: ${c.name} — ${c.description.slice(0, 120)}${pop}\n   Tools: ${toolStr}`;
  }).join('\n');

  try {
    const content = await llmComplete(
      [
        { role: 'system', content: RERANK_SYSTEM_PROMPT },
        { role: 'user', content: `Task: "${task}"\n\nCandidates:\n${candidateLines}` },
      ],
      { temperature: 0.1, max_tokens: 800 }
    );

    if (!content) return heuristicRerank(task, candidates);

    // Strip markdown code fences if present
    const cleaned = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

    const parsed = JSON.parse(cleaned) as Array<{ id: string; score: number; reason?: string }>;
    return parsed
      .filter((r) => typeof r.id === 'string' && typeof r.score === 'number')
      .map((r) => ({
        agent_id: r.id,
        score: Math.max(0, Math.min(1, r.score)),
        reason: r.reason || '',
      }));
  } catch (err) {
    console.warn('LLM rerank failed, using heuristic:', err);
    return heuristicRerank(task, candidates);
  }
}

function heuristicRerank(
  task: string,
  candidates: Array<{ id: string; name: string; description: string; tools: string[]; use_count: number }>
): RerankResult[] {
  const taskLower = task.toLowerCase();
  const taskWords = taskLower.split(/\W+/).filter((w) => w.length > 2);

  return candidates
    .map((c) => {
      const text = `${c.id} ${c.name} ${c.description} ${c.tools.join(' ')}`.toLowerCase();
      const wordHits = taskWords.filter((w) => text.includes(w)).length;
      const score = Math.min(wordHits / Math.max(taskWords.length, 1), 1.0) * 0.7;
      return { agent_id: c.id, score, reason: 'heuristic' };
    })
    .sort((a, b) => b.score - a.score);
}
