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

# Copy only what the app needs at runtime: the server code and seed data, plus
# the allowlisted frontend files (see PUBLIC_FILES in server/server.js). Tests,
# manifests, docs and CI config stay out of the image. Everything under /app
# stays owned by root, so the app process can't rewrite its own code.
COPY server/package.json server/server.js server/db.js ./server/
COPY server/seed ./server/seed
COPY index.html bwe-core.js bootstrap.js settings.js history.js settings.css history.css ./
COPY beer-glass.png beer-glass-v2.png center-logo.png vite.svg ./
COPY assets ./assets

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

# /data is where the PVC gets mounted in Kubernetes; pre-create it here too so
# `docker run` without a volume still works. It's the only writable path.
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.js"]
