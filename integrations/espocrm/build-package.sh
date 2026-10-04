#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$root/manifest.json")
[ -n "$version" ] || { echo "manifest version is missing" >&2; exit 2; }

stage=$(mktemp -d "${TMPDIR:-/tmp}/espocrm-package.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
mkdir -p "$stage/package" "$root/dist"
cp "$root/manifest.json" "$stage/package/manifest.json"
cp -R "$root/files" "$stage/package/files"

find "$stage/package" -exec touch -t 202610040000 {} +
archive="$stage/sumoffice-espocrm-$version.zip"
(
  cd "$stage/package"
  find manifest.json files -type f -print | LC_ALL=C sort | zip -X -q "$archive" -@
)

output="$root/dist/sumoffice-espocrm-$version.zip"
mv "$archive" "$output"
sha=$(shasum -a 256 "$output" | awk '{print $1}')
printf '%s  %s\n' "$sha" "$(basename "$output")" > "$root/dist/SHA256SUMS"
printf '%s\n' "$output"
