# SumOffice — Azure Marketplace (Azure Application, solution template)

Status: draft, not yet submitted; needs republished images with the WOPI proof-key fix before submission.

## Which Azure offer type, and why

| Offer type | What the publisher ships | Verdict |
|---|---|---|
| Virtual machine offer | a generalized VHD / Azure Compute Gallery image, certified per version | more work: own image pipeline and certification for every release |
| Azure Application — managed application | ARM template + UI; the publisher keeps access to the deployed resources and is responsible for managing them | not needed: nothing is operated on the customer's behalf |
| **Azure Application — solution template** | **`mainTemplate.json` + `createUiDefinition.json` in one .zip** | **chosen: no custom image; the VM uses Canonical's Ubuntu 24.04 LTS image from the Marketplace and installs the stack with cloud-init** |

The solution template deploys one VM into the customer's subscription: network security group (22, 80, 443),
virtual network, static Standard public IP with an Azure DNS name, NIC, and an Ubuntu 24.04 LTS VM
(default `Standard_B2s`, 30 GB StandardSSD). cloud-init (`cloud-init.yaml`, embedded as `customData`) clones this
repository, runs `../vm/sumoffice-install.sh` and `sumoffice-configure --domain <Azure DNS name or your own>
--nextcloud-url <...>`. Caddy obtains a Let's Encrypt certificate for that name, so the editors come up on
`https://<name>` without further steps.

| File | Purpose |
|---|---|
| `main.bicep` | source of the template |
| `cloud-init.yaml` | cloud-config loaded by `main.bicep` (`loadTextContent`); `__SUMOFFICE_REF__`, `__DOMAIN__`, `__NEXTCLOUD_URL__` are replaced with parameters |
| `mainTemplate.json` | ARM template compiled from `main.bicep` (goes into the package) |
| `createUiDefinition.json` | portal UI: VM name, admin user + SSH key/password, size, SSH source range, Nextcloud address, optional own DNS name (goes into the package) |

Template parameters: `location`, `vmName`, `vmSize`, `adminUsername`, `authenticationType`, `adminPasswordOrKey`,
`nextcloudUrl`, `customDomain` (`none` = Azure DNS name), `sshSourceAddressPrefix`, `sumofficeRef` (branch/tag
of this repository, default `main`; it must contain `catalogs/vm/`). Outputs: `editorsUrl`, `azureDnsName`,
`sshCommand`, `nextcloudCommand`.

## Build and test (owner)

```sh
bicep build catalogs/azure/main.bicep --outfile catalogs/azure/mainTemplate.json   # after any change

# Try the UI: paste createUiDefinition.json into the Create UI Definition Sandbox
#   https://portal.azure.com/#view/Microsoft_Azure_CreateUIDef/SandboxBlade

# Deploy the template directly
az group create -n sumoffice-test -l westeurope
az deployment group create -g sumoffice-test --template-file catalogs/azure/mainTemplate.json \
  --parameters adminUsername=azureuser adminPasswordOrKey="$(cat ~/.ssh/id_ed25519.pub)" \
               nextcloudUrl=https://cloud.example.com
# then: open the editorsUrl output, check /hosting/discovery; cloud-init log: /var/log/cloud-init-output.log

# Marketplace checks (PowerShell + arm-ttk, https://github.com/Azure/arm-ttk)
Test-AzTemplate -TemplatePath catalogs/azure

# Package: both files at the root of the zip
(cd catalogs/azure && zip ../../sumoffice-azure-app.zip mainTemplate.json createUiDefinition.json)
```

## Submission (owner)

1. Partner Center account enrolled in the Microsoft AI Cloud Partner Program, with the Marketplace publisher
   programme: https://partner.microsoft.com/dashboard/marketplace-offers/overview
2. New offer → **Azure Application** → plan type **Solution template**; listing texts, logo, screenshots,
   support and privacy links; licence note (free for evaluation, production use licensed per application,
   https://sumoffice.com/download#server).
3. Technical configuration of the plan: upload the zip. Partner Center adds the customer usage attribution
   tracking ID itself (the template has no `Microsoft.Resources/deployments` resource, so nothing blocks that).
4. Review and publish; test the preview offer with the "preview audience" subscription before going live.

What is needed from the owner: Partner Center publisher account; a test Azure subscription; the images
republished with the proof-key fix; a tag of this repository with `catalogs/vm/` to set as `sumofficeRef`
default; logo and listing texts.

## Checked

- `bicep build` and `bicep lint` (Bicep CLI 0.47.16): no errors or warnings, also with extra rules enabled in a
  scratch config (`use-recent-api-versions` at 730 days, `use-stable-vm-image`, `no-hardcoded-env-urls`,
  `outputs-should-not-contain-secrets`, `use-secure-value-for-secure-inputs`). API versions: Network 2025-05-01,
  Compute 2025-04-01.
- `createUiDefinition.json` validated against the published JSON schema
  (`CreateUIDefinition.MultiVm.json` 0.1.2-preview with its CommonControl/ProviderControl schemas), 0 errors;
  every UI output is a template parameter and every parameter without a default is a UI output.
- `cloud-init.yaml` (as is, and rendered with sample values) passes `cloud-init schema -c` (cloud-init from its
  main branch, 2026-09-25).
- Not run: arm-ttk (needs PowerShell), the Create UI Definition Sandbox, any deployment to Azure.

## Open points

- The editor images are amd64 only; the size selector filters by the x64 Ubuntu image, but an Arm size typed in
  by hand would fail at install time.
- The SSH rule defaults to any source (`*`); certification may ask for a narrower default.
- An own DNS name must point at the public IP before Caddy can get a certificate (it retries on its own).
