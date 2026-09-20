"""Team-only model transport adapter; no socket, credentials or direct HTTP fallback.

Use only in an isolated team worker. The owning native IPC adapter must bind scope
and deliver every exchange to Host runSharedMemoryModelRequest, including retries.
This module alone is NOT authorization and is never activated by the private service.
It is packaged only as a versioned team bootstrap companion in the signed runtime.
Exchange callbacks must enforce bounded IPC deadlines/cancellation and return only
validated response bytes. Async cancellation must propagate to the Host request.
"""
import json
import math
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
import openai

MAX_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class ModelRoute:
    purpose: str
    endpoint: str
    model: str

    def __post_init__(self):
        url = urlsplit(self.endpoint)
        if (self.purpose not in ("embedding", "extraction")
                or url.scheme != "https" or not url.hostname
                or url.username or url.password or url.query or url.fragment
                or not isinstance(self.model, str) or not self.model or len(self.model) > 128
                or any(char.isspace() or ord(char) < 32 for char in self.model)):
            raise ValueError("Invalid team model route")

    def validate(self, request, body):
        suffix = "/embeddings" if self.purpose == "embedding" else "/chat/completions"
        if (request.method != "POST" or str(request.url) != self.endpoint.rstrip("/") + suffix
                or len(body) > MAX_BYTES):
            raise ValueError("Team model request does not match its bound route")
        value = json.loads(body)
        if not isinstance(value, dict) or value.get("model") != self.model or value.get("stream") is True:
            raise ValueError("Team model request does not match its bound model")


def response_for(request, result):
    status, body = result
    if (type(status) is not int or status < 200 or status > 599 or 300 <= status < 400
            or not isinstance(body, bytes) or len(body) > MAX_BYTES):
        raise ValueError("Invalid team model response")
    # Provider errors can echo prompts or credentials. Keep only their status.
    if status >= 400:
        body = b'{"error":{"message":"Team model request failed","type":"team_model_error"}}'
    # Do not forward provider-controlled headers, redirects or cookies.
    return httpx.Response(status, content=body, headers={"content-type": "application/json"}, request=request)


class TeamSyncTransport(httpx.BaseTransport):
    def __init__(self, route, exchange):
        self.route, self.exchange = route, exchange

    def handle_request(self, request):
        body = request.read()
        self.route.validate(request, body)
        try:
            result = self.exchange(self.route, body)
        except Exception:
            raise RuntimeError("Team model broker unavailable") from None
        return response_for(request, result)


class TeamAsyncTransport(httpx.AsyncBaseTransport):
    def __init__(self, route, exchange):
        self.route, self.exchange = route, exchange

    async def handle_async_request(self, request):
        body = await request.aread()
        self.route.validate(request, body)
        try:
            result = await self.exchange(self.route, body)
        except Exception:
            raise RuntimeError("Team model broker unavailable") from None
        return response_for(request, result)


class TeamOpenAIClients:
    """Narrow OpenAI constructor facade for the two pinned OpenViking backends.

    It replaces only their module-local SDK reference in a dedicated team worker;
    never mutate the global openai module or use it in the private service process.
    Unsupported Azure/other backends deliberately have no constructors here.
    """
    APIError = openai.APIError

    def __init__(self, route, exchange, exchange_async):
        self.route, self.exchange, self.exchange_async = route, exchange, exchange_async

    def _validate(self, kwargs):
        if (set(kwargs) - {"base_url", "api_key", "timeout", "max_retries"}
                or kwargs.get("base_url") != self.route.endpoint or kwargs.get("api_key") != "team-broker-only"):
            raise ValueError("Team client configuration must use the bound broker route")
        timeout = kwargs.get("timeout", 60)
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Invalid team model timeout")
        return min(timeout, 300)

    def OpenAI(self, **kwargs):
        timeout = self._validate(kwargs)
        return openai.OpenAI(api_key="team-broker-only", base_url=self.route.endpoint, max_retries=0, timeout=timeout,
                             http_client=httpx.Client(transport=TeamSyncTransport(self.route, self.exchange), trust_env=False))

    def AsyncOpenAI(self, **kwargs):
        timeout = self._validate(kwargs)
        return openai.AsyncOpenAI(api_key="team-broker-only", base_url=self.route.endpoint, max_retries=0, timeout=timeout,
                                  http_client=httpx.AsyncClient(transport=TeamAsyncTransport(self.route, self.exchange_async), trust_env=False))
