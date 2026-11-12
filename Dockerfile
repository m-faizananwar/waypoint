# Build stage: install everything, generate the Prisma client, compile TypeScript.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx nest build && npm prune --omit=dev

# Runtime stage: production dependencies and compiled output only, as a non-root user.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
USER node
EXPOSE 3000
# Apply pending migrations (prisma is a runtime dependency for this), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
