# syntax=docker/dockerfile:1
#
# Two stages: build the iPad app (with openGym's lib copied in as src/og) and test it, then a
# small runtime with the zero-dependency server and the built files. The `opengym` build
# context is openGym's frontend/src/lib, given by docker-compose.yml.

FROM node:22-alpine AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY --from=opengym . ./src/og/
# The workout logic is tested against the openGym code it was just built with: an openGym
# update that changes what the kiosk relies on fails here, not on the wall.
RUN npm test && npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/ ./server/
RUN cd server && node --test
COPY --from=web /build/dist ./web/dist
ENV NODE_ENV=production PUBLIC_DIR=/app/web/dist DATA_DIR=/data PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8090/health || exit 1
CMD ["node", "server/server.js"]
