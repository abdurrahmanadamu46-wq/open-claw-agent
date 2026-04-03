FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

ARG AI_INSTALL_HEAVY=0

COPY requirements-core.txt requirements-heavy.txt requirements.txt ./
RUN pip install --upgrade pip && \
    pip install -r requirements-core.txt && \
    if [ "$AI_INSTALL_HEAVY" = "1" ]; then pip install -r requirements-heavy.txt; fi

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
