import { createClient } from 'redis';
import { createHash } from 'crypto';
import { config } from './config.js';

const redis = createClient({ url: config.REDIS_URL });
let connected = false;

async function getClient() {
  if (!connected) {
    await redis.connect();
    connected = true;
  }
  return redis;
}

redis.on('error', (err) => console.warn('Redis error:', err.message));

function hashKey(prefix: string, input: string): string {
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `sl:${prefix}:${hash}`;
}

export async function closeCache(): Promise<void> {
  if (connected) {
    await redis.quit();
    connected = false;
  }
}

/** Cache task profile — same task text → same classification. TTL: 1 hour */
export async function getCachedProfile(task: string): Promise<any | null> {
  try {
    const r = await getClient();
    const data = await r.get(hashKey('profile', task.toLowerCase().trim()));
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

export async function setCachedProfile(task: string, profile: any): Promise<void> {
  try {
    const r = await getClient();
    await r.set(hashKey('profile', task.toLowerCase().trim()), JSON.stringify(profile), { EX: 3600 });
  } catch {}
}

/** Cache rerank results — same task + same candidate set → same rerank. TTL: 30 min */
export async function getCachedRerank(task: string, candidateIds: string[]): Promise<Map<string, number> | null> {
  try {
    const r = await getClient();
    const cacheInput = task.toLowerCase().trim() + '|' + candidateIds.sort().join(',');
    const data = await r.get(hashKey('rerank', cacheInput));
    if (!data) return null;
    const entries = JSON.parse(data) as [string, number][];
    return new Map(entries);
  } catch { return null; }
}

export async function setCachedRerank(task: string, candidateIds: string[], scores: Map<string, number>): Promise<void> {
  try {
    const r = await getClient();
    const cacheInput = task.toLowerCase().trim() + '|' + candidateIds.sort().join(',');
    await r.set(hashKey('rerank', cacheInput), JSON.stringify([...scores.entries()]), { EX: 1800 });
  } catch {}
}

/** Cache embedding search results — same task text → same vectors. TTL: 15 min */
export async function getCachedEmbedding(task: string, suffix: string): Promise<any[] | null> {
  try {
    const r = await getClient();
    const data = await r.get(hashKey('emb' + suffix, task.toLowerCase().trim()));
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

export async function setCachedEmbedding(task: string, suffix: string, results: any[]): Promise<void> {
  try {
    const r = await getClient();
    await r.set(hashKey('emb' + suffix, task.toLowerCase().trim()), JSON.stringify(results), { EX: 900 });
  } catch {}
}
