# SimplePath Extractor Service

This service runs the original SimplePath PDF extraction pipeline outside Vercel so the app can keep using:

- `pdfplumber` PDF text extraction
- rendered page previews through Poppler `pdftoppm`
- OCR fallback through Tesseract

## Deploy On Render

1. Create a new **Web Service**.
2. Connect the same GitHub repository.
3. Choose **Docker** as the runtime.
4. Set the Dockerfile path:

```text
extractor-service/Dockerfile
```

5. Leave the Docker build context as the repository root.
6. Deploy.
7. After it is live, open:

```text
https://YOUR-SERVICE.onrender.com/health
```

Expected response:

```json
{"ok":true}
```

## Connect Vercel

In the Vercel project, add this environment variable:

```text
EXTRACTOR_SERVICE_URL=https://YOUR-SERVICE.onrender.com
```

Then redeploy the Vercel app.

## Endpoints

```text
POST /scan
POST /extract
```

Both endpoints accept multipart form uploads. The Vercel app calls these endpoints through its own `/api/scan` and `/api/extract` routes.
