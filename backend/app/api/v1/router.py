from fastapi import APIRouter

from app.api.v1 import cases, documents, lexi_alert, lexi_chron, lexi_cross, webhooks

api_router = APIRouter()
api_router.include_router(cases.router)
api_router.include_router(documents.router)
api_router.include_router(lexi_chron.router)
api_router.include_router(lexi_cross.router)
api_router.include_router(lexi_alert.router)
api_router.include_router(webhooks.router)
