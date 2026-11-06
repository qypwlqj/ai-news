FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/miniapp/package.json apps/miniapp/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/apps/server/dist ./apps/server/dist
WORKDIR /app/apps/server
EXPOSE 3100
CMD ["node", "--env-file-if-exists=.env", "dist/server.mjs"]
