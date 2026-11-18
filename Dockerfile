FROM node:24-alpine AS build
WORKDIR /app

# Install build and runtime dependencies inside the container build.
# The repository lockfile is incomplete, so use npm install rather than npm ci.
COPY package.json package-lock.json ./
RUN npm install --include=dev --no-audit --no-fund

# Build the browser-side Vercel Blob uploader so production never serves the stub.
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-alpine
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
