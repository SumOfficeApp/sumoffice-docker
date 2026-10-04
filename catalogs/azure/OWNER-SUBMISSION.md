# Owner submission — Azure Marketplace

Package: `mainTemplate.json` plus `createUiDefinition.json`; `cloud-init.yaml` installs the released-image compose.

1. In Partner Center choose **Marketplace offers → New offer → Azure Application**.
2. Create a plan, upload a ZIP containing the two JSON files, validate it in the Create UI Definition Sandbox and
   deploy the technical configuration to an amd64 test subscription.
3. Complete Properties, Offer listing, Preview audience and Review and publish; upload the approved icon/screenshots.
4. After the preview deployment passes `/healthcheck`, the signed command doctor, DOCX save and XLSX save, click
   **Go live**.

The package is not an ARM64 editor offering and makes no PPTX claim.

