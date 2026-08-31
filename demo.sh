#!/usr/bin/env sh
set -eu

export NODE_ENV=development
export LLM_BASE_URL=
export LLM_MODEL=
export DATABASE_URL=postgresql://switchlane:switchlane@localhost:5434/switchlane_demo
export REDIS_URL=redis://localhost:6379/15

printf '%s\n' 'Starting PostgreSQL and Redis...'
docker compose up -d --wait postgres redis

printf '%s\n' 'Resetting isolated demo database...'
docker compose exec -T postgres psql -U switchlane -d postgres -c \
	'DROP DATABASE IF EXISTS switchlane_demo WITH (FORCE)'
docker compose exec -T postgres psql -U switchlane -d postgres -c \
	'CREATE DATABASE switchlane_demo'
docker compose exec -T redis redis-cli -n 15 FLUSHDB >/dev/null

printf '%s\n' 'Applying schema and migrations...'
npm run db:migrate

printf '%s\n' 'Seeding deterministic demo catalog...'
npm run demo:seed

printf '%s\n' 'Running production routing path without signup or external LLM calls...'
npm run demo:run
