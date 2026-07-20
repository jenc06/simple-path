import json
import os
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from document_extractor import DOC_TYPES, extract, scan


app = FastAPI(title="SimplePath PDF Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/scan")
async def scan_upload(
    file: Annotated[UploadFile, File()],
    selectedDocType: Annotated[str, Form()],
):
    if selectedDocType not in DOC_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported selected document type.")
    path = await write_temp_upload(file)
    try:
        return scan(path, selectedDocType)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not scan uploaded document: {exc}") from exc
    finally:
        path.unlink(missing_ok=True)


@app.post("/extract")
async def extract_upload(
    file: Annotated[UploadFile, File()],
    finalDocType: Annotated[str, Form()],
    docId: Annotated[str, Form()],
    scanJson: Annotated[str | None, Form()] = None,
    scan: Annotated[str | None, Form()] = None,
):
    if finalDocType not in DOC_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported final document type.")
    if not docId:
        raise HTTPException(status_code=400, detail="Missing document id.")
    raw_scan = scanJson or scan
    if not raw_scan:
        raise HTTPException(status_code=400, detail="Missing scan result.")
    try:
        scan_result = json.loads(raw_scan)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid scan result.") from exc

    path = await write_temp_upload(file)
    try:
        return extract(path, finalDocType, docId, scan_result)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not extract uploaded document: {exc}") from exc
    finally:
        path.unlink(missing_ok=True)


@app.post("/scan-and-extract")
async def scan_and_extract_upload(
    file: Annotated[UploadFile, File()],
    selectedDocType: Annotated[str, Form()],
    docId: Annotated[str, Form()],
):
    if selectedDocType not in DOC_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported selected document type.")
    if not docId:
        raise HTTPException(status_code=400, detail="Missing document id.")
    path = await write_temp_upload(file)
    try:
        scan_result = scan(path, selectedDocType)
        extraction_result = extract(path, selectedDocType, docId, scan_result)
        return {"scan": scan_result, "extraction": extraction_result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not process uploaded document: {exc}") from exc
    finally:
        path.unlink(missing_ok=True)


async def write_temp_upload(file: UploadFile) -> Path:
    suffix = safe_suffix(file.filename or "")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        while chunk := await file.read(1024 * 1024):
            temp.write(chunk)
        return Path(temp.name)


def safe_suffix(filename: str) -> str:
    suffix = Path(filename.lower()).suffix
    if suffix in {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"}:
        return suffix
    return ".bin"
