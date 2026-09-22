FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS dependencies

ENV NODE_ENV=production
WORKDIR /app
COPY backend/src/package.json backend/src/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY backend/src/*.js backend/src/*.html backend/src/package.json backend/src/package-lock.json ./
COPY backend/src/config ./config
COPY frontend/artwork/backgrounds ./assets
COPY frontend/artwork/motion ./assets/motion
COPY frontend/artwork/interactive ./assets/scene-bundles
COPY frontend/artwork/audio ./audio-samples

RUN mkdir -p /var/lib/scene-access-gateway /opt/scene-access-gateway/extensions \
    && chown -R node:node /var/lib/scene-access-gateway /opt/scene-access-gateway

USER node
EXPOSE 8080 8082
CMD ["node", "server.js"]
