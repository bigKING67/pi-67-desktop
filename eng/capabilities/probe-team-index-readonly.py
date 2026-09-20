"""Diagnostic only: reopen/query/close an explicitly marked synthetic generation.

Never run against user profiles. The current SDK may rewrite metadata even on
open. This probe records that behavior; it is NOT a production query bootstrap,
read-only adapter, OS sandbox, model broker or permission grant.
"""
import hashlib
import json
import logging
import os
from pathlib import Path
import stat
import sys
import tempfile
from importlib.metadata import version


def fingerprint(root):
    result = {}
    total = 0
    for path in sorted(root.rglob("*")):
        info = path.lstat()
        if path.is_symlink() or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError("Unsafe synthetic probe tree")
        if len(result) >= 4096 or info.st_size > 256 * 1024 * 1024:
            raise ValueError("Synthetic probe budget exceeded")
        digest = None
        if path.is_file():
            total += info.st_size
            if total > 512 * 1024 * 1024:
                raise ValueError("Synthetic probe budget exceeded")
            with path.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
        result[str(path.relative_to(root))] = [info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, digest]
    return result


def main():
    os.umask(0o077)
    if len(sys.argv) != 2 or sys.version_info[:3] != (3, 12, 10):
        raise ValueError("Pinned synthetic probe invocation required")
    root = Path(sys.argv[1]).resolve(strict=True)
    if (root.parent.name != "staging" or root.parents[2].name != "team-projections"
            or not root.parents[3].name.startswith("new-money-team-index-")
            or root.parents[3].parent != Path(tempfile.gettempdir()).resolve()):
        raise ValueError("Isolated native-test generation required")
    marker = root / "readonly-probe-fixture.json"
    if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 1024:
        raise ValueError("Explicit synthetic fixture marker required")
    config = json.loads(marker.read_text())
    if config != {"schema": "newmoney.synthetic-readonly-probe.v1", "dimension": 8}:
        raise ValueError("Invalid synthetic fixture marker")
    if version("openviking") != "0.4.16" or version("openviking-sdk") != "0.1.10":
        raise ValueError("Pinned synthetic probe packages required")
    os.environ["OPENVIKING_CONFIG_FILE"] = str(root / "no-default-config")
    os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    logging.disable(logging.CRITICAL)
    index = root / "index"
    if index.is_symlink() or not index.is_dir():
        raise ValueError("Unsafe synthetic probe root")
    before = fingerprint(index)
    writes = set()

    def audit(event, args):
        if event in ("socket.connect", "socket.bind", "socket.getaddrinfo"):
            raise RuntimeError("Synthetic query probe has no network access")
        if event == "open" and isinstance(args[0], (str, bytes)):
            path = Path(os.fsdecode(args[0])).absolute()
            mode, flags = args[1], args[2]
            writing = bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
            if mode and any(character in mode for character in "wax+"):
                writing = True
            if writing and path.is_relative_to(index) and len(writes) < 128:
                writes.add(str(path.relative_to(index)))

    sys.addaudithook(audit)
    from openviking.storage.vectordb.collection.local_collection import get_or_create_local_collection
    collection_path = index / "vectordb" / "context"
    if not (collection_path / "collection_meta.json").is_file():
        raise ValueError("Expected synthetic vector collection is missing")
    collection = get_or_create_local_collection(path=str(collection_path))
    try:
        result = collection.search_by_vector("default", dense_vector=[0.25, 0.75, 0, 0, 0, 0, 0, 0], limit=4, output_fields=["uri"])
        hits = len(result.data)
    finally:
        collection.close()
    after = fingerprint(index)
    changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    print(json.dumps({"schema": "newmoney.synthetic-readonly-probe-result.v1", "hits": hits,
                      "writeOpens": sorted(writes), "changedEntries": changed}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Synthetic team query probe failed.", file=sys.stderr)
        sys.exit(1)
