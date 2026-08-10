# BWE (Big Wheel of Excitement) - CKA Bootcamp PVC Demo
#
# Build native dependencies separately so Python and the compiler toolchain do
# not ship in the runtime image. better-sqlite3 does not publish a prebuild for
# every supported Node/Linux combination, so the build must be self-sufficient.
FROM node:24-slim AS dependencies

WORKDIR /app

# Install server dependencies first so this layer is cached across app-code changes.
COPY server/package.json server/package-lock.json ./server/
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm --prefix server ci --omit=dev

# Keep the production image slim and free of build tools.
FROM node:24-slim

WORKDIR /app

COPY --from=dependencies /app/server/node_modules ./server/node_modules

# Copy the rest of the repo: static frontend at /app, server code at /app/server.
# (server/node_modules and local data/ are excluded via .dockerignore.)
COPY . .

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

# /data is where the PVC gets mounted in Kubernetes; pre-create it here too so
# `docker run` without a volume still works, and hand it to the non-root user.
RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.js"]
