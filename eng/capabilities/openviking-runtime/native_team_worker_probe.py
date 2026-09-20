"""Synthetic-only Main process-owner fixture; no server, files or real providers."""
import importlib.util
from importlib.metadata import version
import os
from pathlib import Path
import subprocess
import sys
import time


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


if sys.version_info[:3] != (3, 12, 10) or version("openviking") != "0.4.16":
    raise RuntimeError("Pinned synthetic runtime required")
mode = sys.argv[1]
if mode == "descendant":
    subprocess.Popen(["/bin/sleep", "60"])
    os._exit(0)  # Main must clean the surviving group even after the root exits.
if mode == "idle":
    time.sleep(60)
    os._exit(71)
if mode != "model":
    raise RuntimeError("Invalid synthetic probe mode")

adapter, ipc = load("team_model_transport"), load("team_model_channel")
from openviking.models.embedder import openai_embedders
route = adapter.ModelRoute("embedding", "https://model.invalid/v1", "fixture")
channel = ipc.TeamModelChannel(3, timeout=10)
openai = adapter.TeamOpenAIClients(route, channel.exchange, channel.exchange_async)
openviking_backend = openai_embedders.openai
openai_embedders.openai = openai
try:
    backend = openai_embedders.OpenAIDenseEmbedder(model_name="fixture", api_key="team-broker-only",
        api_base=route.endpoint, dimension=2, encoding_format="float", config={"max_retries": 0})
    result = backend.embed("synthetic document").dense_vector
    backend.client.close()
    # Exit atomically with the assertion outcome; a prior FD shutdown would let
    # Main's required EOF cleanup race with this synthetic success exit code.
    os._exit(0 if result == [0.25, 0.75] else 70)
finally:
    openai_embedders.openai = openviking_backend
    channel.stop()
