import json

MAX_BODY_BYTES = 1024 * 1024


class BodyLimitMiddleware:
    """拒绝声明长度超过 1 MiB 的非 multipart 请求(multipart 的转写上传有自己的 25 MiB 校验)。"""

    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = {k: v for k, v in scope["headers"]}
            declared = headers.get(b"content-length", b"")
            ctype = headers.get(b"content-type", b"").lower()
            if (
                declared.isdigit()
                and int(declared) > self.max_bytes
                and not ctype.startswith(b"multipart/form-data")
            ):
                body = json.dumps({"error": "Request body too large"}).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
