-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Agents table
CREATE TABLE agents (
  id TEXT PRIMARY KEY,                          -- unique slug e.g. "snyk-security-mcp"
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL CHECK (provider IN ('mcp', 'a2a', 'rest_api', 'manual')),
  source_url TEXT NOT NULL DEFAULT '',

  -- pricing
  pricing_model TEXT NOT NULL DEFAULT 'free' CHECK (pricing_model IN ('free', 'per_call', 'per_token', 'per_minute')),
  pricing_unit_cost_usd NUMERIC(10, 6),

  -- quality scores
  benchmark_score NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  usage_score NUMERIC(4, 3),
  combined_score NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  feedback_sample_count INTEGER NOT NULL DEFAULT 0,

  -- latency
  latency_p50_ms INTEGER,
  latency_p99_ms INTEGER,

  -- metadata
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'dead')),
  last_crawled TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tools table (per agent)
CREATE TABLE tools (
  id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  input_schema JSONB,
  output_schema JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tools_agent_id ON tools(agent_id);

-- Tool embeddings for vector search
CREATE TABLE tool_embeddings (
  id SERIAL PRIMARY KEY,
  tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,                        -- the text that was embedded
  embedding vector(384) NOT NULL               -- all-MiniLM-L6-v2 output dimension
);

CREATE INDEX idx_tool_embeddings_agent ON tool_embeddings(agent_id);
CREATE INDEX idx_tool_embeddings_vector ON tool_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Feedback table
CREATE TABLE feedback (
  id SERIAL PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  task_id TEXT,
  score NUMERIC(3, 2) NOT NULL CHECK (score >= 0 AND score <= 1),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_agent ON feedback(agent_id);

-- API keys table
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,                -- SHA-256 hash of the API key
  key_prefix TEXT NOT NULL,                     -- first 8 chars for identification
  owner_email TEXT,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'paid')),
  requests_this_month INTEGER NOT NULL DEFAULT 0,
  monthly_limit INTEGER NOT NULL DEFAULT 1000,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Route requests log (for analytics + billing)
CREATE TABLE route_logs (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER REFERENCES api_keys(id),
  task_text TEXT NOT NULL,
  task_profile JSONB,
  recommended_agents TEXT[],
  selected_agent_id TEXT,
  executed BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INTEGER,
  success BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_route_logs_created ON route_logs(created_at);
CREATE INDEX idx_route_logs_api_key ON route_logs(api_key_id);
