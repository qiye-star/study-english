"""Server layering, enforced by an AST scan of every import in `app/` (plan Task 8).

    core       -> (nothing but itself and app.models, the ORM schema)
    providers  -> core                         (and never FastAPI/Starlette)
    speech     -> core, providers
    services   -> core, providers
    realtime   -> core, providers, speech, services
    rank       -> core, providers, speech, services
    rooms      -> core, providers, speech, services (rank and rooms never import each other)
    wordbook   -> core, providers, speech, services (a leaf: only admin, routers and main import it)
    links      -> core, providers, speech, services, rank, rooms, wordbook (top layer: only routers and main import it)
    admin      -> core, providers, speech, services, realtime, rank, rooms, wordbook (admin console logic)
    routers    -> anything below (and other routers)
    main       -> anything; nothing but main imports routers
                  (likewise only routers and main may import admin)

`app.models` sits beside core: it may import core only, and every layer may import it.
Lazy (function-level) imports count; so do `from app import x` and relative imports."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

LAYERS = ("core", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook", "links", "admin",
          "routers")
TOP_LEVEL = {"__init__", "main", "models"}

ALLOWED: dict[str, set[str]] = {
    "core": {"core", "models"},
    "models": {"core"},
    "providers": {"providers", "core"},
    "speech": {"speech", "core", "models", "providers"},
    "services": {"services", "core", "models", "providers"},
    "realtime": {"realtime", "core", "models", "providers", "speech", "services"},
    "rank": {"rank", "core", "models", "providers", "speech", "services"},
    "rooms": {"rooms", "core", "models", "providers", "speech", "services"},
    "wordbook": {"wordbook", "core", "models", "providers", "speech", "services"},
    "links": {"links", "core", "models", "providers", "speech", "services", "rank", "rooms", "wordbook"},
    "admin": {"admin", "core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook"},
    "routers": {"routers", "core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook",
                "admin", "links"},
    "main": {"core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook", "admin",
             "routers", "links"},
    "__init__": set(),
}
FORBIDDEN_THIRD_PARTY = {"providers": ("fastapi", "starlette")}


def module_name(path: Path, root: Path) -> str:
    rel = path.relative_to(root.parent).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def layer_of(module: str) -> str | None:
    """`app.core.config` -> "core", `app.models` -> "models", `app` -> "__init__"."""
    parts = module.split(".")
    if parts[0] != "app":
        return None
    if len(parts) == 1:
        return "__init__"
    return parts[1]


def imported_modules(tree: ast.AST, current: str, is_package: bool) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [(node.lineno, alias.name) for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = current.split(".") if is_package else current.split(".")[:-1]
                base = base[: len(base) - (node.level - 1)]
                target = ".".join(base + ([node.module] if node.module else []))
            else:
                target = node.module or ""
            if target == "app":  # `from app import recordings` names a module
                found += [(node.lineno, f"app.{alias.name}") for alias in node.names]
            else:
                found.append((node.lineno, target))
    return found


def violations(root: Path = APP) -> list[str]:
    problems: list[str] = []
    for path in sorted(root.rglob("*.py")):
        current = module_name(path, root)
        layer = layer_of(current)
        where = path.relative_to(root.parent).as_posix()
        if layer not in LAYERS and layer not in TOP_LEVEL:
            problems.append(f"{where}: module outside the known layers (put it in one of {LAYERS})")
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for lineno, target in imported_modules(tree, current, path.name == "__init__.py"):
            top = target.split(".")[0]
            if top in FORBIDDEN_THIRD_PARTY.get(layer, ()):
                problems.append(f"{where}:{lineno}: {layer} must not import {target}")
            target_layer = layer_of(target)
            if target_layer is None or target_layer == "__init__":
                continue
            if target_layer not in ALLOWED[layer]:
                problems.append(f"{where}:{lineno}: {layer} must not import {target}")
    return problems


def test_layering_rules_hold():
    assert violations() == []


STDLIB_ONLY = ("core/learning_events.py", "core/rank_sources.py")  # neutral core modules of the learning-links spec (§4, §5.1)


def test_neutral_core_modules_use_the_standard_library_only():
    import sys
    for rel in STDLIB_ONLY:
        path = APP / rel
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for lineno, target in imported_modules(tree, module_name(path, APP), False):
            assert target.split(".")[0] in sys.stdlib_module_names, f"app/{rel}:{lineno} imports {target}"


def test_scanner_sees_lazy_relative_and_package_imports(tmp_path):
    app = tmp_path / "app"
    (app / "core").mkdir(parents=True)
    (app / "routers").mkdir()
    (app / "providers").mkdir()
    for d in (app, app / "core", app / "routers", app / "providers"):
        (d / "__init__.py").write_text("", encoding="utf-8")
    (app / "routers" / "health.py").write_text("", encoding="utf-8")
    (app / "core" / "config.py").write_text(
        "def f():\n    from app.routers import health\n"
        "from ..routers import health as h\n"
        "from app import routers\n",
        encoding="utf-8",
    )
    (app / "providers" / "vendor.py").write_text("from fastapi import Request\n", encoding="utf-8")
    (app / "services").mkdir()
    (app / "services" / "peek.py").write_text("from app.admin import service\n", encoding="utf-8")
    (app / "stray.py").write_text("", encoding="utf-8")
    found = violations(app)
    assert len([p for p in found if p.startswith("app/core/config.py")]) == 3
    assert any(p.startswith("app/providers/vendor.py:1") and "fastapi" in p for p in found)
    assert any(p.startswith("app/stray.py") for p in found)
    assert any(p.startswith("app/services/peek.py:1") and "app.admin" in p for p in found)


def test_rank_and_rooms_are_isolated_siblings(tmp_path):
    app = tmp_path / "app"
    for pkg in ("rank", "rooms", "realtime", "services"):
        (app / pkg).mkdir(parents=True)
        (app / pkg / "__init__.py").write_text("", encoding="utf-8")
    (app / "__init__.py").write_text("", encoding="utf-8")
    (app / "rank" / "a.py").write_text("from app.rooms import b\n", encoding="utf-8")
    (app / "rooms" / "b.py").write_text("from app.realtime import c\n", encoding="utf-8")
    (app / "services" / "d.py").write_text("from app.rank import a\n", encoding="utf-8")
    (app / "rooms" / "ok.py").write_text("from app.services import d\nfrom app.speech import x\n", encoding="utf-8")
    found = violations(app)
    assert any(p.startswith("app/rank/a.py:1") for p in found)
    assert any(p.startswith("app/rooms/b.py:1") for p in found)
    assert any(p.startswith("app/services/d.py:1") for p in found)
    assert not any(p.startswith("app/rooms/ok.py") for p in found)


def test_wordbook_is_a_leaf_layer(tmp_path):
    app = tmp_path / "app"
    for pkg in ("wordbook", "rank", "rooms", "realtime", "admin", "routers", "services"):
        (app / pkg).mkdir(parents=True)
        (app / pkg / "__init__.py").write_text("", encoding="utf-8")
    (app / "__init__.py").write_text("", encoding="utf-8")
    (app / "wordbook" / "a.py").write_text("from app.rank import x\n", encoding="utf-8")
    (app / "wordbook" / "b.py").write_text("from app.routers import y\n", encoding="utf-8")
    (app / "rank" / "c.py").write_text("from app.wordbook import a\n", encoding="utf-8")
    (app / "services" / "d.py").write_text("from app.wordbook import a\n", encoding="utf-8")
    (app / "realtime" / "e.py").write_text("def f():\n    from app.wordbook import a\n", encoding="utf-8")
    (app / "wordbook" / "ok.py").write_text("from app.services import d\nfrom app.models import User\n", encoding="utf-8")
    (app / "admin" / "ok.py").write_text("from app.wordbook import a\n", encoding="utf-8")
    (app / "routers" / "ok.py").write_text("from app.wordbook import a\n", encoding="utf-8")
    found = violations(app)
    for bad in ("app/wordbook/a.py:1", "app/wordbook/b.py:1", "app/rank/c.py:1", "app/services/d.py:1",
                "app/realtime/e.py:2"):
        assert any(p.startswith(bad) for p in found), bad
    assert not any(p.startswith(("app/wordbook/ok.py", "app/admin/ok.py", "app/routers/ok.py")) for p in found)


def test_links_is_a_top_layer(tmp_path):
    app = tmp_path / "app"
    for pkg in ("links", "rank", "admin", "wordbook", "services", "routers", "realtime", "core"):
        (app / pkg).mkdir(parents=True)
        (app / pkg / "__init__.py").write_text("", encoding="utf-8")
    (app / "__init__.py").write_text("", encoding="utf-8")
    (app / "rank" / "a.py").write_text("from app.links import mistakes\n", encoding="utf-8")
    (app / "admin" / "b.py").write_text("def f():\n    from app.links import gate\n", encoding="utf-8")
    (app / "wordbook" / "c.py").write_text("from app import links\n", encoding="utf-8")
    (app / "services" / "d.py").write_text("import app.links.spec\n", encoding="utf-8")
    (app / "core" / "e.py").write_text("from app.links.spec import LINK_KEYS\n", encoding="utf-8")
    (app / "links" / "f.py").write_text("from app.routers import links\n", encoding="utf-8")
    (app / "links" / "g.py").write_text("from app.realtime import x\n", encoding="utf-8")
    (app / "links" / "ok.py").write_text("from app.wordbook import store\nfrom app.rank import points\n"
                                         "from app.core import learning_events\n", encoding="utf-8")
    (app / "routers" / "ok.py").write_text("from app.links import registry\n", encoding="utf-8")
    found = violations(app)
    for bad in ("app/rank/a.py:1", "app/admin/b.py:2", "app/wordbook/c.py:1", "app/services/d.py:1", "app/core/e.py:1",
                "app/links/f.py:1", "app/links/g.py:1"):
        assert any(p.startswith(bad) for p in found), bad
    assert not any(p.startswith(("app/links/ok.py", "app/routers/ok.py")) for p in found)
