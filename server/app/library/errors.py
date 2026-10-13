"""错误种类(spec §6.6)与接口的固定英文错误文本。

- `KINDS`(= `PERMANENT | LINK | TRANSIENT`)是能写进 `library_items.error_kind` 的全部取值:英文常量,只存种类,
  不存上游文本;网页用映射表翻成中文。
- `ADMIT` 是新建条目被拒的原因码(只出现在 HTTP 响应里,永不入库);`LibraryError` 两种都接受。
- `API_ERRORS` / `http_error`:接口错误的状态码与固定英文串(`{"error": ...}`),契约夹具把它录给网页的
  `LIBRARY_SERVER_ERRORS`。计划 S2 的 `POST /imports` 也经 `http_error` 转换准入错误。
"""
from fastapi import HTTPException

PERMANENT = frozenset({
    "too_large", "too_long", "quota", "corrupt", "no_audio", "bad_subtitle", "no_subtitles", "disk_full",
    "unsupported_format", "upload_expired",
})
LINK = frozenset({
    "link_disabled", "bad_url", "drm", "private", "geo_blocked", "login_required", "blocked", "playlist_unsupported",
    "live_unsupported", "unsupported_site", "ytdlp_failed",
})
TRANSIENT = frozenset({"upstream", "network", "ytdlp_transient"})
ALL = PERMANENT | LINK | TRANSIENT
KINDS = ALL
ADMIT = frozenset({"unavailable", "max_items", "quota", "uploads", "daily"})

API_ERRORS: dict[str, tuple[int, str]] = {
    "disabled": (404, "Library is disabled"),
    "not_found": (404, "Not Found"),
    "unavailable": (503, "Media tools are not installed"),
    "format": (400, "Unsupported file type"),
    "too_large": (413, "File is too large"),
    "chunk_too_large": (413, "Chunk is too large"),
    "quota": (409, "Library storage quota reached"),
    "max_items": (409, "Library item limit reached"),
    "uploads": (409, "Too many uploads in progress"),
    "daily": (429, "Daily import limit reached"),
    "not_uploading": (409, "Upload is not in progress"),
    "unexpected_chunk": (409, "Unexpected chunk"),
    "chunk_size": (400, "Wrong chunk size"),
    "chunk_required": (400, "Chunk is required"),
    "incomplete": (409, "Upload is incomplete"),
    "upload_expired": (409, "Upload expired"),
    "file_required": (400, "Subtitle file is required"),
    "bad_subtitle": (400, "Invalid subtitle file"),
    "subs_state": (409, "Subtitles cannot be changed now"),
    "not_ready": (409, "Item is not ready"),
    "not_failed": (409, "Item has not failed"),
    "no_material": (409, "Nothing left to retry"),
    "not_active": (409, "Item cannot be canceled"),
    "no_changes": (400, "No changes"),
    "bad_resume": (400, "Invalid resume position"),
    "bad_text": (400, "Invalid sentence text"),
    "bad_times": (400, "Invalid sentence times"),
    "segment_missing": (404, "Sentence not found"),
    "assessment": (400, "Assessment does not match"),
    "ticket": (401, "Invalid ticket"),
    # D8:译文与分析
    "ai_disabled": (404, "AI is disabled"),
    "language": (400, "Unsupported language"),
    "ai_user_cap": (429, "Daily analysis limit reached"),
    "ai_global_cap": (429, "Daily AI limit reached"),
    "ai_unavailable": (503, "AI is unavailable"),
}


class LibraryError(Exception):
    """A pipeline stage failed with one of `KINDS`, or a new item was refused with one of `ADMIT`.
    The message is the code itself, never upstream text."""

    def __init__(self, kind: str):
        if kind not in ALL and kind not in ADMIT:
            raise ValueError(f"unknown library error kind: {kind}")
        super().__init__(kind)
        self.kind = kind


class Aborted(Exception):
    """The item was canceled or deleted while its job ran: stop quietly, clean up, write nothing."""


def is_transient(kind: str | None) -> bool:
    return kind in TRANSIENT


def api_error(code: str) -> HTTPException:
    status, text = API_ERRORS[code]
    return HTTPException(status, text)


def http_error(err: LibraryError) -> HTTPException:
    """A refused new item (or any library error that reaches an endpoint) as the fixed HTTP error."""
    status, text = API_ERRORS.get(err.kind, (400, "Invalid request"))
    return HTTPException(status, text)
