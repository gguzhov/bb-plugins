#!/usr/bin/env python3
"""Validate and stage committed BB plugin releases in this public source repo."""
import argparse
import io
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXCLUDE = {"docs", "TICKET.md", "VERIFICATION.md", "verification", ".impeccable", "node_modules", "dist", ".env", ".npmrc", "backup", ".DS_Store"}
PRIVATE_MARKERS = re.compile(
    r"-----BEGIN (?:OPENSSH |RSA |EC |ENCRYPTED )?PRIVATE KEY-----|"
    r"sk-proj-[a-zA-Z0-9_-]{20,}|" + re.escape(str(Path.home()) + "/")
)


def run(*args, cwd=ROOT, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=capture)


def snapshot(plugin_id, src, output):
    if run("git", "status", "--porcelain", cwd=src, capture=True).stdout.strip():
        raise SystemExit(f"{plugin_id}: source checkout is dirty")
    commit = run("git", "rev-parse", "HEAD", cwd=src, capture=True).stdout.decode().strip()
    archive = run("git", "archive", commit, cwd=src, capture=True).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
        for member in bundle.getmembers():
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise SystemExit(f"{plugin_id}: invalid archive path")
            if not member.isfile() or set(path.parts) & EXCLUDE or path.suffix in {".pem", ".key"}:
                continue
            data = bundle.extractfile(member).read()
            if PRIVATE_MARKERS.search(data.decode("utf-8", errors="ignore")):
                raise SystemExit(f"{plugin_id}: review private data in {path}")
            target = output / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(member.mode & 0o755)
    package = json.loads((output / "package.json").read_text())
    if package["name"].removeprefix("bb-plugin-") != plugin_id:
        raise SystemExit(f"{plugin_id}: package ID does not match")
    tag = f'{plugin_id}/v{package["version"]}'
    if run("git", "tag", "--list", tag, capture=True).stdout.strip():
        raise SystemExit(f"{tag} already exists. Use a new version.")
    return commit, tag


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plugins", nargs="+")
    parser.add_argument("--source-dir", type=Path, default=Path.home() / ".bb" / "plugins_bb")
    args = parser.parse_args()
    if any(not re.fullmatch(r"[a-z0-9][a-z0-9-]*", plugin_id) for plugin_id in args.plugins):
        parser.error("expected a plugin ID")
    if run("git", "status", "--porcelain", "--", ".bb/plugins.json", "plugins", capture=True).stdout.strip():
        raise SystemExit("The public plugin snapshots already have pending changes.")

    with tempfile.TemporaryDirectory(prefix="bb-release-") as work:
        snapshots = []
        for plugin_id in dict.fromkeys(args.plugins):
            dest = Path(work) / plugin_id
            dest.mkdir()
            commit, tag = snapshot(plugin_id, args.source_dir / f"bb-plugin-{plugin_id}", dest)
            lockfile = dest / "package-lock.json"
            run("npm", "ci" if lockfile.exists() else "install", "--include=dev", cwd=dest)
            run("npm", "run", "typecheck", "--if-present", cwd=dest)
            run("npm", "test", "--if-present", cwd=dest)
            run("bb", "plugin", "build", cwd=dest)
            snapshots.append((plugin_id, dest, commit, tag))

        manifest_file = ROOT / ".bb" / "plugins.json"
        manifest = json.loads(manifest_file.read_text())
        entries = {row["name"]: row for row in manifest["plugins"]}
        for plugin_id, dest, commit, tag in snapshots:
            target = ROOT / "plugins" / plugin_id
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(dest, target, ignore=shutil.ignore_patterns("node_modules", "dist"))
            entries[plugin_id] = {"name": plugin_id, "source": f"./plugins/{plugin_id}"}
            print(f"{plugin_id} {commit} {tag}", flush=True)
        manifest["plugins"] = list(entries.values())
        manifest_file.write_text(json.dumps(manifest, indent=2) + "\n")
    run("git", "diff", "--check")


if __name__ == "__main__":
    main()
