"""One-shot vector lookup on a Main-owned working copy, OV 0.4.16 only.

Admitted only from a separately signed query-v1 runtime. Never add this to an
installed index-v1 tree or use a repository path as a production fallback.
FD3 carries one bounded vector request/result and an ACK; no model call, prompt,
credentials, source-body output, persistent query file, HTTP service or logging.
"""
from importlib.metadata import version
import json
import logging
import math
import os
from pathlib import Path
import re
import socket
import stat
import sys
import time

MAX_REQUEST = 128 * 1024
MAX_RESULT = 32 * 1024
ASSET_ID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
URI = re.compile(r"/resources/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.md")


def validate_request(value):
    if (not isinstance(value, dict) or set(value) != {"schema", "scopeKey", "assetIds", "vector", "limit"}
            or value["schema"] != "newmoney.team-vector-query.v1"
            or not isinstance(value["scopeKey"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["scopeKey"])
            or type(value["limit"]) is not int or not 1 <= value["limit"] <= 100):
        raise ValueError("Invalid team vector query")
    assets = value["assetIds"]
    if (not isinstance(assets, list) or not 1 <= len(assets) <= 100
            or any(not isinstance(asset, str) or not ASSET_ID.fullmatch(asset) for asset in assets)
            or len(set(assets)) != len(assets)):
        raise ValueError("Invalid query asset allowlist")
    vector = value["vector"]
    if (not isinstance(vector, list) or not 4 <= len(vector) <= 4096 or len(vector) % 4
            or any(type(number) not in (int, float) or not math.isfinite(number)
                   or abs(number) > 3.4028234663852886e38 for number in vector)):
        raise ValueError("Invalid team vector")
    return value


def validate_root(root, scope_key):
    if (not re.fullmatch(r"query-[a-zA-Z0-9_-]+", root.name) or root.parent.name != "staging"
            or root.parent.parent.name != scope_key or set(os.listdir(root)) != {"index"}):
        raise ValueError("Owned query copy required")
    for path in (root.parent.parent, root.parent, root, root / "index"):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o7077:
            raise ValueError("Unsafe query directory")
    collection = root / "index" / "vectordb" / "context"
    for path in (collection.parent, collection):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o7077:
            raise ValueError("Missing query collection")
    info = (collection / "collection_meta.json").lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o7177:
        raise ValueError("Missing query metadata")
    return collection


def read_exact(channel, size, deadline):
    data = bytearray()
    while len(data) < size:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        channel.settimeout(remaining)
        part = channel.recv(size - len(data))
        if not part:
            raise EOFError()
        data.extend(part)
    return data


def query(collection_path, request):
    from openviking.storage.vectordb.collection.local_collection import get_or_create_local_collection
    collection = get_or_create_local_collection(path=str(collection_path))
    try:
        # The factory returns public Collection, not LocalCollection. Its public
        # metadata drops internal Dimension; dimension lives on the vector field.
        dimensions = [field.get("Dim") for field in collection.get_meta_data().get("Fields", [])
                      if field.get("FieldType") == "vector"]
        if not collection.has_index("default") or dimensions != [len(request["vector"])]:
            raise ValueError("Query index or dimension mismatch")
        account = "team-" + request["scopeKey"]
        # OV stores encoded paths (not viking:// URIs) and indexes automatic
        # directory records too. Filter exact admitted assets BEFORE top-k.
        filters = {"op": "and", "conds": [
            {"op": "must", "field": "uri", "conds": ["/resources/" + asset + ".md" for asset in request["assetIds"]], "para": "-d=0"},
            {"op": "must", "field": "account_id", "conds": [account]}]}
        result = collection.search_by_vector("default", dense_vector=request["vector"], limit=request["limit"],
                                             filters=filters, output_fields=["uri", "account_id"])
        hits = {}
        if len(result.data) > request["limit"]:
            raise ValueError("Query result budget exceeded")
        for item in result.data:
            uri = item.fields.get("uri") if isinstance(item.fields, dict) else None
            match = URI.fullmatch(uri) if isinstance(uri, str) else None
            if (not match or match.group(1) not in request["assetIds"] or item.fields.get("account_id") != account
                    or item.score is None or not math.isfinite(item.score)):
                raise ValueError("Invalid query identity or score")
            asset_id, score = match.group(1), float(item.score)
            # Keep the SDK's ordering and first hit; do not assume every index
            # metric interprets larger scores as better.
            hits.setdefault(asset_id, score)
        return {"schema": "newmoney.team-vector-result.v1", "hits": [
            {"assetId": asset_id, "score": score} for asset_id, score in hits.items()]}
    finally:
        collection.close()


def main():
    os.umask(0o077)
    if (len(sys.argv) != 1 or sys.version_info[:3] != (3, 12, 10)
            or version("openviking") != "0.4.16" or version("openviking-sdk") != "0.1.10"):
        raise ValueError("Pinned query runtime required")
    root = Path.cwd()
    os.environ["OPENVIKING_CONFIG_FILE"] = str(root / "no-default-config")
    os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    logging.disable(logging.CRITICAL)

    def audit(event, _args):
        if event in ("socket.connect", "socket.bind", "socket.getaddrinfo"):
            raise RuntimeError("Vector query has no network or model access")
    sys.addaudithook(audit)  # Python fallback guard, not an OS sandbox for native code.
    channel = socket.socket(fileno=3)
    deadline = time.monotonic() + 25
    size = int.from_bytes(read_exact(channel, 4, deadline), "big")
    if not 1 <= size <= MAX_REQUEST:
        raise ValueError("Query frame budget exceeded")
    request = validate_request(json.loads(read_exact(channel, size, deadline).decode("utf-8")))
    output = json.dumps(query(validate_root(root, request["scopeKey"]), request), allow_nan=False, separators=(",", ":")).encode()
    if len(output) > MAX_RESULT or time.monotonic() >= deadline:
        raise ValueError("Query result budget exceeded")
    channel.settimeout(deadline - time.monotonic())
    channel.sendall(len(output).to_bytes(4, "big") + output)
    if read_exact(channel, 1, deadline) != b"\x01":
        raise ValueError("Query acknowledgement missing")
    # Keep the inherited descriptor until atomic exit, after collection.close.
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        os._exit(70)
