"""The provider documents: /manifest/{provider}/{document}.json."""

import email.utils
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from niitti.logging import get_logger

from .. import documents
from ..captured import CaptureError
from ..layout import netloc
from ..pool import updated_at
from ..signing import ilta_pulu_rules

log = get_logger(__name__)
router = APIRouter(prefix="/manifest", tags=["providers"])


def _document(content: dict, settings) -> JSONResponse:
    last_modified = email.utils.format_datetime(datetime.fromisoformat(updated_at(settings.pool_seed)), usegmt=True)
    return JSONResponse(content, headers={"Last-Modified": last_modified})


@router.get("/ilta-pulu/manifest.json", summary="The Ilta-Pulu provider manifest")
def ilta_pulu_manifest(request: Request):
    settings = request.app.state.devserver.settings
    return _document(documents.manifest(settings), settings)


@router.get("/ilta-pulu/sites.json", summary="The Ilta-Pulu site configuration")
def ilta_pulu_sites(request: Request):
    settings = request.app.state.devserver.settings
    return _document(documents.sites(settings), settings)


@router.get("/ilta-pulu/rules.json", summary="The Suola rules that sign Ilta-Pulu article links")
def ilta_pulu_rules_document(request: Request):
    state = request.app.state.devserver
    return _document(ilta_pulu_rules(netloc(state.settings), documents.rules_tests(state)), state.settings)


@router.get("/ilta-pulu/data.json", summary="The Rahti data of the Ilta-Pulu article pool")
def ilta_pulu_data(request: Request):
    state = request.app.state.devserver
    return _document(documents.data(state), state.settings)


@router.get("/ilta-pulu/ignored.json", summary="The x-paatti-dev resource, which Paatti must never fetch")
def ilta_pulu_ignored():
    log.warning("Paatti fetched a resource of an unknown type; it must ignore it")
    raise HTTPException(status_code=410, detail="A resource of an unknown type must not be fetched")


def _captured(request: Request, build) -> JSONResponse:
    try:
        return JSONResponse(build(request.app.state.captured))
    except CaptureError as err:
        raise HTTPException(status_code=err.status, detail=str(err)) from err


@router.get("/captured-sites/manifest.json", summary="Rahti's sites with fake corrections for captured links")
def captured_manifest(request: Request):
    links = documents.links(request.app.state.devserver.settings, capture=True)
    return _captured(request, lambda captured: captured.manifest(links))


@router.get("/captured-sites/data.json", summary="The fake Rahti data of the captured links")
def captured_data(request: Request):
    return _captured(request, lambda captured: captured.data())
