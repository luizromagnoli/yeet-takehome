# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
RUN addgroup -g 10001 -S app \
 && adduser -u 10001 -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
