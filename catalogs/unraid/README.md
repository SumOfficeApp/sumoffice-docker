# SumOffice for Unraid

Status: submission package prepared, not submitted.

`docker-compose.yaml` is the complete package for Docker Compose Manager: SumDoc and SumSheet `latest` plus
`sumoffice-compat:2026.4.0.2`, all pinned by digest. Follow `OWNER-SUBMISSION.md` for the owner steps. The package is
linux/amd64 and claims DOCX/XLSX/XLSM/XLSB, not PPTX.

`sumdoc.xml` and `sumsheet.xml` remain standalone advanced templates for developers implementing the native host
contract; they are not the compatibility-server submission package.
