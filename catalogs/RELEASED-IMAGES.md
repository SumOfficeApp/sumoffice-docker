# Released images used by the catalog kits

Checked on 4 October 2026. Catalog manifests use the public tag requested by the owner and pin the digest so a
submission cannot silently change underneath a reviewer.

| Service | Image | Published platforms | Purpose |
|---|---|---|---|
| Compatibility server | `hissih/sumoffice-compat:2026.4.0.2@sha256:ae116f65344bc1721a423306bb1de311df25481064edf0aa7fc4757624bcbdc5` | amd64, arm64 | One public endpoint and connector-compatible API |
| Documents | `hissih/sumdoc-webhost:latest@sha256:3f7667ee310173ec11121a512de73cfbae82073f660f760ad103c7d50f3e94cc` | amd64 | DOCX in SumDoc |
| Spreadsheets | `hissih/sumsheet-webhost:latest@sha256:5874968f0c3cb576fa1870a32ffb47d99e1cd1d1b298a31b19814e4cb5639d9e` | amd64 | XLSX/XLSM/XLSB in SumSheet |

The compatibility server supports a presentation upstream, but no public `hissih/sumslide-webhost:latest` image
exists today. These catalog submissions therefore claim DOCX and spreadsheet formats only. PPTX must be added by a
new reviewed change after a public SumSlide image exists; it must not be implied by listing text or screenshots.

