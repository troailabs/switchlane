# Switchlane

[![CI](https://github.com/troailabs/switchlane/actions/workflows/ci.yml/badge.svg)](https://github.com/troailabs/switchlane/actions/workflows/ci.yml)

**Runtime routing for multi-agent systems** — send a task, select the best eligible agent.

Switchlane is an open-source decision layer that matches tasks to eligible AI agents and MCP-backed services at runtime. It ranks candidates by task fit, quality, cost, and latency, then returns recommendations or delegates execution.

**Switchlane is not an agent marketplace or agent-building framework.** Registries answer “which agents exist?” Switchlane answers “which eligible agent should handle this request now?”

```
Task → Schema Match (pgvector) → Rank → Response
              ↓ miss
       LLM Intent Mapping → Rank → Response
                               ↓
                       execute=true? → MCP Proxy → Response
```

## Features

- **Semantic routing** — pgvector cosine similarity over tool schemas and descriptions
- **LLM fallback** — intent mapping when embeddings don't match
- **Bayesian scoring** — multi-factor ranking: quality × cost × latency
- **Safe abstention** — returns no match instead of promoting an unrelated agent
- **MCP proxy** — optionally execute tasks through the best agent
- **Registry crawlers** — auto-discover agents from GitHub and npm
- **Trust layer** — SLA probing, health verification, stale agent detection
- **Feedback loop** — user feedback updates quality scores in real time
- **Stripe billing** — metered API key management out of the box

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL + Redis)

### Run the deterministic demo

No signup, API key, registry crawl, or external LLM is required:

```bash
git clone https://github.com/troailabs/switchlane.git
cd switchlane
npm run demo
```

The demo builds an isolated Docker stack, applies migrations, seeds eight purpose-built candidates, and routes ten fixed tasks through the same API path used by the server. Two unsupported tasks demonstrate abstention. It publishes no host ports and removes its temporary containers, network, and data automatically.

### Setup

```bash
# Clone
git clone https://github.com/troailabs/switchlane.git
cd switchlane

# Start PostgreSQL (pgvector) and Redis
docker compose up -d

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Run database migrations
npm run db:migrate

# Crawl public sources (populates the database)
npm run crawl:github
npm run crawl:npm

# Start the server
npm run dev
```

The server starts at `http://localhost:3001` by default.

### First Request

```bash
# Register for an API key
curl -s http://localhost:3001/v1/billing/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}' | jq

# Route a task
curl -s http://localhost:3001/v1/route \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"task": "scan this repository for security vulnerabilities"}' | jq
```

## SDK

### TypeScript

```bash
npm install switchlane
```

```typescript
import { Switchlane } from 'switchlane';

const client = new Switchlane({ apiKey: 'sl_live_...' });

// Get recommendations
const result = await client.route('convert this CSV to JSON');
console.log(result.recommendations);

// Route and execute
const executed = await client.execute(
  'scan for security vulnerabilities',
  { repo_url: 'https://github.com/org/repo' }
);
console.log(executed.execution);
```

### Python

```bash
pip install switchlane
```

```python
from switchlane import Switchlane

with Switchlane("sl_live_...") as client:
  result = client.route("review this pull request")
  if result.meta.abstained:
    print(result.meta.abstention_reason)
  else:
    print(result.recommendations[0].agent_id)
```

Both SDKs are thin API clients. Switchlane is not an agent framework.

## Reproducible Benchmark

Run after `npm run demo`:

```bash
npm run benchmark
```

The bundled synthetic benchmark contains eight supported tasks and two deliberately unsupported tasks. It uses no external LLM and compares a token-overlap baseline with the production routing path.

| Router | Correct decisions | Accuracy |
|--------|-------------------|----------|
| Lexical baseline | 9/10 | 90% |
| Switchlane | 10/10 | 100% |

This is a deterministic smoke benchmark, not evidence of production accuracy. Its purpose is to make ranking and abstention behavior reproducible. Real-world evaluation against supervisor-LLM routing remains future validation work.

## API

| Endpoint | Description |
|----------|-------------|
| `POST /v1/route` | Route a task → ranked recommendations (or execute) |
| `GET /v1/agents` | List agents with filtering and pagination |
| `GET /v1/agents/:id` | Agent details + tools |
| `GET /v1/agents/:id/benchmark` | Quality score history |
| `POST /v1/feedback` | Submit feedback (updates Bayesian scores) |
| `GET /v1/tasks/taxonomy` | Emergent category tree |
| `POST /v1/billing/register` | Get an API key |
| `POST /v1/billing/upgrade` | Stripe checkout for paid tier |
| `GET /v1/billing/usage` | Usage stats |

Full API spec: [openapi.yaml](openapi.yaml)

When no candidate clears the default confidence threshold (`0.35`), `meta.abstained` is `true` and `recommendations` is empty. Set `constraints.min_routing_confidence` to define a stricter or looser policy per request.

## Architecture

```
src/
├── server.ts              # Hono HTTP server
├── auth.ts                # API key authentication
├── config.ts              # Environment configuration
├── cache.ts               # Redis caching layer
├── crawler/               # Public-source crawlers (GitHub, npm)
├── db/                    # PostgreSQL + pgvector
├── llm/                   # Optional OpenAI-compatible intent mapping
├── mapper/                # Task → agent matching
│   ├── schema-match.ts    # Path A: pgvector cosine similarity
│   ├── llm-intent.ts      # Path B: LLM-based intent mapping
│   └── embeddings.ts      # Embedding generation (bge-small-en-v1.5)
├── proxy/                 # MCP protocol proxy
├── routes/                # API route handlers
├── scorer/                # Bayesian quality scoring + ranking
├── trust/                 # SLA probing + health verification
└── billing/               # Stripe metered billing
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | TypeScript, Hono, Node.js |
| Database | PostgreSQL + pgvector |
| Cache | Redis |
| Embeddings | bge-small-en-v1.5 (@huggingface/transformers) |
| MCP Proxy | @modelcontextprotocol/sdk |
| Billing | Stripe metered billing |

## Configuration

See [.env.example](.env.example) for all available environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_PORT` | PostgreSQL host port used by the development Compose stack | `5434` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://switchlane:switchlane@localhost:5434/switchlane` |
| `REDIS_PORT` | Redis host port used by the development Compose stack | `6379` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `PORT` | HTTP server port | `3001` |
| `LLM_BASE_URL` | Optional OpenAI-compatible API base URL, including `/v1` | — |
| `LLM_API_KEY` | Optional bearer token for the configured LLM endpoint | — |
| `LLM_MODEL` | Model used for intent extraction and reranking | — |
| `LLM_TIMEOUT_MS` | LLM request timeout | `15000` |
| `GITHUB_TOKEN` | Optional token for the GitHub crawler | — |
| `STRIPE_SECRET_KEY` | Stripe secret key for billing | — |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | — |

## Scripts

```bash
npm run dev           # Start dev server with hot reload
npm run build         # Compile TypeScript
npm run start         # Run compiled server
npm run db:migrate    # Run database migrations
npm run crawl:github  # Crawl GitHub MCP servers
npm run crawl:npm     # Crawl npm MCP packages
npm run sla:probe     # Run SLA health probes
npm run verify        # Verify agent health
npm run demo          # Seed and run the signup-free deterministic demo
npm run benchmark     # Compare lexical and Switchlane routing on fixed cases
npm run test          # Run unit tests
npm run test:integration # Run database-backed API tests
npm run test:all      # Run unit and integration tests
```

## Security Boundary

Recommendation mode is the default. Execution is opt-in (`execute: true`) and currently supports MCP endpoints. Treat third-party agents and MCP servers as untrusted infrastructure; review their permissions and credential access before enabling execution.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The Switchlane server is licensed under [GNU AGPL v3](LICENSE). The TypeScript
SDK in [sdk/](sdk/) and Python SDK in [python/](python/) are licensed separately
under the MIT License.

Copyright © 2026 Troia Labs.
