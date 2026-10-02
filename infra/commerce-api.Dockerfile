# Builds and runs services/commerce-api from the monorepo root context
# (see infra/docker-compose.yml). Multi-stage: install + build in one
# layer, run the compiled output with only production dependencies.
FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY services/commerce-api/package.json services/commerce-api/package.json
COPY apps/storefront/package.json apps/storefront/package.json
COPY apps/admin/package.json apps/admin/package.json
# Source is copied after installation; root postinstall builds cannot run yet.
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./

COPY packages ./packages
COPY services/commerce-api ./services/commerce-api

RUN npm run build --workspace=packages/shared \
  && npm run build --workspace=packages/config \
  && npm run db:generate --workspace=packages/db \
  && npm run build --workspace=packages/db \
  && npm run build --workspace=services/commerce-api \
  && npm prune --omit=dev --ignore-scripts

FROM node:20-alpine AS run
RUN apk add --no-cache openssl
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json ./package.json
COPY --from=build --chown=node:node /repo/packages/shared ./packages/shared
COPY --from=build --chown=node:node /repo/packages/config ./packages/config
COPY --from=build --chown=node:node /repo/packages/db ./packages/db
COPY --from=build --chown=node:node /repo/services/commerce-api ./services/commerce-api

WORKDIR /repo/services/commerce-api
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
