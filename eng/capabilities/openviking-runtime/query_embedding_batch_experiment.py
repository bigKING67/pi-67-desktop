"""Test-only request-scoped coalescing prototype; not a runtime build input."""

import asyncio
import copy


class RequestEmbeddingBatch:
    def __init__(self, capacity=32):
        self.capacity = capacity
        self.tasks = {}
        self.closed = False

    async def get(self, *, identity, model, query, invoke):
        if self.closed:
            raise RuntimeError("Embedding request scope is closed")
        if not isinstance(query, str) or len(query.encode("utf-8")) > 16384:
            raise ValueError("Unsupported experiment query")
        # Exact identity and immutable model-settings tuple, never normalized text.
        key = (identity, model, query)
        if key not in self.tasks:
            if len(self.tasks) >= self.capacity:
                raise RuntimeError("Embedding request scope capacity exceeded")
            self.tasks[key] = asyncio.create_task(invoke())
        # One cancelled consumer must not cancel another consumer's shared work.
        value = await asyncio.shield(self.tasks[key])
        return copy.deepcopy(value)

    async def close(self):
        self.closed = True
        tasks = list(self.tasks.values())
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=1)
            if pending:
                raise RuntimeError("Embedding request scope cleanup incomplete")
            await asyncio.gather(*tasks, return_exceptions=True)
        self.tasks.clear()
