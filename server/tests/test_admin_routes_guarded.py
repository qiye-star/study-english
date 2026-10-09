from fastapi.routing import APIRoute

from app.admin.perms import REQUIRED_ROLE_ATTR
from app.main import create_app
from tests.conftest import make_settings

PUBLIC = {("POST", "/api/admin/login"), ("POST", "/api/admin/login/totp")}


def _roles(route: APIRoute) -> set[str]:
    found = set()
    for dep in route.dependant.dependencies:
        stack = [dep]
        while stack:
            d = stack.pop()
            role = getattr(d.call, REQUIRED_ROLE_ATTR, None)
            if role:
                found.add(role)
            stack.extend(d.dependencies)
    return found


def api_routes(routes, prefix: str = "") -> list[tuple[str, APIRoute]]:
    """(full path, route). FastAPI >= 0.142 keeps included routers as `_IncludedRouter` wrappers in `app.routes`
    (the router's prefix moves to `include_context.prefix`); walk into them."""
    out: list[tuple[str, APIRoute]] = []
    for route in routes:
        if isinstance(route, APIRoute):
            out.append((prefix + route.path, route))
            continue
        inner = getattr(route, "original_router", None)
        if inner is not None:
            out.extend(api_routes(inner.routes, prefix + (route.include_context.prefix or "")))
    return out


def test_every_admin_api_route_declares_a_role():
    app = create_app(make_settings())
    missing = []
    admin_routes = [(p, r) for p, r in api_routes(app.routes) if p.startswith("/api/admin")]
    # integration: the walk must actually see the admin API (it silently saw none once FastAPI wrapped routers)
    assert len(admin_routes) > 80
    for path, route in admin_routes:
        for method in route.methods - {"HEAD"}:
            if (method, path) not in PUBLIC and not _roles(route):
                missing.append(f"{method} {path}")
    assert missing == []


def test_no_duplicate_method_and_path():
    app = create_app(make_settings())
    seen: dict[tuple[str, str], int] = {}
    for path, route in api_routes(app.routes):
        for method in route.methods - {"HEAD"}:
            seen[(method, path)] = seen.get((method, path), 0) + 1
    assert [k for k, n in seen.items() if n > 1] == []
