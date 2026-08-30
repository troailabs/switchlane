from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(extra="allow")


class RouteConstraints(Model):
    max_latency_ms: int | None = Field(default=None, gt=0)
    max_cost_usd: float | None = Field(default=None, gt=0)
    min_quality_score: float | None = Field(default=None, ge=0, le=1)
    quality_weight: float | None = Field(default=None, ge=0, le=1)
    cost_weight: float | None = Field(default=None, ge=0, le=1)
    latency_weight: float | None = Field(default=None, ge=0, le=1)
    min_routing_confidence: float | None = Field(default=None, ge=0, le=1)


class Recommendation(Model):
    agent_id: str
    provider: str
    quality_score: float
    estimated_cost_usd: float | None = None
    estimated_latency_ms: int | None = None
    match_reason: str
    endpoint: str


class ExecutionResult(Model):
    agent_id: str
    agent_name: str
    tool_used: str | None = None
    success: bool
    content: Any = None
    error: str | None = None
    latency_ms: int


class TaskProfile(Model):
    category: str
    subcategory: str | None = None
    language: str | None = None
    input_type: str | None = None
    output_type: str | None = None
    complexity: Literal["simple", "medium", "complex"]
    keywords: list[str] = Field(default_factory=list)


class RouteMeta(Model):
    match_path: str
    candidates_evaluated: int
    elapsed_ms: int
    abstained: bool
    abstention_reason: Literal[
        "no_candidates",
        "constraints_filtered_all_candidates",
        "top_candidate_below_confidence_threshold",
    ] | None = None
    confidence: float | None = None


class RouteResponse(Model):
    recommendations: list[Recommendation]
    execution: ExecutionResult | None = None
    task_profile: TaskProfile
    meta: RouteMeta


class Agent(Model):
    id: str
    name: str
    description: str
    provider: str
    tags: list[str]
    combined_score: float
    pricing_model: str
    status: str


class Pagination(Model):
    page: int
    limit: int
    total: int
    pages: int


class AgentListResponse(Model):
    agents: list[Agent]
    pagination: Pagination


class FeedbackResponse(Model):
    accepted: bool
    agent_id: str
    new_combined_score: float
    sample_count: int


class UsageResponse(Model):
    tier: str
    requests_this_month: int
    monthly_limit: int
    estimated_bill_usd: float
