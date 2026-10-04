# Owner submission — Vultr

Package: `vendor-data.sh` for a Marketplace script build, or `sumoffice.pkr.hcl` for a snapshot build; both install
the released-image compose through `../vm/`.

1. In the Vultr Marketplace vendor dashboard choose **Add Application**.
2. Choose the amd64 Ubuntu 24.04 build, then paste `vendor-data.sh` in **Vendor Data** (or select the Packer snapshot).
3. Paste the description and App Instructions from `README.md`, upload the approved icon and screenshots, run a test
   deployment, then click **Submit for review**.

Submit only after `/healthcheck`, the signed command doctor, DOCX save, and XLSX save pass on the created instance.

