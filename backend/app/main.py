from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.api.v1.routes.health import liveness_router
from app.core.auth import TokenVerifier
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.db.session import create_engine, create_sessionmaker
from app.services.job_queue import build_job_queue
from app.services.storage import build_storage
from app.worker.context import JobContext


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings.database_url, echo=settings.database_echo)
        app.state.settings = settings
        app.state.engine = engine
        app.state.sessionmaker = create_sessionmaker(engine)
        app.state.storage = build_storage(settings)
        job_ctx = JobContext(settings, app.state.sessionmaker, app.state.storage)
        app.state.job_queue = build_job_queue(settings, job_ctx)
        app.state.token_verifier = TokenVerifier(settings)
        try:
            yield
        finally:
            await app.state.job_queue.aclose()
            await engine.dispose()

    app = FastAPI(title="Shortcraft API", version="0.1.0", debug=settings.debug, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["ETag"],
    )
    register_error_handlers(app)
    app.include_router(liveness_router)
    app.include_router(api_router)
    return app


app = create_app()
