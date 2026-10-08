"""Server layering, enforced by an AST scan of every import in `app/` (plan Task 8).

    core       -> (nothing but itself and app.models, the ORM schema)
    providers  -> core                         (and never FastAPI/Starlette)
    speech     -> core, providers
    services   -> core, providers
    realtime   -> core, providers, speech, services
    admin      -> core, providers, speech, services, realtime (read-only admin console logic)
    routers    -> anything below (and other routers)
    main       -> anything; nothing but main imports routers
                  (likewise only routers and main may import admin)

`app.models` sits beside core: it may import core only, and every layer may import it.
Lazy (function-level) imports count; so do `from app import x` and relative imports."""
import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

LAYERS = ("core", "providers", "speech", "services", "realtime", "admin", "routers")
TOP_LEVEL = {"__init__", "main", "models"}

ALLOWED: dict[str, set[str]] = {
    "core": {"core", "models"},
    "models": {"core"},
    "providers": {"providers", "core"},
    "speech": {"speech", "core", "models", "providers"},
    "services": {"services", "core", "models", "providers"},
    "realtime": {"realtime", "core", "models", "providers", "speech", "services"},
    "admin": {"admin", "core", "models", "providers", "speech", "services", "realtime"},
    "routers": {"routers", "core", "models", "providers", "speech", "services", "realtime", "admin"},
    "main": {"core", "models", "providers", "speech", "services", "realtime", "admin", "routers"},
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
