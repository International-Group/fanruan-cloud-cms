FROM node:22.23.3-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

FROM dependencies AS build
ENV NODE_ENV=production STRAPI_TELEMETRY_DISABLED=true
ENV PUBLIC_URL=https://intl-cms.fanruan.com
ENV PORT=1337 NODE_PORT=1337
COPY . .
RUN node --test tests/*.test.js && npm run build
ARG RELEASE_ID
ARG SOURCE_REVISION
RUN RELEASE_ID="$RELEASE_ID" SOURCE_REVISION="$SOURCE_REVISION" node -e 'const fs=require("fs");if(!/^[a-f0-9]{40}-[0-9]+-[0-9]+$/.test(process.env.RELEASE_ID)||process.env.SOURCE_REVISION!==process.env.RELEASE_ID.slice(0,40))throw Error("Invalid release");fs.writeFileSync(".release.json",JSON.stringify({releaseId:process.env.RELEASE_ID,revision:process.env.SOURCE_REVISION}))'

FROM node:22.23.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production STRAPI_TELEMETRY_DISABLED=true
ENV PORT=1337 NODE_PORT=1337 HOST=127.0.0.1 APP_HOST=127.0.0.1
ARG RELEASE_ID
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source=https://github.com/International-Group/fanruan-cloud-cms \
      org.opencontainers.image.version=$RELEASE_ID \
      org.opencontainers.image.revision=$SOURCE_REVISION
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/.release.json ./
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/deploy/runtime ./deploy/runtime
COPY --from=build --chown=node:node /app/data ./data
RUN chown node:node /app
USER node
EXPOSE 1337
HEALTHCHECK --interval=30s --timeout=8s --start-period=180s --retries=3 CMD ["node", "deploy/runtime/healthcheck.cjs"]
CMD ["npm", "run", "start"]
