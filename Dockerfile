# build the static files
FROM node:24.22.2-alpine AS build

WORKDIR /netoviz2
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# serve the static files under /netoviz2/ (api-proxy forwards /netoviz2/ to this container)
FROM nginx:1.30.6-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /netoviz2/dist /usr/share/nginx/html/netoviz2

EXPOSE 80
