# Builds and runs services/commerce-api from the monorepo root context
# (see infra/docker-compose.yml). Multi-stage: install + build in one
# layer, run the compiled output with only production dependencies.
FROM node:20-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY services/commerce-api/package.json services/commerce-api/package.json
RUN npm install

COPY packages ./packages
COPY services/commerce-api ./services/commerce-api

RUN npm run build --workspace=packages/shared \
  && npm run build --workspace=packages/config \
  && npm run db:generate --workspace=packages/db \
  && npm run build --workspace=packages/db \
  && npm run build --workspace=services/commerce-api

FROM node:20-alpine AS run
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/packages/config ./packages/config
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/services/commerce-api ./services/commerce-api

WORKDIR /repo/services/commerce-api
EXPOSE 4000
CMD ["node", "dist/index.js"]
