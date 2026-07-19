FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY extractor-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY scripts/document_extractor.py /app/scripts/document_extractor.py
COPY scripts/confidence_scoring.py /app/scripts/confidence_scoring.py
COPY extractor-service/service.py /app/service.py

ENV PYTHONPATH=/app/scripts
ENV PORT=8000

CMD ["sh", "-c", "uvicorn service:app --host 0.0.0.0 --port ${PORT:-8000}"]
