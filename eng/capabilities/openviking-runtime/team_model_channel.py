"""One inherited duplex FD per isolated team worker; never stdout or a listener.

Cancellation retires the whole channel, including queued calls. The worker owner
must then stop/recreate that worker. There is no reconnection or private fallback.
"""
import asyncio
import base64
import json
import socket
import threading
import time
import uuid

MAX_FRAME = 3 * 1024 * 1024
MAX_BODY = 2 * 1024 * 1024


class TeamModelChannel:
    def __init__(self, fd, timeout=60):
        if not 0 < timeout <= 300:
            raise ValueError("Invalid team channel deadline")
        self.socket = socket.socket(fileno=fd)
        self.timeout = timeout
        self.lock = threading.Lock()
        self.stopped = False

    def stop(self):
        self.stopped = True
        try:
            self.socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        # Shutdown wakes active recv/send without a close/reused-FD race. The
        # process owner closes the socket after in-flight threads have settled.

    def _read(self, count, deadline):
        chunks = bytearray()
        while len(chunks) < count:
            self.socket.settimeout(max(0.001, deadline - time.monotonic()))
            if time.monotonic() >= deadline:
                raise TimeoutError()
            data = self.socket.recv(count - len(chunks))
            if not data:
                raise EOFError()
            chunks.extend(data)
        return bytes(chunks)

    def exchange(self, route, body):
        deadline = time.monotonic() + self.timeout
        if not self.lock.acquire(timeout=self.timeout):
            self.stop()
            raise RuntimeError("Team model channel unavailable")
        try:
            if self.stopped or not isinstance(body, bytes) or not body or len(body) > MAX_BODY:
                raise ValueError()
            request_id = uuid.uuid4().hex
            data = json.dumps({"type": "team-model-request", "requestId": request_id,
                               "purpose": route.purpose, "endpoint": route.endpoint, "model": route.model,
                               "body": base64.b64encode(body).decode("ascii")}, separators=(",", ":")).encode()
            if len(data) > MAX_FRAME or time.monotonic() >= deadline:
                raise ValueError()
            self.socket.settimeout(deadline - time.monotonic())
            self.socket.sendall(len(data).to_bytes(4, "big") + data)
            size = int.from_bytes(self._read(4, deadline), "big")
            if not 0 < size <= MAX_FRAME:
                raise ValueError()
            response = json.loads(self._read(size, deadline).decode("utf-8"))
            if (not isinstance(response, dict) or response.get("type") != "team-model-result"
                    or response.get("requestId") != request_id or response.get("ok") is not True
                    or set(response) != {"type", "requestId", "ok", "status", "body"}):
                raise ValueError()
            status = response["status"]
            result = base64.b64decode(response["body"], validate=True)
            if (type(status) is not int or not 200 <= status <= 599 or 300 <= status < 400
                    or len(result) > MAX_BODY or base64.b64encode(result).decode("ascii") != response["body"]):
                raise ValueError()
            return status, result
        except Exception:
            self.stop()
            raise RuntimeError("Team model channel unavailable") from None
        finally:
            self.lock.release()

    async def exchange_async(self, route, body):
        try:
            return await asyncio.to_thread(self.exchange, route, body)
        except asyncio.CancelledError:
            self.stop()
            raise
