"""Object storage layer (plan 2026-10-21-l1-object-storage). Callers use `BlobStore` only; boto3 lives in `s3.py`."""
from app.storage.base import BlobInfo, BlobNotFound, BlobStore, RangeStream, StorageError
from app.storage.keys import ROOTS, check_key, check_prefix, join


def get_store(app) -> BlobStore:
    """The store the app is currently using. Never cached: tests swap `app.state.storage`."""
    return app.state.storage


__all__ = [
    "BlobInfo", "BlobNotFound", "BlobStore", "RangeStream", "StorageError",
    "ROOTS", "check_key", "check_prefix", "join", "get_store",
]
