# syntax=docker/dockerfile:1
# Pin NODE_IMAGE to a verified official digest before a reproducible release.
ARG NODE_IMAGE=node:26-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

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
