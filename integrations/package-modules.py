#!/usr/bin/env python3
"""Build deterministic Odoo and Redmine module ZIPs and SHA256SUMS."""
from __future__ import annotations

import argparse
import hashlib
import re
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
FIXED_TIME = (2026, 10, 3, 0, 0, 0)


def version(path: Path, pattern: str) -> str:
    match = re.search(pattern, path.read_text(encoding="utf-8"))
    if not match:
        raise SystemExit(f"Version not found in {path}")
    return match.group(1)


def write_zip(source: Path, target: Path) -> None:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
                continue
            info = zipfile.ZipInfo(str(Path(source.name) / path.relative_to(source)), FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o644 & 0xFFFF) << 16
            archive.writestr(info, path.read_bytes())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    modules = [
        (
            ROOT / "integrations/odoo/sumoffice_wopi",
            "sumoffice-odoo",
            version(ROOT / "integrations/odoo/sumoffice_wopi/__manifest__.py", r'"version":\s*"([^"]+)"'),
        ),
        (
            ROOT / "integrations/redmine/sumoffice_wopi",
            "sumoffice-redmine",
            version(ROOT / "integrations/redmine/sumoffice_wopi/init.rb", r"version '([^']+)'"),
        ),
    ]
    built = []
    for source, product, release in modules:
        target = args.output / f"{product}-{release}.zip"
        write_zip(source, target)
        built.append(target)

    sums = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in built)
    (args.output / "SHA256SUMS").write_text(sums, encoding="ascii")
    print(f"Built {len(built)} module archives in {args.output}")


if __name__ == "__main__":
    main()
