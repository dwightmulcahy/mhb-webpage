FROM node:26-alpine
WORKDIR /app
COPY server.js ./
COPY seed ./seed
COPY public ./public
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
# Build metadata (set by .github/workflows/docker-release.yml; "dev" for local builds)
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_DATE=
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA BUILD_DATE=$BUILD_DATE
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
