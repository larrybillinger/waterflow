FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home app
COPY server/ ./server/
COPY web/ ./web/
USER app
EXPOSE 8086
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8086"]
