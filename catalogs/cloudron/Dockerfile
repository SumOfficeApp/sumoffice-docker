# SumOffice for Cloudron: SumSheet + SumDoc + joint WOPI discovery + one-origin front in one container.
# Code lives in /app/code (read-only at runtime); all state lives in /app/data (Cloudron localstorage addon).
ARG SUMSHEET_IMAGE=hissih/sumsheet-webhost:latest
ARG SUMDOC_IMAGE=hissih/sumdoc-webhost:latest
FROM ${SUMSHEET_IMAGE} AS sumsheet
FROM ${SUMDOC_IMAGE} AS sumdoc

FROM cloudron/base:6.0.0@sha256:9bed4c8fa880645f8e669041ee28febe941481d00e9445e3e5a5483cb541d09b

RUN mkdir -p /app/code/sumsheet /app/code/sumdoc
COPY --from=sumsheet /app /app/code/sumsheet
COPY --from=sumdoc /app /app/code/sumdoc
COPY front.mjs start.sh /app/code/
RUN chmod +x /app/code/start.sh

# The editors run on the Node.js that ships with cloudron/base. If the webhost images need a specific Node
# major (native modules), copy it too, e.g.:
# COPY --from=sumsheet /usr/local/bin/node /app/code/node/bin/node   and put /app/code/node/bin first in PATH.

EXPOSE 8093
CMD [ "/app/code/start.sh" ]
