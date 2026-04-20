from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.config import model_to_dict

router = APIRouter()
templates = Jinja2Templates(directory="app/web/templates")


@router.get("/", response_class=HTMLResponse)
def index(request: Request):
    config_store = request.app.state.config_store
    snapshot = request.app.state.runtime.snapshot()
    return templates.TemplateResponse(
        request,
        "index.html",
        context={
            "request": request,
            "config": config_store.config,
            "snapshot": model_to_dict(snapshot),
        },
    )
