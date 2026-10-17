FROM node:24-alpine AS build
RUN apk add --no-cache openssl libc6-compat python3 make g++
WORKDIR /app
COPY package*.json ./
COPY packages/domain/package*.json packages/domain/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/packages ./packages
ENV PORT=4600
EXPOSE 4600
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
