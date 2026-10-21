"""L5 S5:句子的角色与角色名在库里的读写(plan L5 R3–R5)。角色名与句子都是用户内容,断言里只看形状与字母。"""
import pytest
from sqlalchemy import select

from app.library import catalog_store, roles, store
from app.library.segment import Sentence
from app.models import CatalogSegment, LibraryItem, LibrarySegment, User, utcnow
from tests.catalog_helpers import data_dir_of, make_catalog
from tests.library_helpers import library_settings

NOW = utcnow()


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_catalog_enabled=True)


async def _user(app, uid: int) -> int:
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=f"u{uid}", password_hash="x"))
        await s.commit()
    return uid


async def _owned_item(app, uid: int, texts: list[str], catalog_id: str | None = None) -> str:
    async with app.state.sessionmaker() as s:
        item = LibraryItem(user_id=uid, kind="audio", source="upload" if catalog_id is None else "catalog",
                           title="t", status="ready", seg_count=len(texts), catalog_id=catalog_id, created_at=NOW,
                           updated_at=NOW)
        s.add(item)
        await s.flush()
        s.add_all(LibrarySegment(item_id=item.id, idx=i, start_ms=i * 1000, end_ms=i * 1000 + 900, text=t)
                  for i, t in enumerate(texts))
        await s.commit()
        return item.id


# ---- pure output shape ----------------------------------------------------------

def test_roles_out_lists_names_sorted_and_every_sentence_speaker():
    segs = [LibrarySegment(idx=0, speaker="B"), LibrarySegment(idx=1, speaker=None)]
    out = roles.roles_out({"B": "Bob", "A": "Ann"}, segs, editable=True, locked=None)
    assert out == {"names": [{"key": "A", "name": "Ann"}, {"key": "B", "name": "Bob"}],
                   "speakers": [{"idx": 0, "speaker": "B"}, {"idx": 1, "speaker": None}],
                   "editable": True, "locked": None}


def test_roles_out_for_a_copy_is_read_only_and_says_the_catalog_locks_it():
    out = roles.roles_out(None, [], editable=False, locked="catalog")
    assert out == {"names": [], "speakers": [], "editable": False, "locked": "catalog"}


# ---- pure merge -----------------------------------------------------------------

def test_merge_rejects_bad_letters_names_and_indexes():
    current = {0: None, 1: None}
    bad_calls = [
        dict(names={"G": "x"}),
        dict(names={"A": "   "}),
        dict(names={"A": "x" * 25}),
        dict(speakers=[{"idx": 2, "speaker": "A"}]),
        dict(speakers=[{"idx": -1, "speaker": "A"}]),
        dict(speakers=[{"idx": "0", "speaker": "A"}]),
        dict(speakers=[{"idx": 0, "speaker": "Z"}]),
    ]
    for kwargs in bad_calls:
        with pytest.raises(ValueError, match="^roles$"):
            roles.merge({}, current, **kwargs)


def test_merge_accepts_all_six_letters_and_normalises_case():
    names, changes = roles.merge({}, {i: None for i in range(6)},
                                 names={k: f"name {k}" for k in "ABCDEF"},
                                 speakers=[{"idx": i, "speaker": k.lower()} for i, k in enumerate("ABCDEF")])
    assert sorted(names) == list("ABCDEF")
    assert changes == {i: k for i, k in enumerate("ABCDEF")}


def test_merge_keeps_only_used_or_explicitly_named_keys():
    current = {0: "A", 1: "B"}
    names, changes = roles.merge({"A": "Ann", "B": "Bob"}, current,
                                 speakers=[{"idx": 1, "speaker": None}])
    assert names == {"A": "Ann"}  # B is no longer used and not named in this call
    assert changes == {1: None}
    names, _ = roles.merge({"A": "Ann"}, {0: "A", 1: None}, names={"C": "Cy"})
    assert names == {"A": "Ann", "C": "Cy"}  # an explicit name is kept even when nobody speaks it


def test_merge_name_none_removes_the_name_and_collapses_spaces():
    names, _ = roles.merge({"A": "Ann"}, {0: "A"}, names={"A": None})
    assert names == {}
    names, _ = roles.merge({}, {0: "A"}, names={"A": "  Mr   Smith "})
    assert names == {"A": "Mr Smith"}


# ---- owned items ----------------------------------------------------------------

async def test_apply_updates_labels_and_names_partially(app, settings_overrides):
    uid = await _user(app, 11111111)
    item_id = await _owned_item(app, uid, ["One.", "Two.", "Three."])
    async with app.state.sessionmaker() as s:
        item = await store.get_owned(s, uid, item_id)
        await roles.apply(s, item, names={"A": "Ann", "B": "Bob"},
                          speakers=[{"idx": 0, "speaker": "A"}, {"idx": 1, "speaker": "B"}])
        await s.commit()
    async with app.state.sessionmaker() as s:
        item = await store.get_owned(s, uid, item_id)
        assert item.role_names == {"A": "Ann", "B": "Bob"}
        assert [x.speaker for x in await store.segments_of(s, item_id)] == ["A", "B", None]
        await roles.apply(s, item, speakers=[{"idx": 2, "speaker": "A"}])
        await s.commit()
        assert item.role_names == {"A": "Ann", "B": "Bob"}  # B is still used at idx 1
        assert [x.speaker for x in await store.segments_of(s, item_id)] == ["A", "B", "A"]
        await roles.apply(s, item, speakers=[{"idx": 1, "speaker": None}])
        await s.commit()
        assert item.role_names == {"A": "Ann"}  # B is gone from every sentence, so its name goes too


async def test_roles_out_of_an_owned_item_is_editable(app, settings_overrides):
    uid = await _user(app, 11111111)
    item_id = await _owned_item(app, uid, ["One.", "Two."])
    async with app.state.sessionmaker() as s:
        item = await store.get_owned(s, uid, item_id)
        out = roles.roles_out(item.role_names, await store.segments_of(s, item_id), editable=True, locked=None)
    assert out["editable"] is True and out["locked"] is None and out["names"] == []


# ---- re-segmenting keeps speakers -----------------------------------------------

@pytest.mark.parametrize("keep_ai", [False, True])
async def test_write_segments_inherits_speakers_by_text_in_order(app, settings_overrides, keep_ai):
    uid = await _user(app, 11111111)
    item_id = await _owned_item(app, uid, ["Hello there.", "How are you?", "Hello there."])
    async with app.state.sessionmaker() as s:
        seg_rows = await store.segments_of(s, item_id)
        seg_rows[0].speaker = "A"
        seg_rows[1].speaker = "B"
        seg_rows[2].speaker = "B"
        await s.commit()
    async with app.state.sessionmaker() as s:
        item = await store.get_owned(s, uid, item_id)
        await store.write_segments(s, item, [Sentence(0, 900, "Hello there."), Sentence(1000, 1900, "New line."),
                                             Sentence(2000, 2900, "Hello  there."), Sentence(3000, 3900, "How are you?"),
                                             Sentence(4000, 4900, "Hello there.")], keep_ai=keep_ai)
        await s.commit()
    async with app.state.sessionmaker() as s:
        rows = await store.segments_of(s, item_id)
        assert [x.speaker for x in rows] == ["A", None, "B", "B", None]


# ---- copies --------------------------------------------------------------------

async def test_add_to_library_copies_speakers_and_role_names(app, settings_overrides):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        row.role_names = {"A": "Host", "B": "Guest"}
        segs = await catalog_store.segments_of(s, cid)
        segs[0].speaker = "A"
        segs[1].speaker = "B"
        await s.commit()
    uid = await _user(app, 22222222)
    async with app.state.sessionmaker() as s:
        item, created = await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid, now=utcnow())
        assert created is True
        assert item.role_names == {"A": "Host", "B": "Guest"}
        assert [x.speaker for x in await store.segments_of(s, item.id)] == ["A", "B"]


async def test_sync_catalog_roles_moves_labels_to_every_copy_but_not_edited_sentences(app, settings_overrides):
    cid = await make_catalog(app)
    other = await make_catalog(app, title="Other talk")
    u1, u2 = await _user(app, 33333333), await _user(app, 44444444)
    async with app.state.sessionmaker() as s:
        for uid in (u1, u2):
            await catalog_store.add_to_library(s, data_dir_of(app), user_id=uid, catalog_id=cid, now=utcnow())
        await catalog_store.add_to_library(s, data_dir_of(app), user_id=u1, catalog_id=other, now=utcnow())
        await s.commit()
    async with app.state.sessionmaker() as s:
        # u1 edits the first sentence's text: its label must not follow the catalog
        copy_u1 = await s.scalar(select(LibraryItem).where(LibraryItem.user_id == u1, LibraryItem.catalog_id == cid))
        first = (await store.segments_of(s, copy_u1.id))[0]
        first.text = "Changed by the learner."
        catalog = await catalog_store.get(s, cid)
        catalog.role_names = {"A": "Host", "B": "Guest"}
        cat_segs = await catalog_store.segments_of(s, cid)
        cat_segs[0].speaker = "B"
        cat_segs[1].speaker = "A"
        await s.commit()
    async with app.state.sessionmaker() as s:
        assert await roles.sync_catalog_roles(s, cid) == 2
        await s.commit()
    async with app.state.sessionmaker() as s:
        copies = (await s.scalars(select(LibraryItem).where(LibraryItem.catalog_id == cid))).all()
        assert len(copies) == 2
        for copy in copies:
            assert copy.role_names == {"A": "Host", "B": "Guest"}
        by_user = {c.user_id: c for c in copies}
        edited = [x.speaker for x in await store.segments_of(s, by_user[u1].id)]
        followed = [x.speaker for x in await store.segments_of(s, by_user[u2].id)]
        assert edited == [None, "A"]
        assert followed == ["B", "A"]
        other_copy = await s.scalar(select(LibraryItem).where(LibraryItem.user_id == u1,
                                                              LibraryItem.catalog_id == other))
        assert other_copy.role_names is None  # another catalog item's copy is not touched


async def test_apply_catalog_sets_names_and_speakers_on_the_catalog(app, settings_overrides):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        await roles.apply_catalog(s, row, names={"A": "Host"}, speakers=[{"idx": 0, "speaker": "A"}])
        await s.commit()
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        assert row.role_names == {"A": "Host"}
        segs = await s.scalars(select(CatalogSegment).where(CatalogSegment.catalog_id == cid)
                               .order_by(CatalogSegment.idx))
        assert [x.speaker for x in segs] == ["A", None]
