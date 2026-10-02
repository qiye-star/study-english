from fastapi import APIRouter

router = APIRouter()


@router.get("/up")
async def up() -> dict:
    return {"status": "ok"}
