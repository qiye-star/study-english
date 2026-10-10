"""单词操作位置(spec §6.1):「加入词书学习」与「查看词卡」。

不写 learn 事件、不得段位点、不推进书序游标(L-R8);也不受每日新词目标 daily_new 限制(owner ruling:加入的是
立即到期的 box 0 复习词条,不是今天的新词)。只读写本请求自己的会话;不打日志。
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session
from app.links.gate import require_link
from app.links.spec import LinkSpec, WordIn
from app.models import User, utcnow
from app.services.vocabulary import validate_word
from app.wordbook import service, store
from app.wordbook.books import enabled_books
from app.wordbook.index import DataUnavailable, dictionary

KEY = "word_actions"
DISABLED = "Wordbook is disabled"
UNAVAILABLE = "Wordbook data unavailable"
NOT_FOUND = "Word not found"

router = APIRouter(prefix="/wordbook")


def _wordbook_on(request: Request):
    settings = request.app.state.settings
    if not settings.wordbook_enabled:
        raise HTTPException(404, DISABLED)
    return settings


@router.post("/adopt")
async def adopt(payload: WordIn, request: Request, user: User = Depends(require_link(KEY, limited=True)),
                session: AsyncSession = Depends(get_session)):
    settings = _wordbook_on(request)
    e = await store.active_enrollment(session, user.id)
    if e is None or e.book_id not in enabled_books(settings.wordbook_books):
        return {"status": "not_in_book", "book_id": None}
    ds = dictionary(request.app)
    await service.ensure_hidden(session, ds)
    try:
        card = await ds.card(e.book_id, payload.word)
    except DataUnavailable:
        raise HTTPException(503, UNAVAILABLE) from None
    if card is None:
        return {"status": "not_in_book", "book_id": e.book_id}
    if await store.known_one(session, user.id, card.key) is not None:  # 任何来源的词条都算(R-W3)
        return {"status": "known", "book_id": e.book_id}
    now = utcnow()
    await store.create_item(session, user.id, e.book_id, card, box=0, due_at=now, now=now)
    await session.commit()
    return {"status": "added", "book_id": e.book_id}


@router.get("/card")
async def card(request: Request, word: str = Query(min_length=1, max_length=200),
               user: User = Depends(require_link(KEY)), session: AsyncSession = Depends(get_session)):
    settings = _wordbook_on(request)
    try:
        key = validate_word(word)
    except ValueError:
        raise HTTPException(422, "Invalid word") from None
    ds = dictionary(request.app)
    await service.ensure_hidden(session, ds)
    e = await store.active_enrollment(session, user.id)
    enabled = enabled_books(settings.wordbook_books)
    books = [e.book_id] if e is not None and e.book_id in enabled else []
    books += [b for b in enabled if b not in books]
    unavailable = 0
    for book_id in books:  # 同 service.find_card 的顺序,但要返回书 id
        try:
            found = await ds.card(book_id, key)
        except DataUnavailable:
            unavailable += 1
            continue
        if found is not None:
            item = await store.known_one(session, user.id, found.key)
            return {"book_id": book_id, "card": service.card_out(found), "item": service.item_out(item)}
    if books and unavailable == len(books):  # Ruling(L1-1):所有启用的书都读不到 → 503,而不是假装「没有这个词」
        raise HTTPException(503, UNAVAILABLE)
    raise HTTPException(404, NOT_FOUND)


SPEC = LinkSpec(KEY, "单词操作位置", "Word actions", router=router)
