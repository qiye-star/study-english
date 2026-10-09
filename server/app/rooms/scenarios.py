"""Room scenario pool (spec 2026-10-10 §3.3, R2-3): a static server table, not edited from the admin console.
Keys match the chat page presets plus `free`. `brief` goes into the assistant / @ai / summary prompts and is never
sent to the web (`GET /api/rooms/config` only lists key and titles). Pure."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Scenario:
    key: str
    title_zh: str
    title_en: str
    brief: str


SCENARIOS: tuple[Scenario, ...] = (
    Scenario("free", "自由聊天", "Free talk", "Free conversation; any everyday topic."),
    Scenario("cafe", "咖啡店点单", "At a café",
             "A busy coffee shop. Members take turns as the barista and customers ordering drinks and snacks."),
    Scenario("interview", "求职面试", "Job interview",
             "A job interview. One member is the interviewer; the others answer common interview questions."),
    Scenario("airport", "机场入境", "At the airport",
             "Passport control and baggage claim. Members play officers and travellers."),
    Scenario("hotel", "酒店入住", "Hotel check-in",
             "A hotel front desk. Members play receptionists and guests checking in or asking for help."),
    Scenario("doctor", "看医生", "At the doctor's",
             "A family doctor's office. Members describe symptoms and give simple advice "
             "(practice only, no real medical advice)."),
    Scenario("renting", "租房看房", "Renting a flat",
             "Viewing an apartment. Members play landlords and tenants asking about rent and rules."),
    Scenario("directions", "问路", "Asking for directions",
             "A city street. Members ask for and give directions with landmarks and transport."),
    Scenario("smalltalk", "社交闲聊", "Small talk",
             "A community event where people just met: hobbies, work, food, travel and weekend plans."),
)
_BY_KEY = {s.key: s for s in SCENARIOS}
DEFAULT_SCENARIO = "free"


def scenario(key: str) -> Scenario | None:
    return _BY_KEY.get(key)


def brief(key: str) -> str:
    """The scenario's prompt brief; unknown keys fall back to `free`."""
    return (_BY_KEY.get(key) or _BY_KEY[DEFAULT_SCENARIO]).brief
