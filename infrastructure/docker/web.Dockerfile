# Builds one of the web apps (customer | vendor | admin) and serves it with nginx.
FROM node:22-alpine AS build
ARG APP=customer
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --no-audit --no-fund
RUN npm run build -w @vc/${APP}

FROM nginx:1.27-alpine
ARG APP=customer
COPY infrastructure/docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
EXPOSE 80
