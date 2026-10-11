# app/providers/

Clients for external vendors. Pure I/O + protocol code; no web framework.

## What lives here
- `volcengine.py` – Volcengine (Doubao) TTS: one-shot and chunked streaming synthesis
- `azure.py` – Azure Speech: token issuing (cached), SSML TTS
- `xfyun.py` – iFlytek ISE pronunciation assessment over WebSocket (signed URL)
- `xfyun_result.py` – converts ISE XML into the assessment JSON the clients expect
- `llm.py` – chat completion: `complete` (non-streaming, rank and rooms), `complete_stream` (async iterator of
  `Delta` text / reasoning / usage, for agents; closing the iterator closes the upstream response), `probe_tools`
  (native function calling probe), `LlmUnavailable(kind, status)`

## Allowed dependencies
`app.core` only (plus stdlib/httpx/websockets). Never FastAPI/Starlette (enforced by
`tests/test_architecture.py`): raise vendor-specific exceptions (`AzureError`, `XfyunError`,
`VolcengineError`) and let routers map them to HTTP. FastAPI getters that cache a client on
`app.state` live in `app/services/provider_clients.py`.

## Entry points
`synthesize`, `synthesize_stream`, `AzureSpeech`, `XfyunIse`, `to_assessment`.

## Tests
`uv run pytest -q tests/test_volcengine_tts.py tests/test_tts_stream.py tests/test_azure.py tests/test_xfyun.py tests/test_xfyun_result.py tests/test_llm_stream.py tests/test_llm_probe_tools.py`

## Pitfalls
- Keys and signed URLs are secrets: never log them; log error kinds/status codes only.
- Tests mock HTTP with respx / fake sockets; never hit real vendors in pytest.
