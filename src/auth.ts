import { createMiddleware } from 'hono/factory';
import { createHash, randomBytes } from 'crypto';
import { query } from './db/client.js';

export interface ApiKeyInfo {
  id: number;
  key_prefix: string;
  owner_email: string | null;
  tier: 'free' | 'paid';
  requests_this_month: number;
  monthly_limit: number;
  stripe_customer_id: string | null;
}

/**
 * Generate a new API key. Returns the raw key (only shown once).
 */
export async function generateApiKey(ownerEmail?: string): Promise<{ key: string; prefix: string }> {
  const raw = `sl_live_${randomBytes(24).toString('hex')}`;
  const prefix = raw.slice(0, 16);
  const hash = createHash('sha256').update(raw).digest('hex');

  await query(
    `INSERT INTO api_keys (key_hash, key_prefix, owner_email) VALUES ($1, $2, $3)`,
    [hash, prefix, ownerEmail || null]
  );

  return { key: raw, prefix };
}

/**
 * Validate an API key and return its info.
 */
async function validateKey(rawKey: string): Promise<ApiKeyInfo | null> {
  const hash = createHash('sha256').update(rawKey).digest('hex');

  const result = await query<ApiKeyInfo>(
    `SELECT id, key_prefix, owner_email, tier, requests_this_month, monthly_limit, stripe_customer_id
     FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hash]
  );

  return result.rows[0] || null;
}

/**
 * Increment request counter for an API key.
 */
export async function incrementUsage(keyId: number): Promise<void> {
  await query(
    'UPDATE api_keys SET requests_this_month = requests_this_month + 1 WHERE id = $1',
    [keyId]
  );
}

/**
 * Auth middleware — extracts and validates API key from Authorization header.
 * Sets c.set('apiKey', info) on success.
 * 
 * In dev mode, allows requests without auth for testing.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Dev mode: allow unauthenticated requests
    if (process.env.NODE_ENV === 'development') {
      c.set('apiKey', null);
      return next();
    }
    return c.json({ error: 'Missing API key. Use Authorization: Bearer sl_live_xxx' }, 401);
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey.startsWith('sl_live_')) {
    return c.json({ error: 'Invalid API key format' }, 401);
  }

  const keyInfo = await validateKey(rawKey);
  if (!keyInfo) {
    return c.json({ error: 'Invalid or revoked API key' }, 401);
  }

  // Check rate limit
  if (keyInfo.requests_this_month >= keyInfo.monthly_limit && keyInfo.tier === 'free') {
    return c.json({
      error: 'Monthly rate limit exceeded',
      limit: keyInfo.monthly_limit,
      used: keyInfo.requests_this_month,
      upgrade_url: '/v1/billing/upgrade',
    }, 429);
  }

  c.set('apiKey', keyInfo);
  return next();
});
