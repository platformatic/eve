FROM node:26-alpine

ENV APP_HOME=/home/app/node/
ENV PORT="3042"
ENV EVE_NEXT_PRODUCTION_PORT="4274"
ENV PLT_ICC_URL="http://icc.platformatic.svc.cluster.local"
ENV PLT_WORKFLOW="true"
ENV WORKFLOW_TARGET_WORLD="@platformatic/next-eve-world"
ENV PLT_WORLD_SERVICE_URL="http://workflow.platformatic.svc.cluster.local"
ENV PLT_WORLD_APP_ID="next-eve-platformatic-world"

RUN mkdir -p $APP_HOME/node_modules && chown -R node:node $APP_HOME
RUN npm install -g "pnpm@latest" "@platformatic/watt-extra@latest" "@datadog/pprof@5.15.1"

WORKDIR $APP_HOME
COPY ./ ./

RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm install
ARG NEXT_PUBLIC_BASE_PATH=/next-eve-platformatic-world
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm run build

ARG NEXT_EVE_BUILD_VERSION=local
ENV NEXT_EVE_BUILD_VERSION=$NEXT_EVE_BUILD_VERSION
ENV NODE_ENV="production"

EXPOSE 3042
EXPOSE 9090

CMD [ "node", "scripts/start-container.mjs" ]
