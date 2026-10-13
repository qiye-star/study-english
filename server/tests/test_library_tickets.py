"""媒体票据(spec §10)。"""
from app.library.tickets import MediaTicketStore

ITEM = "0f0e0d0c-0b0a-4908-8706-050403020100"
OTHER = "11111111-2222-4333-8444-555555555555"


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_a_ticket_is_reusable_until_it_expires_and_bound_to_its_item():
    clock = Clock()
    store = MediaTicketStore(ttl_seconds=1800, clock=clock)
    token = store.issue(7, ITEM)
    assert len(token) >= 40 and store.resolve(token, ITEM) == 7 and store.resolve(token, ITEM) == 7
    assert store.resolve(token, OTHER) is None
    clock.t += 1799
    assert store.resolve(token, ITEM) == 7
    clock.t += 1
    assert store.resolve(token, ITEM) is None and len(store) == 0


def test_unknown_empty_and_oversized_tokens():
    store = MediaTicketStore()
    assert store.resolve(None, ITEM) is None and store.resolve("", ITEM) is None
    assert store.resolve("x" * 129, ITEM) is None and store.resolve("nope", ITEM) is None


def test_capacity_evicts_the_oldest():
    store = MediaTicketStore(capacity=3)
    tokens = [store.issue(1, ITEM) for _ in range(4)]
    assert len(store) == 3
    assert store.resolve(tokens[0], ITEM) is None and store.resolve(tokens[3], ITEM) == 1


def test_expired_tickets_are_pruned_on_issue_and_revoke_by_item():
    clock = Clock()
    store = MediaTicketStore(ttl_seconds=10, clock=clock)
    store.issue(1, ITEM)
    clock.t += 11
    keep = store.issue(2, OTHER)
    assert len(store) == 1
    store.issue(2, ITEM)
    assert store.revoke_item(ITEM) == 1 and store.resolve(keep, OTHER) == 2
