FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:22-alpine

RUN addgroup -S cortex && adduser -S cortex -G cortex

WORKDIR /opt/cortex

COPY --from=builder /app/node_modules ./node_modules
COPY cortex.js cortexd.js ./
COPY lib ./lib
COPY db ./db
COPY configs ./configs

RUN mkdir -p /var/lib/cortex /var/log/cortex && \
    chown -R cortex:cortex /var/lib/cortex /var/log/cortex /opt/cortex

USER cortex

ENV NODE_ENV=production
ENV CORTEX_CONFIG=/etc/cortex/cortex.env

EXPOSE 8777

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8777/v1/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "cortexd.js"]
