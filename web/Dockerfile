FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:48789
ARG NEXT_PUBLIC_RUNTIME_ENV=production
ARG NEXT_PUBLIC_USE_MOCK=false
ARG NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK=false
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_RUNTIME_ENV=$NEXT_PUBLIC_RUNTIME_ENV
ENV NEXT_PUBLIC_USE_MOCK=$NEXT_PUBLIC_USE_MOCK
ENV NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK=$NEXT_PUBLIC_DASHBOARD_ALLOW_MOCK_FALLBACK
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/postcss.config.js ./postcss.config.js
COPY --from=build /app/tailwind.config.ts ./tailwind.config.ts
EXPOSE 3001
CMD ["npm", "run", "start", "--", "-p", "3001"]
