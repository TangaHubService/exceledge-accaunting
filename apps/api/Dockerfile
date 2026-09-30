# Accounting API — production image.
# Build context: repository root (so npm workspaces resolve).
# Dokploy: Dockerfile provider, Dockerfile path apps/api/Dockerfile.
FROM node:20-alpine AS build
RUN apk add --no-cache openssl libc6-compat python3 make g++
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json apps/api/
COPY apps/web/package*.json apps/web/
COPY packages/domain/package*.json packages/domain/
# packages/contracts is plain source (no package.json); copy it with the tree below.
RUN npm ci
COPY . .
RUN npm run build -w @exceledge/accounting-api

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
ENV PORT=4600
EXPOSE 4600
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "npm run prisma:deploy -w @exceledge/accounting-api && npm run start -w @exceledge/accounting-api"]
