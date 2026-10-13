"""Server layering, enforced by an AST scan of every import in `app/` (plan Task 8).

    core       -> (nothing but itself and app.models, the ORM schema)
    providers  -> core                         (and never FastAPI/Starlette)
    speech     -> core, providers
    services   -> core, providers
    realtime   -> core, providers, speech, services
    rank       -> core, providers, speech, services
    rooms      -> core, providers, speech, services, agents (rank and rooms never import each other)
    wordbook   -> core, providers, speech, services (a leaf: only admin, routers and main import it)
    agents     -> core, providers, speech, services (shared agent core: rooms, links, admin, routers and main import it;
                  never rank, rooms, realtime, wordbook, links, admin or routers)
    links      -> core, providers, speech, services, rank, rooms, wordbook, agents (top layer: only routers and main)
    library    -> core, providers, speech, services (imported media library: only admin, routers and main import it)
    admin      -> core, providers, speech, services, realtime, rank, rooms, wordbook, agents, library (admin console logic)
    routers    -> anything below (and other routers)
    main       -> anything; nothing but main imports routers
                  (likewise only routers and main may import admin)

`app.models` sits beside core: it may import core only, and every layer may import it.
Lazy (function-level) imports count; so do `from app import x` and relative imports."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

LAYERS = ("core", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook", "agents", "links",
          "library", "admin", "routers")
TOP_LEVEL = {"__init__", "main", "models"}

ALLOWED: dict[str, set[str]] = {
    "core": {"core", "models"},
    "models": {"core"},
    "providers": {"providers", "core"},
    "speech": {"speech", "core", "models", "providers"},
    "services": {"services", "core", "models", "providers"},
    "realtime": {"realtime", "core", "models", "providers", "speech", "services"},
    "rank": {"rank", "core", "models", "providers", "speech", "services"},
    "rooms": {"rooms", "core", "models", "providers", "speech", "services", "agents"},
    "wordbook": {"wordbook", "core", "models", "providers", "speech", "services"},
    "agents": {"agents", "core", "models", "providers", "speech", "services"},
    "links": {"links", "core", "models", "providers", "speech", "services", "rank", "rooms", "wordbook", "agents"},
    "library": {"library", "core", "models", "providers", "speech", "services"},
    "admin": {"admin", "core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook",
              "agents", "library"},
    "routers": {"routers", "core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook",
                "admin", "links", "agents", "library"},
    "main": {"core", "models", "providers", "speech", "services", "realtime", "rank", "rooms", "wordbook", "admin",
             "routers", "links", "agents", "library"},
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


def test_agents_layer_rules(tmp_path):
    """spec 2026-10-12-agents §3.3: agents imports only core/models/providers/speech/services; rooms, links, admin,
    routers and main may import agents; rank, realtime, wordbook, services and core may not."""
    app = tmp_path / "app"
    for pkg in ("agents", "rooms", "links", "admin", "routers", "rank", "realtime", "wordbook", "services", "core"):
        (app / pkg).mkdir(parents=True)
        (app / pkg / "__init__.py").write_text("", encoding="utf-8")
    (app / "__init__.py").write_text("", encoding="utf-8")
    bad = {  # file -> (source, line of the bad import)
        "agents/a.py": ("from app.rooms import hub\n", 1),
        "agents/b.py": ("from app.wordbook import store\n", 1),
        "agents/c.py": ("def f():\n    from app.links import gate\n", 2),
        "agents/d.py": ("from app.rank import points\n", 1),
        "agents/e.py": ("from app.realtime import x\n", 1),
        "agents/f.py": ("from app.admin import audit\n", 1),
        "agents/g.py": ("from app.routers import agents\n", 1),
        "rank/h.py": ("from app.agents import orchestrator\n", 1),
        "realtime/i.py": ("from app.agents import prompt\n", 1),
        "wordbook/j.py": ("from app.agents import context\n", 1),
        "services/k.py": ("from app.agents import trace\n", 1),
        "core/l.py": ("from app.agents.trace import Start\n", 1),
    }
    ok = {
        "agents/ok.py": "from app.services import usage\nfrom app.providers import llm\nfrom app.core import timing\n"
                        "from app.models import Message\n",
        "rooms/ok.py": "from app.agents import orchestrator\n",
        "links/ok.py": "from app.agents.context import SourceResult\nfrom app.wordbook import store\n",
        "admin/ok.py": "from app.agents import personas\n",
        "routers/ok.py": "from app.agents import orchestrator\n",
    }
    for rel, (src, _) in bad.items():
        (app / rel).write_text(src, encoding="utf-8")
    for rel, src in ok.items():
        (app / rel).write_text(src, encoding="utf-8")
    found = violations(app)
    for rel, (_, line) in bad.items():
        assert any(p.startswith(f"app/{rel}:{line}") for p in found), rel
    assert not any(p.startswith(tuple(f"app/{rel}" for rel in ok)) for p in found)


AGENTS_MEMORY_MAY_IMPORT = ("app.agents.memory", "app.agents.context", "app.agents.settings")
AGENTS_MEMORY_IMPORTERS = ("app.agents.memory", "app.agents.tutor", "app.routers", "app.admin", "app.main")


def _within(target: str, prefixes: tuple[str, ...]) -> bool:
    return any(target == p or target.startswith(p + ".") for p in prefixes)


def memory_violations(root: Path = APP) -> list[str]:
    """计划 A2 R-M12:agents/memory 在 agents 内只依赖 context 与 settings;只有 memory、tutor、routers、admin、main 导入它。"""
    problems: list[str] = []
    for path in sorted(root.rglob("*.py")):
        current = module_name(path, root)
        where = path.relative_to(root.parent).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for lineno, target in imported_modules(tree, current, path.name == "__init__.py"):
            inside = _within(current, ("app.agents.memory",))
            if inside and target.startswith("app.agents") and not _within(target, AGENTS_MEMORY_MAY_IMPORT):
                problems.append(f"{where}:{lineno}: agents/memory must not import {target}")
            if not inside and _within(target, ("app.agents.memory",)) and not _within(current, AGENTS_MEMORY_IMPORTERS):
                problems.append(f"{where}:{lineno}: {current} must not import {target}")
    return problems


def test_agents_memory_boundaries_hold():
    assert memory_violations() == []


def test_memory_scanner_catches_both_directions(tmp_path):
    app = tmp_path / "app"
    for pkg in ("agents", "agents/memory", "agents/tutor", "routers", "rooms"):
        (app / pkg).mkdir(parents=True, exist_ok=True)
        (app / pkg / "__init__.py").write_text("", encoding="utf-8")
    (app / "__init__.py").write_text("", encoding="utf-8")
    (app / "agents" / "memory" / "bad.py").write_text("from app.agents import orchestrator\n", encoding="utf-8")
    (app / "agents" / "memory" / "ok.py").write_text("from app.agents.context import SourceResult\n"
                                                     "from app.agents.memory import store\n", encoding="utf-8")
    (app / "agents" / "orchestrator.py").write_text("from app.agents.memory import store\n", encoding="utf-8")
    (app / "agents" / "tutor" / "ok.py").write_text("from app.agents.memory.worker import TutorFinished\n",
                                                    encoding="utf-8")
    (app / "routers" / "ok.py").write_text("from app.agents.memory.store import drop_conversation\n", encoding="utf-8")
    found = memory_violations(app)
    assert any(p.startswith("app/agents/memory/bad.py:1") for p in found)
    assert any(p.startswith("app/agents/orchestrator.py:1") for p in found)
    assert not any(p.startswith(("app/agents/memory/ok.py", "app/agents/tutor/ok.py", "app/routers/ok.py"))
                   for p in found)


TUTOR_PURE = ("agents/tutor/machine.py", "agents/tutor/plan.py", "agents/tutor/parse.py", "agents/tutor/prompt.py",
              "agents/tutor/recap.py")
TUTOR_STATEFUL = {"app.agents.tutor.service", "app.agents.tutor.handler", "app.agents.tutor.memory_bridge"}


def test_tutor_core_modules_are_pure():
    """The five pure tutor modules (plan 2026-10-12-agents-tutor) use only the stdlib and each other, so rooms (A5)
    can reuse them as they are."""
    import sys
    for rel in TUTOR_PURE:
        path = APP / rel
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for lineno, target in imported_modules(tree, module_name(path, APP), False):
            top = target.split(".")[0]
            ok = top in sys.stdlib_module_names or (
                target.startswith("app.agents.tutor.") and target not in TUTOR_STATEFUL)
            assert ok, f"app/{rel}:{lineno} imports {target}"


def test_library_layer_rules(tmp_path):
    """spec 2026-10-13-video-import §3: library imports only core/models/providers/speech/services; only admin, routers
    and main import it (links, agents, rooms, rank, wordbook, realtime, services, speech and core may not)."""
    app = tmp_path / "app"
    for pkg in ("library", "admin", "routers", "links", "agents", "rooms", "rank", "wordbook", "realtime", "services",
                "speech", "core"):
        (app / pkg).mkdir(parents=True)
        (app / pkg / "__init__.py").write_text("", encoding="utf-8")
    (app / "__init__.py").write_text("", encoding="utf-8")
    bad = {  # file -> (source, line of the bad import)
        "library/a.py": ("from app.admin import audit\n", 1),
        "library/b.py": ("def f():\n    from app.routers import library\n", 2),
        "library/c.py": ("from app.agents import orchestrator\n", 1),
        "library/d.py": ("from app.links import gate\n", 1),
        "library/e.py": ("from app.rooms import audio\n", 1),
        "library/f.py": ("from app.realtime import x\n", 1),
        "links/g.py": ("from app.library import store\n", 1),
        "agents/h.py": ("from app.library import store\n", 1),
        "rooms/i.py": ("from app.library import store\n", 1),
        "services/j.py": ("from app.library import store\n", 1),
        "speech/k.py": ("import app.library.segment\n", 1),
        "core/l.py": ("from app.library.paths import tmp_dir\n", 1),
    }
    ok = {
        "library/ok.py": "from app.speech.sentence_split import split_all\nfrom app.services import usage\n"
                         "from app.core import metering\nfrom app.models import LibraryItem\nfrom app.library import paths\n",
        "admin/ok.py": "from app.library import paths\n",
        "routers/ok.py": "from app.library import store\n",
    }
    for rel, (src, _) in bad.items():
        (app / rel).write_text(src, encoding="utf-8")
    for rel, src in ok.items():
        (app / rel).write_text(src, encoding="utf-8")
    found = violations(app)
    for rel, (_, line) in bad.items():
        assert any(p.startswith(f"app/{rel}:{line}") for p in found), rel
    assert not any(p.startswith(tuple(f"app/{rel}" for rel in ok)) for p in found)
