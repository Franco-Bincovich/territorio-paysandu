# syntax=docker/dockerfile:1
# Official multi-platform manifest verified for this delivery.
ARG NODE_IMAGE=node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# Build-only limits: do not spawn a worker per visible host CPU in small VMs.
RUN NODE_OPTIONS=--max-old-space-size=768 \
    CIRCLE_NODE_TOTAL=1 \
    RAYON_NUM_THREADS=2 \
    npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupadd --system --gid 1001 nextjs \
    && useradd --system --uid 1001 --gid nextjs --no-create-home nextjs
COPY --from=builder --chown=nextjs:nextjs /app/Frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/Frontend/.next/static ./Frontend/.next/static
COPY --from=builder --chown=nextjs:nextjs /app/Frontend/public ./Frontend/public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const h=require('node:http');const r=h.get('http://127.0.0.1:3000/',x=>{x.resume();process.exit(x.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(4000,()=>{r.destroy();process.exit(1)})"
CMD ["node", "Frontend/server.js"]
