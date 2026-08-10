# BWE (Big Wheel of Excitement) - CKA Bootcamp PVC Demo
#
# Single-stage image: node:24-slim is glibc-based so better-sqlite3 can use its
# published prebuilt binary instead of compiling from source. If you're building
# in an air-gapped environment where the prebuild can't be downloaded, add a
# build stage with `apt-get install -y python3 make g++` before `npm ci`.
FROM node:24-slim

WORKDIR /app

# Install server dependencies first so this layer is cached across app-code changes.
COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev

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
