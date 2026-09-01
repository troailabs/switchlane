# Switchlane TypeScript SDK

A zero-dependency TypeScript client for the Switchlane runtime routing API.

Switchlane is a decision layer for multi-agent systems, not an agent marketplace or agent-building framework. It routes each task to an eligible agent or MCP-backed service and can abstain instead of returning a weak match.

## Install

```bash
npm install switchlane
```

## Connect

```typescript
import { Switchlane } from 'switchlane';

const client = new Switchlane({
  apiKey: 'sl_live_...',
  baseUrl: 'http://localhost:3001', // Your self-hosted or managed endpoint
});
```

## Route a task

```typescript
const result = await client.route('Review this pull request for security issues');

if (result.meta.abstained) {
  console.log('No suitable agent:', result.meta.abstention_reason);
} else {
  console.log(result.recommendations[0]);
}
```

## Set routing constraints

```typescript
const result = await client.route('Analyze this dataset', {
  constraints: {
    max_cost_usd: 0.05,
    max_latency_ms: 2_000,
    min_quality_score: 0.7,
    min_routing_confidence: 0.5,
  },
  limit: 3,
});
```

## Route and execute

Execution is opt-in and currently supports MCP endpoints. Treat third-party agents and MCP servers as untrusted infrastructure.

```typescript
const result = await client.execute(
  'Send the deployment result to Slack',
  { channel: '#engineering', message: 'Deployment succeeded' },
);

console.log(result.execution);
```

## Other methods

```typescript
await client.listAgents({ provider: 'mcp', limit: 20 });
await client.getAgent('agent-id');
await client.feedback({ agent_id: 'agent-id', score: 0.9 });
await client.taxonomy();
await client.usage();
```

## Errors

```typescript
import { SwitchlaneError } from 'switchlane';

try {
  await client.route('Example task');
} catch (error) {
  if (error instanceof SwitchlaneError) {
    console.error(error.status, error.message);
  }
}
```

## Links

- [Server and documentation](https://github.com/troailabs/switchlane)
- [OpenAPI specification](https://github.com/troailabs/switchlane/blob/main/openapi.yaml)
- [Issues](https://github.com/troailabs/switchlane/issues)

## License

MIT © Troia Labs. The Switchlane server is licensed separately under AGPL-3.0-only.
