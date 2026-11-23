FROM node:26-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git gh ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY prototypes/upstream-port/package*.json ./prototypes/upstream-port/
RUN npm ci --prefix prototypes/upstream-port --omit=dev --ignore-scripts --no-audit --no-fund
COPY deploy/render/package*.json ./deploy/render/
RUN npm ci --prefix deploy/render --omit=dev --ignore-scripts --no-audit --no-fund
COPY vendor/mattskills-1.8.0-rc.7 ./vendor/mattskills-1.8.0-rc.7
COPY prototypes/upstream-port ./prototypes/upstream-port
COPY deploy/render ./deploy/render
USER node
ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["node", "deploy/render/server.mjs"]
