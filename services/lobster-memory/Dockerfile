# LobsterMemoryEngine — 弹性记忆微服务（Qdrant + BGE-M3）
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

# 首次拉取 BGE-M3 会较慢，可构建时预拉取：RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')"
ENV QDRANT_HOST=qdrant
ENV QDRANT_PORT=6333
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
