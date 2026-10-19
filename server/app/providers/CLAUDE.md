# app/providers/

Clients for external vendors. Pure I/O + protocol code; no web framework.

## What lives here
- `volcengine.py` – Volcengine (Doubao) TTS: one-shot and chunked streaming synthesis
- `azure.py` – Azure Speech: token issuing (cached), SSML TTS
- `xfyun.py` – iFlytek ISE pronunciation assessment over WebSocket (signed URL)
- `xfyun_result.py` – converts ISE XML into the assessment JSON the clients expect
- `llm.py` – chat completion: `complete` (non-streaming, rank and rooms), `complete_stream` (async iterator of
  `Delta` text / reasoning / usage, for agents; closing the iterator closes the upstream response; total deadline
  `STREAM_TOTAL_SECONDS` = 120 s -> `LlmUnavailable("timeout")`; an in-band `{"error": ...}` chunk -> `LlmUnavailable("upstream")`, body never logged), `probe_tools`
  (native function calling probe), `LlmUnavailable(kind, status)`
- `email.py` – outbound mail: `EmailSender` protocol, `SmtpSender` (smtplib in a thread, 10 s timeout), `ConsoleSender`, `FakeSender` (tests), `sender_for(settings, override)`, `check(settings)` (connect + login, no send); `EmailError(code, status)` carries a fixed code only, never an address, body or password

## Allowed dependencies
`app.core` only (plus stdlib/httpx/websockets). Never FastAPI/Starlette (enforced by
`tests/test_architecture.py`): raise vendor-specific exceptions (`AzureError`, `XfyunError`,
`VolcengineError`) and let routers map them to HTTP. FastAPI getters that cache a client on
`app.state` live in `app/services/provider_clients.py`.

## Entry points
`synthesize`, `synthesize_stream`, `AzureSpeech`, `XfyunIse`, `to_assessment`.

## Tests
`uv run pytest -q tests/test_volcengine_tts.py tests/test_tts_stream.py tests/test_azure.py tests/test_xfyun.py tests/test_xfyun_result.py tests/test_llm_stream.py tests/test_llm_probe_tools.py tests/test_email_provider.py`

## Pitfalls
- Keys and signed URLs are secrets: never log them; log error kinds/status codes only.
- `email.py` never logs the recipient address, subject, body, SMTP user or password (the only log line is `email sent purpose=<kind>`); `EmailError` carries a fixed code only. The SMTP host is not DNS-pinned: `smtplib` resolves it again on connect (the admin probe checks the address first; see the email notes in `server/README.md`).
- Tests mock HTTP with respx / fake sockets; never hit real vendors in pytest.
