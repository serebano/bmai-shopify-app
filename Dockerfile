# Busymate AI for Shopify — app server (Admin UI + /mcp connector + /identity + JWKS)
# Deployed as a systemd unit behind nginx at shopify.busymate.ai (fleet-uniform),
# or Fly.io/Vercel. See docs/ARCHITECTURE.md §Hosting.
FROM node:20-alpine AS base
ENV NODE_ENV=production
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && cp -R node_modules /prod_node_modules
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS release
COPY --from=deps /prod_node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json ./
COPY prisma ./prisma
EXPOSE 3000
# `prisma migrate deploy` runs on release (see .github/workflows/deploy.yml)
CMD ["npm", "run", "start"]
