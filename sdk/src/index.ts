export interface RouteRequest {
  task: string;
  input?: Record<string, unknown>;
  constraints?: {
    max_latency_ms?: number;
    max_cost_usd?: number;
    min_quality_score?: number;
    quality_weight?: number;
    cost_weight?: number;
    latency_weight?: number;
    min_routing_confidence?: number;
  };
  execute?: boolean;
  limit?: number;
}

export interface Recommendation {
  agent_id: string;
  provider: string;
  quality_score: number;
  estimated_cost_usd: number | null;
  estimated_latency_ms: number | null;
  match_reason: string;
  endpoint: string;
}

export interface ExecutionResult {
  agent_id: string;
  agent_name: string;
  tool_used: string | null;
  success: boolean;
  content: unknown;
  error?: string;
  latency_ms: number;
}

export interface TaskProfile {
  category: string;
  subcategory: string | null;
  language: string | null;
  complexity: string;
}

export interface RouteResponse {
  recommendations: Recommendation[];
  execution?: ExecutionResult;
  task_profile: TaskProfile;
  meta: {
    match_path: string;
    candidates_evaluated: number;
    elapsed_ms: number;
    abstained: boolean;
    abstention_reason: 'no_candidates' | 'constraints_filtered_all_candidates' | 'top_candidate_below_confidence_threshold' | null;
    confidence: number | null;
  };
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  provider: string;
  tags: string[];
  combined_score: number;
  pricing_model: string;
  status: string;
}

export interface AgentDetail extends Agent {
  source_url: string;
  tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  quality: {
    benchmark_score: number;
    usage_score: number | null;
    combined_score: number;
    sample_count: number;
  };
}

export interface FeedbackRequest {
  agent_id: string;
  task_id?: string;
  score: number;
  comment?: string;
}

export interface SwitchlaneConfig {
  apiKey: string;
  baseUrl?: string;
}

export class Switchlane {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: SwitchlaneConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://router.troialabs.ai').replace(/\/$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new SwitchlaneError(res.status, (error as any).error || 'Request failed');
    }

    return res.json() as Promise<T>;
  }

  /** Route a task to the best agent */
  async route(task: string, options: Omit<RouteRequest, 'task'> = {}): Promise<RouteResponse> {
    return this.request<RouteResponse>('POST', '/v1/route', { task, ...options });
  }

  /** Route and execute — proxy the request through the best agent */
  async execute(task: string, input: Record<string, unknown> = {}, options: Omit<RouteRequest, 'task' | 'input' | 'execute'> = {}): Promise<RouteResponse> {
    return this.request<RouteResponse>('POST', '/v1/route', { task, input, execute: true, ...options });
  }

  /** List agents */
  async listAgents(params?: { page?: number; limit?: number; provider?: string; search?: string }): Promise<{ agents: Agent[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.provider) qs.set('provider', params.provider);
    if (params?.search) qs.set('search', params.search);
    const query = qs.toString();
    return this.request('GET', `/v1/agents${query ? '?' + query : ''}`);
  }

  /** Get agent details */
  async getAgent(id: string): Promise<AgentDetail> {
    return this.request('GET', `/v1/agents/${encodeURIComponent(id)}`);
  }

  /** Submit feedback */
  async feedback(feedback: FeedbackRequest): Promise<{ accepted: boolean; new_combined_score: number; sample_count: number }> {
    return this.request('POST', '/v1/feedback', feedback);
  }

  /** Get task taxonomy */
  async taxonomy(): Promise<{ tags: Array<{ tag: string; count: number }>; total_agents: number; total_tools: number }> {
    return this.request('GET', '/v1/tasks/taxonomy');
  }

  /** Get usage stats */
  async usage(): Promise<{ tier: string; requests_this_month: number; monthly_limit: number; estimated_bill_usd: number }> {
    return this.request('GET', '/v1/billing/usage');
  }
}

export class SwitchlaneError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SwitchlaneError';
    this.status = status;
  }
}

export default Switchlane;
