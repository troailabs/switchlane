import asyncio

import httpx
import pytest

from switchlane import AsyncSwitchlane, Switchlane, SwitchlaneError


ROUTE_RESPONSE = {
    "recommendations": [],
    "task_profile": {
        "category": "unknown",
        "subcategory": None,
        "language": None,
        "input_type": None,
        "output_type": None,
        "complexity": "medium",
        "keywords": [],
    },
    "meta": {
        "match_path": "llm_intent",
        "candidates_evaluated": 0,
        "elapsed_ms": 5,
        "abstained": True,
        "abstention_reason": "no_candidates",
        "confidence": None,
    },
}


def test_sync_route_parses_abstention_and_sends_auth() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer sl_live_test"
        assert request.url.path == "/v1/route"
        return httpx.Response(200, json=ROUTE_RESPONSE)

    with Switchlane("sl_live_test", base_url="https://example.test", transport=httpx.MockTransport(handler)) as client:
        result = client.route("unknown task")

    assert result.meta.abstained is True
    assert result.meta.abstention_reason == "no_candidates"


def test_sync_errors_include_status_and_body() -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(401, json={"error": "Invalid API key"}))
    with Switchlane("bad", base_url="https://example.test", transport=transport) as client:
        with pytest.raises(SwitchlaneError) as caught:
            client.usage()

    assert caught.value.status_code == 401
    assert caught.value.body == {"error": "Invalid API key"}


def test_async_route() -> None:
    async def run() -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/v1/route"
            return httpx.Response(200, json=ROUTE_RESPONSE)

        async with AsyncSwitchlane(
            "sl_live_test",
            base_url="https://example.test",
            transport=httpx.MockTransport(handler),
        ) as client:
            result = await client.route("unknown task")
        assert result.meta.confidence is None

    asyncio.run(run())
