"""七本词书的目录与数据目录解析(spec §2.2、§3)。纯数据,无 I/O(default_data_dir 只算路径)。"""
from dataclasses import dataclass
from pathlib import Path

SOURCE_DIR = "kylebing-english-vocabulary"


@dataclass(frozen=True)
class BookSpec:
    id: str
    title_zh: str
    title_en: str
    level: int  # 1 = easiest; only a proxy for difficulty (no frequency data)
    cefr: str
    file: str
    entries: int  # lines in the file
    unique: int  # distinct headwords before cleaning


BOOKS: tuple[BookSpec, ...] = (
    BookSpec("junior", "初中", "Junior high", 1, "A2", "junior.jsonl", 3223, 1987),
    BookSpec("senior", "高中", "Senior high", 2, "B1", "senior.jsonl", 6008, 3743),
    BookSpec("cet4", "四级", "CET-4", 3, "B1+", "cet4.jsonl", 7508, 4544),
    BookSpec("cet6", "六级", "CET-6", 4, "B2", "cet6.jsonl", 5651, 3991),
    BookSpec("kaoyan", "考研", "Postgraduate", 4, "B2", "kaoyan.jsonl", 9602, 5047),
    BookSpec("toefl", "托福", "TOEFL", 5, "C1", "toefl.jsonl", 13477, 10367),
    BookSpec("sat", "SAT", "SAT", 6, "C1", "sat.jsonl", 8887, 4464),
)
BOOK_IDS: tuple[str, ...] = tuple(b.id for b in BOOKS)
_BY_ID = {b.id: b for b in BOOKS}

# spec §2.6 / §2.11-2:读取时丢弃的词头(规范化键)
DENYLIST = frozenset({"undersize d", "sulfur disoxide", "aluminumal", "phosphorusp", "oxygen o", "iron fe", "rusia"})
POS_ABBREVIATIONS = frozenset({"a.", "adj.", "n.", "v.", "adv.", "vt.", "vi.", "prep."})


def book_by_id(book_id: str) -> BookSpec | None:
    return _BY_ID.get(book_id)


def enabled_books(csv: str) -> tuple[str, ...]:
    wanted = {part.strip() for part in csv.split(",") if part.strip()}
    return tuple(b for b in BOOK_IDS if b in wanted)


def default_data_dir() -> Path:
    """server/app/wordbook/books.py -> server/dictionaries/<SOURCE_DIR>;容器里 /app/app/... -> /app/dictionaries/..."""
    return Path(__file__).resolve().parents[2] / "dictionaries" / SOURCE_DIR
