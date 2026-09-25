# SumOffice in one image (for Nextcloud AIO community containers and CasaOS): SumSheet + SumDoc + joint discovery.
ARG SUMSHEET_IMAGE=hissih/sumsheet-webhost:latest
ARG SUMDOC_IMAGE=hissih/sumdoc-webhost:latest
FROM ${SUMDOC_IMAGE} AS sumdoc
FROM ${SUMSHEET_IMAGE}
COPY --from=sumdoc /app /opt/sumdoc
COPY front.mjs /opt/sumoffice/front.mjs
COPY start.sh /opt/sumoffice/start.sh
EXPOSE 8093
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD node -e 'require("http").get("http://127.0.0.1:8093/health",r=>process.exit(r.statusCode===200?0:1)).on("error",()=>process.exit(1))'
ENTRYPOINT ["bash", "/opt/sumoffice/start.sh"]
