# Switchlane Python SDK

A typed sync and async client for the Switchlane runtime routing API.

## Install

```bash
pip install switchlane
```

## Use

```python
from switchlane import Switchlane

with Switchlane("sl_live_...") as client:
    result = client.route("Review this pull request")
    if result.meta.abstained:
        print(result.meta.abstention_reason)
    else:
        print(result.recommendations[0].agent_id)
```

This package is an API client, not an agent framework. The SDK is MIT licensed; the Switchlane server is AGPL-3.0-only.
