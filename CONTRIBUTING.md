# Contributing to Switchlane

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/troailabs/switchlane.git
cd switchlane
npm install
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run dev
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run test` to ensure tests pass
4. Run `npm run test:integration` with PostgreSQL and Redis available
5. Run `npm run build` to check TypeScript compilation
6. Run `python -m pytest python/tests` for Python SDK changes
7. Submit a pull request

## Code Style

- TypeScript strict mode
- Use `zod` for runtime validation at system boundaries
- Keep functions focused — one responsibility per function
- No unnecessary abstractions

## Reporting Issues

- Use [GitHub Issues](https://github.com/troailabs/switchlane/issues)
- Include steps to reproduce, expected behavior, and actual behavior
- For security issues, email security@troialabs.ai instead of opening a public issue

## Pull Requests

- Keep PRs small and focused on a single change
- Include a clear description of what and why
- Update tests if behavior changes
- Update documentation if API surface changes

## License

By contributing, you agree that contributions to the server will be licensed
under the [GNU AGPL v3](LICENSE), while contributions contained entirely in
the TypeScript or Python SDKs will be licensed under the MIT License.
