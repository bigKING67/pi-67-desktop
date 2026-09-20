"""Test-only observer of fixed worker outcomes; no exception messages or content.

The original worker executes unchanged. This wrapper is diagnostic only and must
never be admitted as a product index bootstrap.
"""
import json
import os
from pathlib import Path
import runpy
import sys

target = str(Path(sys.argv[1]).resolve())
observed = {}


def record():
    descriptor = os.open("deadline-diagnostic.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(observed, output)


def trace(frame, event, argument):
    if frame.f_code.co_filename == target:
        if event == "exception" and argument[0].__name__ in ("DeadlineExceededError", "TimeoutError"):
            observed[argument[0].__name__] = True
            record()
        if event == "line" and frame.f_code.co_name == "index_job":
            result = frame.f_locals.get("result")
            if isinstance(result, dict) and "vectorComplete" not in observed:
                observed["vectorComplete"] = result.get("vector_status") == "complete"
                observed["contentUpdated"] = result.get("content_updated") is True
                record()
    return trace


sys.argv = [target]
sys.settrace(trace)
runpy.run_path(target, run_name="__main__")
