FROM cgr.dev/chainguard/node:latest-dev AS builder

USER root
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc
RUN npm prune --omit=dev

# --- Production stage ---
FROM cgr.dev/chainguard/node:latest

WORKDIR /app

ENV NODE_ENV=production
ENV HF_HOME=/tmp/huggingface

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql
COPY src/db/migrations ./dist/db/migrations

EXPOSE 3001

CMD ["dist/server.js"]
