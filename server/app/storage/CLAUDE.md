# app/storage/

Object storage (plan `docs/superpowers/plans/10.21-plans/2026-10-21-l1-object-storage.md`; spec `docs/superpowers/specs/2026-10-21-object-storage-fsrs-dubbing-design.md` §1, §5, §6). The bottom I/O layer: it imports `app.core` and `app.models` only, and is imported by `services`, `realtime`, `rooms`, `library`, `admin`, `routers` and `main`.

## What lives here
- `base.py` – `BlobStore` protocol, `BlobInfo`, `RangeStream`, `StorageError` (`code`: unavailable | denied | integrity | too_large | bad_config) and `BlobNotFound` (also a `FileNotFoundError`)
- `keys.py` – the key rules: `/`-separated, ASCII, ≤ 512 bytes, first segment in `ROOTS`, no staging keys (`library/_tmp/…`, `library/_catalog/_tmp/…`); prefixes end with `/`
- `local.py` – `LocalStore(root)`: files under the data directory; writes go through `.part` and `os.replace`; `put_file` hard-links when it can. `path_of` is local-only (for `FileResponse`)
- `s3.py` – `S3Store`: boto3 with `asyncio.to_thread`; sha256 as object metadata; errors mapped by class and code, never by message. The only module (with `config.py`) that imports boto3
- `http.py` – `blob_response(store, key, request, …)`: local keeps `FileResponse`; other stores stream with 206 / 416 / 400 / If-Range; the route checks its ticket and rows first
- `fallback.py` – `FallbackStore(primary, secondary)`: reads fall back, writes and deletes touch the primary only, `hits` counts reads served by the secondary
- `config.py` – `build_store(settings, profile)`, `validate`, `install(app)` (sets `app.state.storage`, registers the 503 / 404 / 500 handler for `StorageError`)
- `manifest.py`, `migrate.py`, `reconcile.py` – the migration command (`python -m app.storage.migrate`): an append-only JSONL manifest of keys and digests; copy with size and sha256 checks; backup first; reconcile after; never deletes

## Pitfalls
- Callers get the store with `get_store(app)` (or `app.state.storage` in the library accessors) on every call. Never cache it: tests and the fallback swap it.
- Put before commit, delete after commit (never a prefix for a single item). A failed commit deletes only the keys that the same run wrote. `drop_persistent` never raises.
- Staging stays local: `_tmp` dirs, `chunks.json`, WAVs. Anything a retry needs from a previous run is stored (`room_audio/_staging/`) or re-downloaded with `download_to`.
- K10: `LocalStore.put_file` hard-links the source. After a put, the staging file may only be deleted, never rewritten; the stored object would change with it.
- Logs carry the op and the code (`storage op=… code=…`, `library delete failed op=… code=…`), never keys, bucket names, endpoints, file names, user ids or presigned URLs. botocore is pinned to WARNING in `S3Store.from_settings`.
- `path_of` and `FileResponse` stay in this package; `tests/test_architecture.py` enforces the boto3 isolation and the allowlists (`FILE_RESPONSE_ALLOWED`, `DATA_DIR_ALLOWED`).
- The migration output and the manifest and report files hold counts or keys: the output never prints keys; the manifest and the `--report` file are operator files (mode 0600 where supported), not logs.
- Key formulas here are copies of `app.library.paths`, `app.services.avatars` and `app.admin.backups`; `tests/test_storage_reconcile.py` pins them equal. Change both sides together.
