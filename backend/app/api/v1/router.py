from fastapi import APIRouter

from app.api.v1.routes import health, jobs, plan_edit, plans, projects, uploads

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(projects.router)
api_router.include_router(plans.router)
api_router.include_router(plan_edit.router)
api_router.include_router(uploads.router)
api_router.include_router(jobs.router)
