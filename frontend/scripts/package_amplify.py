#!/usr/bin/env python3
"""Package Vite build output for AWS Amplify manual deployment."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def package_build(source: Path, output: Path) -> None:
    source = source.resolve()
    output = output.resolve()

    if not source.is_dir():
        raise SystemExit(f"Build directory does not exist: {source}")

    index_path = source / "index.html"
    if not index_path.is_file():
        raise SystemExit(f"Build is missing index.html: {index_path}")

    referenced_assets = re.findall(
        r'(?:src|href)=["\'](/assets/[^"\']+)["\']',
        index_path.read_text(encoding="utf-8"),
    )
    missing_assets = [asset for asset in referenced_assets if not (source / asset.lstrip("/")).is_file()]
    if missing_assets:
        raise SystemExit(f"Build references missing assets: {', '.join(missing_assets)}")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)

    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            relative_path = path.relative_to(source).as_posix()
            if path.is_dir():
                directory = ZipInfo(relative_path.rstrip("/") + "/")
                directory.external_attr = (0o40755 << 16) | 0x10
                archive.writestr(directory, b"")
            else:
                archive.write(path, relative_path)

    with ZipFile(output) as archive:
        archived_files = set(archive.namelist())
        missing_from_archive = [
            asset for asset in referenced_assets if asset.lstrip("/") not in archived_files
        ]
        if missing_from_archive:
            raise SystemExit(
                f"Archive is missing referenced assets: {', '.join(missing_from_archive)}"
            )

    print(f"Created Amplify deployment archive: {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default="dist", type=Path)
    parser.add_argument("output", nargs="?", default="amplify-deploy.zip", type=Path)
    args = parser.parse_args()
    package_build(args.source, args.output)


if __name__ == "__main__":
    main()
