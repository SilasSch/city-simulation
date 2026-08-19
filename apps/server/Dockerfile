FROM node:24-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY nx.json tsconfig.base.json eslint.config.mjs ./
COPY apps/server apps/server
COPY libs libs
RUN pnpm nx build server

# This target intentionally retains the Prisma CLI and migration files. Compose
# runs it once before the application starts, so schema changes never race the
# server process.
FROM build AS migration
ENV NODE_ENV=production
CMD ["pnpm", "exec", "prisma", "migrate", "deploy", "--schema", "apps/server/prisma/schema.prisma"]

FROM build AS production-dependencies
RUN pnpm prune --prod

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV SERVER_PORT=3000
WORKDIR /app

RUN addgroup --system --gid 1001 city && adduser --system --uid 1001 --ingroup city city
COPY --from=production-dependencies --chown=city:city /workspace/node_modules ./node_modules
COPY --from=build --chown=city:city /workspace/dist/apps/server ./dist

USER city
EXPOSE 3000
CMD ["node", "dist/main.js"]
