# Owner submission — Unraid Community Applications

Package: `docker-compose.yaml` for the Community Applications **Docker Compose Manager** route. A three-container
stack is required; the old single-container `sumoffice.xml` targets an image that was never released.

1. Install **Docker Compose Manager** from Community Applications.
2. Choose **Add New Stack → Edit Stack → Compose File**, paste `docker-compose.yaml`, replace `PUBLIC_URL` and
   `JWT_SECRET`, then choose **Compose Up**.
3. Put an HTTPS reverse proxy in front of port 8093 and enter the same address/secret in the connector.
4. After `/healthcheck`, the signed command doctor, DOCX save and XLSX save pass, create the Unraid forum support
   thread and submit the stack template repository through the Community Applications submission form.

The owner clicks the final **Submit** button only after adding the approved PNG icon and support-thread URL. The
stack is amd64 and does not claim PPTX.

