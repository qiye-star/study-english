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


def test_every_admin_api_route_declares_a_role():
    app = create_app(make_settings())
    missing = []
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/admin"):
            for method in route.methods - {"HEAD"}:
                if (method, route.path) not in PUBLIC and not _roles(route):
                    missing.append(f"{method} {route.path}")
    assert missing == []
