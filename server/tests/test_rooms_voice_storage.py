"""Room voice clips and staging WAVs in the object store (plan L1 Task 13): both backends, and the admin playback only
serves `room_audio/` keys (never assessment recordings)."""
import pytest

from app.rooms import audio
from app.routers.admin_rooms import _read_audio
from app.storage import BlobNotFound
from app.storage.local import LocalStore
from tests.storage_helpers import moto_bucket, s3_store

CLIP = b"\xff\xf3" + b"clip" * 10
ROOM = "7c9e6679-7425-4f00-8000-000000000001"
MESSAGE = "9b2e6679-7425-4f00-8000-000000000002"


@pytest.fixture(params=["local", "s3"])
def blobs(request, tmp_path):
    if request.param == "local":
        yield LocalStore(tmp_path / "data")
        return
    with moto_bucket() as bucket:
        yield s3_store(bucket)


async def test_a_clip_round_trips_and_a_staging_wav_is_removed(blobs):
    stored = audio.audio_relpath(ROOM, MESSAGE, "mp3")
    staging = audio.staging_relpath(MESSAGE)
    await audio.write_file(blobs, stored, CLIP)
    await audio.write_file(blobs, staging, b"RIFF-staging")
    assert await audio.read_file(blobs, stored) == CLIP
    await audio.delete_file(blobs, staging)
    with pytest.raises(BlobNotFound):
        await audio.read_file(blobs, staging)
    assert await audio.read_file(blobs, stored) == CLIP  # clips are kept


async def test_an_oversized_read_is_refused(blobs):
    key = audio.audio_relpath(ROOM, MESSAGE, "mp3")
    await blobs.put_bytes(key, b"x" * (audio.MAX_UPLOAD_BYTES + 1))
    with pytest.raises(Exception):  # StorageError too_large
        await audio.read_file(blobs, key)


async def test_admin_playback_serves_only_room_audio_keys(blobs):
    await blobs.put_bytes("recordings/1/a.wav", b"RIFF-assessment")
    await audio.write_file(blobs, audio.audio_relpath(ROOM, MESSAGE, "mp3"), CLIP)
    assert await _read_audio(blobs, "recordings/1/a.wav") is None
    assert await _read_audio(blobs, "room_audio/../recordings/a.wav") is None
    assert await _read_audio(blobs, audio.audio_relpath(ROOM, MESSAGE, "mp3")) == CLIP
    assert await _read_audio(blobs, "room_audio/missing/x.mp3") is None
