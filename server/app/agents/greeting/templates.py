"""Template greeting (plan 2026-10-23 §6.3): exactly 3 items, same shape and invariants as a model answer.

Used when the model is off, over budget, down or answered badly. Pure functions: the same facts always give the same lines
(the warm closing phrase is picked from a hash of user and day, so it is stable within a day and varies across days).
Chinese mode never contains Latin letters; the slip's original words appear only in English and bilingual output."""
import hashlib
from datetime import datetime

from app.agents.greeting.facts import GreetingFacts
from app.agents.greeting.parse import GreetingInvalid, check_lines

PRACTICE_MINUTES = 10
NUMBER_MAX = 9999
GRAMMAR_CATEGORY_ZH = {"tense": "时态", "agreement": "主谓一致", "article": "冠词", "preposition": "介词",
                       "word_choice": "用词", "word_order": "语序", "plural": "单复数", "spelling": "拼写"}
GRAMMAR_CATEGORY_EN = {"tense": "verb tense", "agreement": "subject-verb agreement", "article": "articles",
                       "preposition": "prepositions", "word_choice": "word choice", "word_order": "word order",
                       "plural": "plural forms", "spelling": "spelling"}
UNKNOWN_CATEGORY = ("语法", "grammar")
WEEKDAY_ZH = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")
WEEKDAY_EN = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
TAILS_ZH = ("这份坚持真的很了不起", "一点一滴都在积累", "慢慢来，你一直在进步")
TAILS_EN = ("that steady effort really adds up", "every bit of practice counts", "you're making real progress")


def time_of_day(hour: int) -> tuple[str, str, str, str]:
    """(greeting zh, part zh, greeting en, part en); the same boundaries as the approved demo page."""
    if 5 <= hour < 11:
        return "早上好", "上午", "Good morning", "morning"
    if 11 <= hour < 13:
        return "中午好", "中午", "Good afternoon", "midday"
    if 13 <= hour < 18:
        return "下午好", "下午", "Good afternoon", "afternoon"
    if 18 <= hour < 23:
        return "晚上好", "晚上", "Good evening", "evening"
    return "夜深了", "深夜", "Still up", "night"


def _n(value: int) -> int:
    return min(int(value), NUMBER_MAX)


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _slip(facts: GreetingFacts):
    """(kind, zh, en, sub) of yesterday's slip, first available of: grammar with pair, grammar, words; else None."""
    pair = facts.pair()
    if facts.slip_category and facts.slip_count:
        n = _n(facts.slip_count)
        zh_cat, en_cat = (GRAMMAR_CATEGORY_ZH.get(facts.slip_category, UNKNOWN_CATEGORY[0]),
                          GRAMMAR_CATEGORY_EN.get(facts.slip_category, UNKNOWN_CATEGORY[1]))
        zh = f"昨天在{zh_cat}上出了 *{n} 处小错*"
        if pair:
            wrong, right = pair
            return ("grammar", zh, f"yesterday's slip was *{wrong}* — the right form is *{right}*",
                    f"昨天的错点：{wrong} → {right}", zh_cat, en_cat)
        return ("grammar", zh, f"yesterday you made *{_count(n, 'small slip', 'small slips')}* with {en_cat}",
                f"昨天{zh_cat}错了 {n} 处", zh_cat, en_cat)
    words = (facts.wrong_words or 0) + (facts.pron_words or 0)
    if words:
        n = _n(words)
        return ("words", f"昨天有 *{n} 个词* 还没完全掌握", f"*{_count(n, 'word', 'words')}* tripped you up yesterday",
                f"昨天有 {n} 个词没掌握", "", "")
    return None


def _opening(facts, include_stats, hello, wd_zh, wd_en, tail_zh, tail_en):
    gz, pz, ge, pe = hello
    if not include_stats:
        return (f"{gz}！这个{wd_zh}{pz}，很高兴又见到你，我们一起轻松练一会儿英语吧。",
                f"{ge}! It's {wd_en} {pe}, and it's good to see you — let's enjoy some easy English together.",
                f"{gz}！{wd_zh}{pz}，很高兴又见到你。")
    if facts.streak:
        s = _n(facts.streak)
        return (f"{gz}！这个{wd_zh}{pz}，你已经连续学了 *{s} 天*，{tail_zh}。",
                f"{ge}! It's {wd_en} {pe}, and you're on a *{s}-day streak* — {tail_en}.",
                f"{gz}！{wd_zh}{pz}，你已连续学习 {s} 天。")
    return (f"{gz}！这个{wd_zh}{pz}是个*新的开始*，今天练一会儿，就是连续学习的第一天。",
            f"{ge}! It's {wd_en} {pe} — a *fresh start*, and a little practice today makes it day one.",
            f"{gz}！{wd_zh}{pz}，今天就是新的第一天。")


def _review(facts, include_stats, slip):
    if not include_stats:
        return ("今天不看数据，只管轻松地说英语，说错了也完全没关系。",
                "Today is just about enjoying some easy English together — mistakes are completely fine.",
                "今天只管轻松说，说错也没关系。")
    due = _n(facts.due) if facts.due else 0
    if due and slip:
        return (f"今天有 *{due} 个单词* 等你复习；{slip[1]}，今天我们把它彻底说对。",
                f"You have *{_count(due, 'word', 'words')}* due for review, and {slip[2]}.",
                f"{due} 个单词待复习；{slip[3]}。")
    if due:
        return (f"今天有 *{due} 个单词* 等你复习；昨天没有要补的错点，状态很稳。",
                f"You have *{_count(due, 'word', 'words')}* due for review today, and yesterday went smoothly with no "
                f"slips to fix.",
                f"{due} 个单词待复习；昨天没有错点。")
    if slip:
        return (f"今天没有待复习的单词；{slip[1]}，正好用今天把它补上。",
                f"Nothing is due for review today, and {slip[2]} — a good chance to fix it.",
                f"今天没有待复习；{slip[3]}。")
    return ("今天没有待复习的单词，昨天也没有要补的错点，正好轻松练练口语。",
            "Nothing is due for review and there are no slips to fix, so it's a great day for relaxed speaking.",
            "今天没有待复习，也没有错点。")


def _plan(facts, include_stats, slip):
    m = PRACTICE_MINUTES
    due = _n(facts.due) if facts.due and include_stats else 0
    if include_stats and slip and slip[0] == "grammar":
        zh_cat, en_cat = slip[4], slip[5]
        if due:
            return (f"建议先花 *{m} 分钟*：围绕{zh_cat}说三句和你有关的话，再把待复习的单词过一遍。",
                    f"Today, let's spend *{m} minutes* on three sentences about your life using {en_cat}, then clear "
                    f"your review list.",
                    f"今天先花 {m} 分钟围绕{zh_cat}说三句话，再过一遍单词。")
        return (f"建议先花 *{m} 分钟*：围绕{zh_cat}说三句和你有关的话，说完我陪你逐句看看。",
                f"Today, let's spend *{m} minutes* on three sentences about your life using {en_cat}, and I'll check "
                f"each one with you.",
                f"今天先花 {m} 分钟围绕{zh_cat}说三句话。")
    if include_stats and slip:
        return (f"建议先花 *{m} 分钟*：把昨天没掌握的词各用一句话说出来，再轻松收尾。",
                f"Today, let's spend *{m} minutes* using each word that tripped you up yesterday in one sentence of "
                f"your own.",
                f"今天先花 {m} 分钟把昨天的词各说一句。")
    if due:
        return (f"建议先花 *{m} 分钟* 把 {due} 个单词过一遍，再挑两个词各说一句关于今天的话。",
                f"Today, let's spend *{m} minutes* clearing your {_count(due, 'review word', 'review words')}, then use "
                f"two of them in sentences about your day.",
                f"今天先花 {m} 分钟复习单词，再用两个词各说一句。")
    return (f"建议花 *{m} 分钟* 用英语聊聊你今天的计划，想到哪说到哪，我帮你说得更地道。",
            f"Today, let's spend *{m} minutes* talking about your plans in English — say it your way, and I'll help "
            f"polish it.",
            f"今天花 {m} 分钟用英语聊聊你的计划。")


def _build(language: str, facts: GreetingFacts, include_stats: bool, local_now: datetime, user_id: int) -> list[dict]:
    hello = time_of_day(local_now.hour)
    weekday = local_now.weekday()
    digest = hashlib.sha256(f"{user_id}:{local_now.date().isoformat()}".encode()).digest()
    pick = digest[0] % len(TAILS_ZH)
    slip = _slip(facts) if include_stats else None
    rows = (_opening(facts, include_stats, hello, WEEKDAY_ZH[weekday], WEEKDAY_EN[weekday], TAILS_ZH[pick], TAILS_EN[pick]),
            _review(facts, include_stats, slip), _plan(facts, include_stats, slip))
    if language == "zh":
        return [{"zh": zh} for zh, _en, _sub in rows]
    if language == "en":
        return [{"en": en} for _zh, en, _sub in rows]
    return [{"en": en, "zh": sub} for _zh, en, sub in rows]


def template_lines(language: str, facts: GreetingFacts, *, include_stats: bool, local_now: datetime,
                   user_id: int) -> list[dict]:
    """The three paragraphs for `language` (zh / en / bilingual). `local_now` is the user's local wall-clock time.
    With include_stats False the facts are ignored altogether. A quoted slip that breaks a rule is dropped, not shipped."""
    lines = _build(language, facts, include_stats, local_now, user_id)
    if check_lines(lines, language):
        lines = _build(language, GreetingFacts(**{**facts.__dict__, "slip_wrong": None, "slip_right": None}),
                       include_stats, local_now, user_id)
    reason = check_lines(lines, language)
    if reason:
        raise GreetingInvalid(reason)
    return lines
