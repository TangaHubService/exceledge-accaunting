FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/domain/package*.json packages/domain/
RUN npm ci
COPY . .
ARG VITE_ERP_URL=
ARG VITE_ERP_API_URL=
ARG VITE_ACCOUNTING_API_URL=
ENV VITE_ERP_URL=$VITE_ERP_URL \
    VITE_ERP_API_URL=$VITE_ERP_API_URL \
    VITE_ACCOUNTING_API_URL=$VITE_ACCOUNTING_API_URL
RUN npm run build

FROM caddy:2-alpine AS runtime
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
