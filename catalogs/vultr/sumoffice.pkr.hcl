# SumOffice — Vultr Marketplace snapshot build (layout of github.com/vultr/vultr-marketplace/sample-app).
#
#   export VULTR_API_KEY=...           # the workstation's IP must be in the Vultr API access control list
#   packer init  catalogs/vultr/sumoffice.pkr.hcl
#   packer build catalogs/vultr/sumoffice.pkr.hcl
#
# The result is a snapshot in the vendor account; assign it in Marketplace -> the app -> Builds.

packer {
  required_plugins {
    vultr = {
      version = ">= 2.7.0"
      source  = "github.com/vultr/vultr"
    }
  }
}

variable "vultr_api_key" {
  type      = string
  default   = env("VULTR_API_KEY")
  sensitive = true
}

# Vultr asks vendors to design for this plan (2 vCPU, 2 GB RAM, 8 GB disk) so the app fits every plan.
variable "plan_id" {
  type    = string
  default = "marketplace-2c-2gb"
}

variable "region_id" {
  type    = string
  default = "ewr"
}

# 2284 = "Ubuntu 24.04 LTS x64" in https://api.vultr.com/v2/os
variable "os_id" {
  type    = number
  default = 2284
}

# Branch or tag of github.com/SumOfficeApp/sumoffice-docker cloned into the image (nextcloud/ stack files).
variable "sumoffice_ref" {
  type    = string
  default = "main"
}

source "vultr" "sumoffice" {
  api_key              = var.vultr_api_key
  os_id                = var.os_id
  plan_id              = var.plan_id
  region_id            = var.region_id
  snapshot_description = "SumOffice ${formatdate("YYYY-MM-DD hh:mm", timestamp())}"
  ssh_username         = "root"
  state_timeout        = "25m"
}

build {
  sources = ["source.vultr.sumoffice"]

  provisioner "shell" {
    inline = ["cloud-init status --wait || true", "mkdir -p /tmp/sumoffice-vm"]
  }

  # Shared appliance scripts (also used by the DigitalOcean, Azure and OVHcloud packages).
  provisioner "file" {
    source      = "${path.root}/../vm/"
    destination = "/tmp/sumoffice-vm/"
  }

  provisioner "file" {
    source      = "${path.root}/files/sumoffice-per-instance.sh"
    destination = "/root/sumoffice-per-instance.sh"
  }

  provisioner "shell" {
    environment_vars = ["SUMOFFICE_REF=${var.sumoffice_ref}", "DEBIAN_FRONTEND=noninteractive"]
    script           = "${path.root}/scripts/sumoffice-build.sh"
    remote_folder    = "/root"
    remote_file      = "sumoffice-build.sh"
  }
}
