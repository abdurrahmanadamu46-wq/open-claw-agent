FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV VERIFY_PORT=8020
EXPOSE 8020

# 仅内网部署，不对外暴露
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]
