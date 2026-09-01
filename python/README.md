# Switchlane Python SDK

A typed sync and async client for the Switchlane runtime routing API.

Switchlane is a decision layer for multi-agent systems, not an agent marketplace or agent-building framework. It routes each task to an eligible agent or MCP-backed service and can abstain instead of returning a weak match.

## Install

```bash
pip install switchlane
```

## Connect

```python
from switchlane import Switchlane

client = Switchlane(
    "sl_live_...",
    base_url="http://localhost:3001",  # Your self-hosted or managed endpoint
)
```

The following sync examples reuse this client. Call `client.close()` when your application shuts down, or use `Switchlane` as a context manager.

## Route a task

```python
result = client.route("Review this pull request")
if result.meta.abstained:
    print("No suitable agent:", result.meta.abstention_reason)
else:
    print(result.recommendations[0])
```

## Set routing constraints

```python
from switchlane import RouteConstraints

result = client.route(
    "Analyze this dataset",
    constraints=RouteConstraints(
        max_cost_usd=0.05,
        max_latency_ms=2_000,
        min_quality_score=0.7,
        min_routing_confidence=0.5,
    ),
    limit=3,
)
```

## Async client

```python
import asyncio
from switchlane import AsyncSwitchlane

async def main() -> None:
    async with AsyncSwitchlane(
        "sl_live_...",
        base_url="http://localhost:3001",
    ) as client:
        result = await client.route("Research current browser automation tools")
        print(result.meta)

asyncio.run(main())
```

## Route and execute

Execution is opt-in and currently supports MCP endpoints. Treat third-party agents and MCP servers as untrusted infrastructure.

```python
result = client.execute(
    "Send the deployment result to Slack",
    {"channel": "#engineering", "message": "Deployment succeeded"},
)
print(result.execution)
```

## Errors

```python
from switchlane import SwitchlaneError

try:
    client.route("Example task")
except SwitchlaneError as error:
    print(error.status_code, error, error.body)
```

## Links

- [Server and documentation](https://github.com/troailabs/switchlane)
- [OpenAPI specification](https://github.com/troailabs/switchlane/blob/main/openapi.yaml)
- [Issues](https://github.com/troailabs/switchlane/issues)

## License

MIT © Troia Labs. The Switchlane server is licensed separately under AGPL-3.0-only.
