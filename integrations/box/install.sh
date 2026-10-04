#!/bin/sh
set -eu

[ "$#" -eq 1 ] || { echo "usage: $0 <box-bridge.env>" >&2; exit 2; }
env_file=$1
[ -f "$env_file" ] || { echo "env file not found: $env_file" >&2; exit 2; }
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
name=sumoffice-box-bridge

docker build -t "$name" "$here/bridge"
docker rm -f "$name" >/dev/null 2>&1 || true
exec docker run -d --restart unless-stopped --name "$name" -p 8796:8796 --env-file "$env_file" "$name"
