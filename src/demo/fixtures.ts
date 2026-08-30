export interface DemoAgent {
  id: string;
  name: string;
  description: string;
  tags: string[];
  tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  costUsd: number;
  latencyMs: number;
}

export interface BenchmarkCase {
  task: string;
  expectedAgentId: string | null;
}

export const DEMO_AGENTS: DemoAgent[] = [
  {
    id: 'demo-github-reviewer',
    name: 'GitHub Reviewer',
    description: 'Reviews pull requests and source code for correctness and maintainability.',
    tags: ['git', 'github', 'code', 'review', 'pull_request'],
    tool: {
      name: 'review_pull_request',
      description: 'Review a GitHub pull request and return prioritized code findings.',
      inputSchema: { type: 'object', properties: { repository: { type: 'string' }, pull_request: { type: 'number' } } },
    },
    costUsd: 0.01,
    latencyMs: 450,
  },
  {
    id: 'demo-security-scanner',
    name: 'Security Scanner',
    description: 'Scans source code for vulnerabilities, insecure dependencies, and leaked secrets.',
    tags: ['security', 'code', 'vulnerability', 'scan', 'audit'],
    tool: {
      name: 'scan_repository',
      description: 'Audit a code repository for SQL injection, XSS, secrets, and vulnerable dependencies.',
      inputSchema: { type: 'object', properties: { repository: { type: 'string' } } },
    },
    costUsd: 0.02,
    latencyMs: 700,
  },
  {
    id: 'demo-data-analyst',
    name: 'Data Analyst',
    description: 'Analyzes CSV datasets, computes metrics, and produces business reports.',
    tags: ['data_analysis', 'csv', 'analytics', 'report', 'sales'],
    tool: {
      name: 'analyze_csv',
      description: 'Analyze CSV data for trends, anomalies, forecasts, and summary statistics.',
      inputSchema: { type: 'object', properties: { csv_url: { type: 'string' } } },
    },
    costUsd: 0.015,
    latencyMs: 600,
  },
  {
    id: 'demo-web-researcher',
    name: 'Web Researcher',
    description: 'Searches the web and synthesizes cited research from multiple sources.',
    tags: ['search', 'web', 'research', 'browser'],
    tool: {
      name: 'research_web',
      description: 'Search the web for current information and return a cited research brief.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
    costUsd: 0.01,
    latencyMs: 500,
  },
  {
    id: 'demo-slack-messenger',
    name: 'Slack Messenger',
    description: 'Sends and manages messages in Slack workspaces and channels.',
    tags: ['slack', 'message', 'notification', 'communication'],
    tool: {
      name: 'send_slack_message',
      description: 'Send a message to a Slack channel.',
      inputSchema: { type: 'object', properties: { channel: { type: 'string' }, message: { type: 'string' } } },
    },
    costUsd: 0.001,
    latencyMs: 150,
  },
  {
    id: 'demo-email-writer',
    name: 'Email Writer',
    description: 'Drafts and sends professional emails with tone and audience controls.',
    tags: ['writing', 'email', 'message', 'draft'],
    tool: {
      name: 'draft_email',
      description: 'Draft a professional email for a recipient and purpose.',
      inputSchema: { type: 'object', properties: { recipient: { type: 'string' }, purpose: { type: 'string' } } },
    },
    costUsd: 0.003,
    latencyMs: 220,
  },
  {
    id: 'demo-kubernetes-deployer',
    name: 'Kubernetes Deployer',
    description: 'Deploys containerized applications to Kubernetes and configures autoscaling.',
    tags: ['devops', 'deploy', 'docker', 'kubernetes', 'container'],
    tool: {
      name: 'deploy_kubernetes',
      description: 'Deploy a Docker container to Kubernetes with health checks and autoscaling.',
      inputSchema: { type: 'object', properties: { image: { type: 'string' }, replicas: { type: 'number' } } },
    },
    costUsd: 0.025,
    latencyMs: 900,
  },
  {
    id: 'demo-math-solver',
    name: 'Math Solver',
    description: 'Solves arithmetic, algebra, statistics, and formula-based calculations.',
    tags: ['math', 'calculate', 'statistics', 'formula'],
    tool: {
      name: 'solve_math',
      description: 'Calculate a mathematical expression and explain the result.',
      inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
    },
    costUsd: 0.001,
    latencyMs: 100,
  },
];

export const BENCHMARK_CASES: BenchmarkCase[] = [
  { task: 'Review this GitHub pull request for correctness and maintainability', expectedAgentId: 'demo-github-reviewer' },
  { task: 'Scan this repository for SQL injection and leaked secrets', expectedAgentId: 'demo-security-scanner' },
  { task: 'Analyze this quarterly sales CSV and summarize revenue trends', expectedAgentId: 'demo-data-analyst' },
  { task: 'Research the latest browser automation tools and cite sources', expectedAgentId: 'demo-web-researcher' },
  { task: 'Send the deployment result to our Slack engineering channel', expectedAgentId: 'demo-slack-messenger' },
  { task: 'Draft a professional follow-up email to a prospective customer', expectedAgentId: 'demo-email-writer' },
  { task: 'Deploy this Docker image to Kubernetes with autoscaling', expectedAgentId: 'demo-kubernetes-deployer' },
  { task: 'Calculate compound interest for this principal and annual rate', expectedAgentId: 'demo-math-solver' },
  { task: 'Book a dental appointment near me for tomorrow morning', expectedAgentId: null },
  { task: 'Generate a photorealistic image of a mountain cabin', expectedAgentId: null },
];
