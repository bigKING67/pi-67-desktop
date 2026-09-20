"""New Money build patch: coalesce only one context-gather operation's queries.

No persistent cache, provider routing, retries, or retrieval-policy changes.
Unsupported providers/inputs and capacity overflow retain upstream behavior.
"""

import asyncio
import copy
import hashlib
import json
from contextvars import ContextVar
from functools import wraps

from openviking.models.embedder.base import embed_compat
from openviking.models.embedder.openai_embedders import OpenAIDenseEmbedder

_scope = ContextVar("newmoney_query_embedding_scope", default=None)


class QueryEmbeddingScope:
    def __init__(self):
        self.tasks = {}
        self.closed = False

    async def get(self, key, invoke):
        if self.closed:
            raise RuntimeError("Query embedding scope is closed")
        task = self.tasks.get(key)
        if task is None:
            if len(self.tasks) >= 32:
                return await invoke()
            task = asyncio.create_task(invoke())
            self.tasks[key] = task
        # A cancelled waiter cannot cancel a sibling's request. Failures remain
        # shared for this scope only; the provider's existing retry policy owns it.
        return copy.deepcopy(await asyncio.shield(task))

    async def close(self):
        self.closed = True
        tasks = list(self.tasks.values())
        self.tasks.clear()
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=1)
            if pending:
                raise RuntimeError("Query embedding scope cleanup incomplete")
            await asyncio.gather(*tasks, return_exceptions=True)


def query_embedding_scope(function):
    @wraps(function)
    async def scoped(*args, **kwargs):
        batch = QueryEmbeddingScope()
        token = _scope.set(batch)
        try:
            return await function(*args, **kwargs)
        finally:
            _scope.reset(token)
            await batch.close()
    return scoped


async def embed_query_once(embedder, query, *, ctx):
    async def invoke():
        return await embed_compat(embedder, query, is_query=True)

    batch = _scope.get()
    if batch is None or type(embedder) is not OpenAIDenseEmbedder:
        return await invoke()
    if not isinstance(query, str) or len(query.encode("utf-8")) > 16384:
        return await invoke()
    # Only the pinned concrete text embedder is supported. Include immutable
    # snapshots of wire parameters, transport identity and output dimension.
    # Credentials are hashed in memory, never printed or written to a receipt.
    try:
        config = json.dumps([embedder._build_kwargs(query, is_query=True),
                             embedder._client_kwargs, embedder.dimension,
                             embedder.max_input_tokens, embedder.max_retries,
                             embedder.max_concurrent, embedder._provider],
                            sort_keys=True, allow_nan=False)
    except (TypeError, ValueError):
        return await invoke()
    identity = (ctx.account_id, ctx.user.user_id, ctx.actor_peer_id,
                ctx.role, ctx.from_oauth)
    key = (identity, embedder, hashlib.sha256(config.encode()).digest(), query)
    return await batch.get(key, invoke)
