# app/speech/

Speech-to-text for uploads, hold-to-talk and realtime calls.

## What lives here
- `asr_stream.py` – Volcengine streaming ASR: frame codec, `AsrGate` (concurrency + breaker), `transcribe_pcm`
- `asr_realtime.py` – long-lived streaming recognizer for calls (partials)
- `asr.py` – per-utterance recognizer abstraction; stream first, chat/Whisper fallback (R3/R25)
- `stt.py` – chat-model / Whisper transcription over the upstream LLM API
- `realtime_asr.py` – the one place callers ask which recognizer a call uses (re-exports the
  predicates that live in `app.core.config`)
- `sentence_split.py` – incremental sentence splitter for streamed LLM text

## Allowed dependencies
`app.core`, `app.models`, `app.providers`. Never services/realtime/routers.
Inside: `asr` -> `asr_stream`, never the reverse (tests scan the source for this).

## Entry points
`make_transcriber`, `realtime_factory`, `shared_asr_gate`, `transcribe_pcm`, `transcribe_wav`,
`effective_realtime_asr`, `SentenceSplitter`.

## Tests
`uv run pytest -q tests/test_asr_stream.py tests/test_asr_buffered.py tests/test_asr_realtime.py tests/test_stt_prompt.py tests/test_sentence_split.py`

## Pitfalls
- Never log transcripts or keys; log kinds, ids, durations.
- The websockets library loggers are pinned to `app.asr_*.websockets` at INFO (debug would leak frames).
- `tests/fixtures/sentence_cases.json` is shared with the web client's splitter: change both together.
