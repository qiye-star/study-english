"""配音接口的固定错误串(plan L5 S2)。契约夹具 `tests/fixtures/dubbing_contract.json` 把它录给网页;文本只能是固定英文,
不拼入任何用户数据(句子、角色名、文件名都不进错误串)。"""
from fastapi import HTTPException

API_ERRORS: dict[str, tuple[int, str]] = {
    "disabled": (404, "Dubbing is disabled"),
    "not_found": (404, "Not Found"),
    "not_ready": (409, "Item is not ready"),
    "roles_locked": (409, "Roles are set by the editors"),
    "bad_roles": (400, "Invalid roles"),
    "clip": (400, "Invalid clip"),
    "clip_too_long": (400, "Clip is too long"),
    "role_missing": (400, "Role has no lines in the clip"),
    "take_done": (409, "Take is finished"),
    "line_not_in_take": (400, "Line is not in the take"),
    "line_done": (409, "Line already recorded"),
    "assessment": (400, "Assessment does not match the line"),
    "timing": (400, "Invalid line timing"),
    "ai_unavailable": (503, "AI is unavailable"),
    "ai_user_cap": (429, "Daily AI limit reached"),
    "ai_global_cap": (429, "AI is busy today"),
}


def api_error(code: str) -> HTTPException:
    status, text = API_ERRORS[code]
    return HTTPException(status, text)
