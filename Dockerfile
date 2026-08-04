FROM node:26-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY src ./src
COPY index.html vite.config.js ./

RUN npm ci && npm run build

FROM ghcr.io/nginx/nginx-unprivileged:latest

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
