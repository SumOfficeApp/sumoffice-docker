# SumOffice — DigitalOcean Marketplace (Droplet 1-Click App) image.
# Layout follows github.com/digitalocean/marketplace-partners: build Droplet -> install -> ufw ->
# force-ssh-logout -> 90-cleanup.sh -> 99-img-check.sh -> snapshot.
#
#   export DIGITALOCEAN_TOKEN=...      # personal access token of the team that owns the Vendor Portal listing
#   packer init  catalogs/digitalocean/sumoffice.pkr.hcl
#   packer build catalogs/digitalocean/sumoffice.pkr.hcl

packer {
  required_plugins {
    digitalocean = {
      version = ">= 1.4.0"
      source  = "github.com/digitalocean/digitalocean"
    }
  }
}

variable "do_token" {
  type      = string
  default   = env("DIGITALOCEAN_TOKEN")
  sensitive = true
}

variable "region" {
  type    = string
  default = "nyc3"
}

# DigitalOcean asks for the smallest ($6) Droplet as the build Droplet so that every plan can use the image.
variable "size" {
  type    = string
  default = "s-1vcpu-1gb"
}

variable "image" {
  type    = string
  default = "ubuntu-24-04-x64"
}

# Branch or tag of github.com/SumOfficeApp/sumoffice-docker cloned into the image (nextcloud/ stack files).
variable "sumoffice_ref" {
  type    = string
  default = "main"
}

variable "application_version" {
  type    = string
  default = "latest"
}

locals {
  snapshot_name = "sumoffice-24-04-snapshot-${formatdate("YYYYMMDDhhmm", timestamp())}"
  build_env = [
    "DEBIAN_FRONTEND=noninteractive",
    "LC_ALL=C",
    "LANG=en_US.UTF-8",
    "LC_CTYPE=en_US.UTF-8",
  ]
}

source "digitalocean" "sumoffice" {
  api_token     = var.do_token
  image         = var.image
  region        = var.region
  size          = var.size
  ssh_username  = "root"
  snapshot_name = local.snapshot_name
  # Keep the build Droplet plain: the Marketplace image check fails on /opt/digitalocean (droplet agent).
  droplet_agent      = false
  monitoring         = false
  private_networking = false
}

build {
  sources = ["source.digitalocean.sumoffice"]

  provisioner "shell" {
    inline = ["cloud-init status --wait", "mkdir -p /tmp/sumoffice-vm"]
  }

  # Shared appliance scripts (also used by the Vultr, Azure and OVHcloud packages).
  provisioner "file" {
    source      = "${path.root}/../vm/"
    destination = "/tmp/sumoffice-vm/"
  }

  provisioner "file" {
    source      = "${path.root}/files/var/"
    destination = "/var/"
  }

  provisioner "shell" {
    environment_vars = local.build_env
    inline = [
      "apt -qqy update",
      "apt -qqy -o Dpkg::Options::='--force-confdef' -o Dpkg::Options::='--force-confold' full-upgrade",
      "apt-get -qqy clean",
    ]
  }

  provisioner "shell" {
    environment_vars = concat(local.build_env, [
      "SUMOFFICE_REF=${var.sumoffice_ref}",
      "application_name=SumOffice",
      "application_version=${var.application_version}",
    ])
    scripts = [
      "${path.root}/scripts/01-sumoffice.sh",
      "${path.root}/scripts/02-ufw.sh",
      "${path.root}/scripts/03-force-ssh-logout.sh",
      "${path.root}/scripts/90-cleanup.sh",
      "${path.root}/scripts/99-img-check.sh",
    ]
  }

  post-processor "manifest" {
    output     = "${path.root}/manifest.json"
    strip_path = true
  }
}
