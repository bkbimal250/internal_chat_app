FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS tooling
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY --chown=node:node . .
USER node
CMD ["npm", "run", "dev"]

FROM base AS runtime
ARG GIT_SHA=unknown
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/live',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
