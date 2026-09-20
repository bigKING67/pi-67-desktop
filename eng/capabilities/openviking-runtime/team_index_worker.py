"""Bounded unpublished team vector-index job, pinned to OV 0.4.16.

Main admits this file and its two siblings inside the signed runtime tree before
launch. Only fixed job.json in a fresh owned cwd is input; no paths, credentials,
arbitrary OV configuration, private sessions or network service are accepted.
Successful process exit plus result.json means local indexing, NOT publication,
membership, a searchable cursor or a permission lease. Main owns those checks.
"""
import asyncio
from contextlib import contextmanager
import hashlib
import importlib.util
from importlib.metadata import version
import json
import logging
import os
from pathlib import Path
import re
import stat
import sys
import time
from urllib.parse import urlsplit

MAX_JOB_BYTES = 8 * 1024 * 1024
JOB_TIMEOUT_SECONDS = 240
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
HASH = re.compile(r"[a-f0-9]{64}")


class WorkerStageFailure(RuntimeError):
    def __init__(self, code):
        super().__init__("Team index stage failed")
        self.code = code


@contextmanager
def failure_stage(code):
    """Fixed exit ABI only; never serialize the upstream exception or its payload."""
    try:
        yield
    except WorkerStageFailure:
        raise
    except BaseException:
        raise WorkerStageFailure(code) from None


def fields(value, names):
    if not isinstance(value, dict) or set(value) != set(names):
        raise ValueError("Invalid team index job")


def read_job(root):
    metadata = root.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid()
            or metadata.st_mode & 0o077 or set(os.listdir(root)) != {"job.json"}):
        raise ValueError("Team index requires fresh owned staging")
    descriptor = os.open(root / "job.json", os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
                or before.st_mode & 0o077 or before.st_size > MAX_JOB_BYTES):
            raise ValueError("Unsafe team index job file")
        data = source.read(MAX_JOB_BYTES + 1)
        after = os.fstat(source.fileno())
        current = (root / "job.json").lstat()
        if (len(data) > MAX_JOB_BYTES or before.st_size != after.st_size
                or before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns
                or (current.st_dev, current.st_ino) != (after.st_dev, after.st_ino)
                or stat.S_ISLNK(current.st_mode)):
            raise ValueError("Team index job changed while reading")
    job = json.loads(data.decode("utf-8"))
    fields(job, ("schema", "scopeKey", "embedding", "extraction", "documents"))
    if job["schema"] != "newmoney.team-index-job.v1" or not isinstance(job["scopeKey"], str) or not HASH.fullmatch(job["scopeKey"]):
        raise ValueError("Invalid team index identity")
    if root.parent.name != "staging" or root.parent.parent.name != job["scopeKey"]:
        raise ValueError("Team index directory scope mismatch")
    for purpose in ("embedding", "extraction"):
        model = job[purpose]
        fields(model, ("endpoint", "model", "dimension") if purpose == "embedding" else ("endpoint", "model"))
        if not isinstance(model["endpoint"], str) or len(model["endpoint"]) > 2048:
            raise ValueError("Invalid team model route")
        url = urlsplit(model["endpoint"])
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or "?" in model["endpoint"] or "#" in model["endpoint"] or "\\" in model["endpoint"]
                or any(ord(char) <= 32 or ord(char) == 127 for char in model["endpoint"])
                or not isinstance(model["model"], str) or not 1 <= len(model["model"]) <= 128
                or any(char.isspace() or ord(char) < 32 for char in model["model"])):
            raise ValueError("Invalid team model route")
    dimension = job["embedding"]["dimension"]
    # Pinned local VectorDB validates 4..4096 and a multiple of four. The model
    # adapter alone accepts other dimensions; that is not storage compatibility.
    if type(dimension) is not int or not 4 <= dimension <= 4096 or dimension % 4:
        raise ValueError("Invalid team embedding dimension")
    documents = job["documents"]
    if not isinstance(documents, list) or not 1 <= len(documents) <= 100:
        raise ValueError("Invalid team document budget")
    seen = set()
    for document in documents:
        fields(document, ("assetId", "contentRevision", "canonicalContent"))
        if (not isinstance(document["assetId"], str) or not UUID.fullmatch(document["assetId"])
                or document["assetId"] in seen or not isinstance(document["canonicalContent"], str)
                or not isinstance(document["contentRevision"], str) or not HASH.fullmatch(document["contentRevision"])):
            raise ValueError("Invalid team document identity")
        content = document["canonicalContent"].encode("utf-8")
        if not 1 <= len(content) <= 2 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != document["contentRevision"]:
            raise ValueError("Team document revision mismatch")
        seen.add(document["assetId"])
    return job


def load_sibling(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def deny_unbrokered_network(event, _arguments):
    # Defense against a Python SDK fallback or accidental listener. This is not
    # an OS sandbox for native code; the admitted RAGFS/VectorDB are local-only.
    if event in ("socket.connect", "socket.bind", "socket.getaddrinfo"):
        raise RuntimeError("Team worker network must use the inherited broker")


def remaining_job_seconds(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Team index job budget exhausted")
    return remaining


async def index_job(root, job, deadline):
    with failure_stage(73):
        return await execute_index_job(root, job, deadline)


async def execute_index_job(root, job, deadline):
    # A deliberately nonexistent explicit path prevents config imports/loggers
    # from resolving ~/.openviking or /etc settings before in-memory initialization.
    os.environ["OPENVIKING_CONFIG_FILE"] = str(root / "no-default-config")
    os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    logging.disable(logging.CRITICAL)
    transport = load_sibling("team_model_transport")
    channel_module = load_sibling("team_model_channel")
    channel = channel_module.TeamModelChannel(3, timeout=30)
    from openviking.models.embedder import openai_embedders
    from openviking.models.vlm.backends import openai_vlm
    original_embedding, original_vlm = openai_embedders.openai, openai_vlm.openai
    clients = {}
    for purpose in ("embedding", "extraction"):
        selection = job[purpose]
        route = transport.ModelRoute(purpose, selection["endpoint"], selection["model"])
        clients[purpose] = transport.TeamOpenAIClients(route, channel.exchange, channel.exchange_async)
    openai_embedders.openai, openai_vlm.openai = clients["embedding"], clients["extraction"]
    service = None
    try:
        from openviking_cli.utils.config.open_viking_config import OpenVikingConfigSingleton
        def model(purpose):
            selected = job[purpose]
            return {"provider": "openai", "model": selected["model"], "api_base": selected["endpoint"], "api_key": "team-broker-only"}
        (root / "index").mkdir(mode=0o700)
        OpenVikingConfigSingleton.initialize(config_dict={
            "storage": {"workspace": str(root / "index"), "agfs": {"backend": "local"}, "vectordb": {"backend": "local"}},
            "embedding": {"max_concurrent": 1, "dense": {**model("embedding"), "dimension": job["embedding"]["dimension"], "input": "text", "encoding_format": "float"}},
            "vlm": {**model("extraction"), "max_concurrent": 1, "max_retries": 0}, "enable_watch_scheduler": False,
            "log": {"level": "CRITICAL", "output": "stderr"},
            "memory": {"extraction_enabled": False, "session_skill_extraction_enabled": False,
                       "session_auto_commit": {"default_enabled": False, "idle_enabled": False}}})
        from openviking.service.core import OpenVikingService
        from openviking.server.identity import RequestContext, Role, UserIdentifier
        user = UserIdentifier("team-" + job["scopeKey"], "desktop")
        service = OpenVikingService(user=user)
        await service.initialize()
        context = RequestContext(user=user, role=Role.USER)
        for document in job["documents"]:
            uri = "viking://resources/" + document["assetId"] + ".md"
            with failure_stage(74):
                result = await service.fs.write(uri, document["canonicalContent"], context,
                                                mode="create", wait=True, timeout=remaining_job_seconds(deadline),
                                                processing_mode="vectors_only")
                if result.get("vector_status") != "complete" or result.get("content_updated") is not True:
                    raise RuntimeError("Team vector indexing did not complete")
    finally:
        already_failed = sys.exc_info()[0] is not None
        try:
            with failure_stage(75):
                if service is not None:
                    await service.close()
        except WorkerStageFailure:
            # Preserve the first failed stage, but never produce a success receipt
            # when closing storage fails after otherwise successful vector work.
            if not already_failed:
                raise
        finally:
            openai_embedders.openai, openai_vlm.openai = original_embedding, original_vlm
            # Do not shutdown FD3 here: Main treats EOF as cancellation. Atomic
            # process exit follows receipt writing, after storage is closed.
    receipt = {"schema": "newmoney.team-index-result.v1", "scopeKey": job["scopeKey"],
               "documents": [{"assetId": doc["assetId"], "contentRevision": doc["contentRevision"]} for doc in job["documents"]]}
    with failure_stage(76):
        with open(root / "result.json", "x", encoding="utf-8") as output:
            json.dump(receipt, output, separators=(",", ":"))
            output.flush()
            os.fsync(output.fileno())
    return channel


def main():
    os.umask(0o077)
    with failure_stage(71):
        if (len(sys.argv) != 1 or sys.version_info[:3] != (3, 12, 10)
                or version("openviking") != "0.4.16" or version("openviking-sdk") != "0.1.10"):
            raise RuntimeError("Pinned team worker runtime required")
    root = Path.cwd()
    with failure_stage(72):
        job = read_job(root)
    sys.addaudithook(deny_unbrokered_network)
    deadline = time.monotonic() + JOB_TIMEOUT_SECONDS
    channel = asyncio.run(asyncio.wait_for(index_job(root, job, deadline), timeout=JOB_TIMEOUT_SECONDS))
    # Keep FD3 owned until atomic exit; Python socket GC before exit would race
    # Main's intentional EOF cancellation. Storage and the receipt are settled.
    assert channel is not None
    os._exit(0)


if __name__ == "__main__":
    try:
        main()
    except WorkerStageFailure as failure:
        os._exit(failure.code)
    except BaseException:
        # No exception, provider body or document content escapes through logs.
        os._exit(70)
