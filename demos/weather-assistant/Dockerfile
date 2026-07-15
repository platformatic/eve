FROM node:26-alpine

ENV APP_HOME=/home/app/node/
ENV PLT_BASE_PATH="/workflow-demo"
ENV PLT_ICC_URL="http://icc.platformatic.svc.cluster.local"
ENV PLT_WORKFLOW="true"
ENV WORKFLOW_TARGET_WORLD="./world.mjs"
ENV PLT_WORLD_SERVICE_URL="http://workflow.platformatic.svc.cluster.local"

RUN apk add --no-cache gcc g++ make python3
RUN mkdir -p $APP_HOME/node_modules && chown -R node:node $APP_HOME
RUN npm install -g "pnpm@latest" "@platformatic/watt-extra@latest" "@datadog/pprof@5.15.1"

WORKDIR $APP_HOME

COPY ./ ./

# TODO: remove npmrc secret mount when all packages are public
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm install

EXPOSE 3042
EXPOSE 9090

# TODO: remove npmrc secret mount when all packages are public
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm run build

CMD [ "watt-extra", "start" ]
