from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from .models import (
    AgentListResponse,
    FeedbackResponse,
    RouteConstraints,
    RouteResponse,
    UsageResponse,
)

DEFAULT_BASE_URL = "https://router.troialabs.ai"


class SwitchlaneError(Exception):
    def __init__(self, status_code: int, message: str, body: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _raise_for_status(response: httpx.Response) -> None:
    if response.is_success:
        return
    try:
        body = response.json()
    except ValueError:
        body = {"error": response.text or response.reason_phrase}
    message = body.get("error", response.reason_phrase) if isinstance(body, dict) else response.reason_phrase
    raise SwitchlaneError(response.status_code, str(message), body)


def _route_payload(
    task: str,
    *,
    input: Mapping[str, Any] | None,
    constraints: RouteConstraints | Mapping[str, Any] | None,
    execute: bool,
    limit: int,
) -> dict[str, Any]:
    constraint_data = constraints.model_dump(exclude_none=True) if isinstance(constraints, RouteConstraints) else constraints
    return {
        "task": task,
        "input": dict(input) if input is not None else None,
        "constraints": dict(constraint_data) if constraint_data is not None else None,
        "execute": execute,
        "limit": limit,
    }


class Switchlane:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=timeout,
            transport=transport,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Switchlane:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def route(
        self,
        task: str,
        *,
        input: Mapping[str, Any] | None = None,
        constraints: RouteConstraints | Mapping[str, Any] | None = None,
        execute: bool = False,
        limit: int = 5,
    ) -> RouteResponse:
        response = self._client.post(
            "/v1/route",
            json=_route_payload(task, input=input, constraints=constraints, execute=execute, limit=limit),
        )
        _raise_for_status(response)
        return RouteResponse.model_validate(response.json())

    def execute(
        self,
        task: str,
        input: Mapping[str, Any] | None = None,
        *,
        constraints: RouteConstraints | Mapping[str, Any] | None = None,
        limit: int = 5,
    ) -> RouteResponse:
        return self.route(task, input=input, constraints=constraints, execute=True, limit=limit)

    def list_agents(self, **params: Any) -> AgentListResponse:
        response = self._client.get("/v1/agents", params={key: value for key, value in params.items() if value is not None})
        _raise_for_status(response)
        return AgentListResponse.model_validate(response.json())

    def feedback(self, agent_id: str, score: float, *, task_id: str | None = None, comment: str | None = None) -> FeedbackResponse:
        response = self._client.post(
            "/v1/feedback",
            json={"agent_id": agent_id, "score": score, "task_id": task_id, "comment": comment},
        )
        _raise_for_status(response)
        return FeedbackResponse.model_validate(response.json())

    def usage(self) -> UsageResponse:
        response = self._client.get("/v1/billing/usage")
        _raise_for_status(response)
        return UsageResponse.model_validate(response.json())


class AsyncSwitchlane:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout,
            transport=transport,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> AsyncSwitchlane:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def route(
        self,
        task: str,
        *,
        input: Mapping[str, Any] | None = None,
        constraints: RouteConstraints | Mapping[str, Any] | None = None,
        execute: bool = False,
        limit: int = 5,
    ) -> RouteResponse:
        response = await self._client.post(
            "/v1/route",
            json=_route_payload(task, input=input, constraints=constraints, execute=execute, limit=limit),
        )
        _raise_for_status(response)
        return RouteResponse.model_validate(response.json())

    async def execute(
        self,
        task: str,
        input: Mapping[str, Any] | None = None,
        *,
        constraints: RouteConstraints | Mapping[str, Any] | None = None,
        limit: int = 5,
    ) -> RouteResponse:
        return await self.route(task, input=input, constraints=constraints, execute=True, limit=limit)

    async def list_agents(self, **params: Any) -> AgentListResponse:
        response = await self._client.get("/v1/agents", params={key: value for key, value in params.items() if value is not None})
        _raise_for_status(response)
        return AgentListResponse.model_validate(response.json())

    async def feedback(self, agent_id: str, score: float, *, task_id: str | None = None, comment: str | None = None) -> FeedbackResponse:
        response = await self._client.post(
            "/v1/feedback",
            json={"agent_id": agent_id, "score": score, "task_id": task_id, "comment": comment},
        )
        _raise_for_status(response)
        return FeedbackResponse.model_validate(response.json())

    async def usage(self) -> UsageResponse:
        response = await self._client.get("/v1/billing/usage")
        _raise_for_status(response)
        return UsageResponse.model_validate(response.json())
