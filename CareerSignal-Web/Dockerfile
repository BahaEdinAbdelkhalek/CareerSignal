FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/server.mjs ./server.mjs
COPY --from=build --chown=node:node /app/worker.mjs ./worker.mjs
COPY --from=build --chown=node:node /app/dist/careersignal/browser ./dist/careersignal/browser
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
