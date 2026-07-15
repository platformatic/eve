FROM node:26-alpine

ENV APP_HOME=/home/app/node/
ENV PLT_BASE_PATH="/workflow-demo"
ENV PORT="3042"
ENV PLT_ICC_URL="http://icc.platformatic.svc.cluster.local"
ENV PLT_WORKFLOW="true"
ENV WORKFLOW_TARGET_WORLD="./world.mjs"
ENV PLT_WORLD_SERVICE_URL="http://workflow.platformatic.svc.cluster.local"
ENV WORKFLOW_TURBO="0"
ENV WORKFLOW_MAX_INLINE_STEPS="1"
ENV WORKFLOW_OPTIMISTIC_INLINE_START="0"

RUN mkdir -p $APP_HOME/node_modules && chown -R node:node $APP_HOME
RUN npm install -g "pnpm@latest" "@platformatic/watt-extra@latest" "@datadog/pprof@5.15.1"

WORKDIR $APP_HOME

# The orchestrator builds a narrow context that preserves file:../.. for @platformatic/eve.
COPY eve-package/package.json /home/package.json
COPY eve-package/dist /home/dist
COPY eve-package/LICENSE /home/LICENSE
COPY eve-package/README.md /home/README.md
COPY app/ ./

RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm install

EXPOSE 3042
EXPOSE 9090

RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm run build

ARG SKEW_BUILD_VERSION=local
ENV SKEW_BUILD_VERSION=$SKEW_BUILD_VERSION

CMD [ "node", "/usr/local/lib/node_modules/@platformatic/watt-extra/cli.js", "start" ]
