# Switchlane

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
- **MCP proxy** — optionally execute tasks through the best agent
- **Registry crawlers** — auto-discover agents from GitHub and npm
- **Trust layer** — SLA probing, health verification, stale agent detection
- **Feedback loop** — user feedback updates quality scores in real time
- **Stripe billing** — metered API key management out of the box

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL + Redis)

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

## Architecture

```
src/
├── server.ts              # Hono HTTP server
├── auth.ts                # API key authentication
├── config.ts              # Environment configuration
├── cache.ts               # Redis caching layer
├── crawler/               # Public-source crawlers (GitHub, npm)
├── db/                    # PostgreSQL + pgvector
├── llm/                   # LLM intent mapping (GitHub Copilot)
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
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://switchlane:switchlane@localhost:5434/switchlane` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `PORT` | HTTP server port | `3001` |
| `GITHUB_TOKEN` | GitHub token for LLM intent mapping | — |
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
npm run test          # Run tests
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The Switchlane server is licensed under [GNU AGPL v3](LICENSE). The TypeScript
SDK in [sdk/](sdk/) is licensed separately under the [MIT License](sdk/LICENSE).

Copyright © 2026 Troia Labs.
