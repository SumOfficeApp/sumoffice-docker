# Owner submission — TrueNAS SCALE

Package: `docker-compose.yaml`, suitable for **Apps → Discover Apps → Custom App → Install via YAML** on an amd64
TrueNAS SCALE host. It uses the public compatibility server plus the released SumDoc and SumSheet images.

1. Open **Apps → Discover Apps → Custom App**, choose **Install via YAML**, paste `docker-compose.yaml`, replace
   `PUBLIC_URL` and `JWT_SECRET`, and click **Install**.
2. Put an HTTPS reverse proxy in front of host port 8093 and enter the same URL/secret in the office connector.
3. After `/healthcheck`, the signed command doctor, DOCX save and XLSX save pass, prepare the community-catalog PR
   with the approved icon/screenshots and link this tested YAML in the PR description.

This package is amd64 and does not claim PPTX.
