from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            {"error": str(exc.detail)},
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        if errors:
            first = errors[0]
            where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
            message = f"{where}: {first.get('msg', 'invalid request')}" if where else first.get("msg", "invalid request")
        else:
            message = "invalid request"
        return JSONResponse({"error": message}, status_code=422)
