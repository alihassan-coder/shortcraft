from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.deps import SessionDep
from app.core.errors import error_body

# Liveness lives at the root (/health); readiness under the versioned API.
liveness_router = APIRouter(tags=["health"])
router = APIRouter(prefix="/health", tags=["health"])


@liveness_router.get("/health")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", response_model=None)
async def readiness(session: SessionDep) -> dict[str, str] | JSONResponse:
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(error_body("not_ready", "Database unavailable"), status_code=503)
    return {"status": "ready", "database": "ok"}
