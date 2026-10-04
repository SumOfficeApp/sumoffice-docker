# Owner submission — DigitalOcean

Package: `sumoffice.pkr.hcl`, `scripts/`, shared `../vm/`, and the released-image compose in `../../nextcloud/`.

1. Sign in to the DigitalOcean Vendor Portal and select **Create App → Droplet 1-Click**.
2. Build the Ubuntu 24.04 amd64 snapshot with the command in `README.md`, then choose that snapshot.
3. Paste the listing text from `README.md`, upload the approved SumOffice icon, choose **Developer tools** and
   **Productivity**, enter the support URL, and request review.

Do not click **Submit** until a real Droplet made from the snapshot passes `/healthcheck`, the signed command doctor,
DOCX save, and XLSX save. There is no PPTX claim in this version.

