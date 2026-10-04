# Owner submission — Helm / Artifact Hub

Package: chart `sumoffice/` and repository metadata `artifacthub-repo.yml`. The chart deploys
`sumoffice-compat:2026.4.0.2` with the released SumDoc and SumSheet `latest` images pinned by digest.

1. Package the chart (`helm package sumoffice`) and publish it to the owner's Helm repository or OCI registry.
2. In Artifact Hub Control Panel choose **Add repository → Helm**, enter the repository URL, and copy the issued
   repository ID into `artifacthub-repo.yml` on the published repository.
3. Upload the approved icon, allow Artifact Hub to index the chart, inspect the rendered README and security report,
   then click **Verified publisher** only after ownership verification succeeds.

Before registration run `helm lint --strict`, `helm template` with a non-default JWT secret, `/healthcheck`, the
signed command doctor, DOCX save and XLSX save on an amd64 cluster. PPTX is not part of this chart version.

