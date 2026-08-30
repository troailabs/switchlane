-- Migration: Add multi-source crawl support, SLA probing, and verification tiers

-- Add crawl_source to agents (track where each agent came from)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS crawl_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (crawl_source IN ('github', 'npm', 'docker', 'manual'));

-- Add verification columns to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_tier TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_tier IN ('unverified', 'basic', 'verified', 'certified'));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- SLA probes table (historical probe data)
CREATE TABLE IF NOT EXISTS sla_probes (
  id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'dead')),
  error TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_probes_agent ON sla_probes(agent_id);
CREATE INDEX IF NOT EXISTS idx_sla_probes_checked ON sla_probes(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_sla_probes_agent_recent ON sla_probes(agent_id, checked_at DESC);

-- Index for verification tier filtering
CREATE INDEX IF NOT EXISTS idx_agents_verification ON agents(verification_tier);
CREATE INDEX IF NOT EXISTS idx_agents_crawl_source ON agents(crawl_source);

-- Cleanup: auto-delete old SLA probes (keep 90 days)
-- This should be run periodically via a cron job:
-- DELETE FROM sla_probes WHERE checked_at < NOW() - INTERVAL '90 days';
