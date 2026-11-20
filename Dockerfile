# Build Claude's advanced Three.js / GPU simulator as static assets.
FROM node:22-alpine AS studio-builder
WORKDIR /studio
COPY studio/package.json studio/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY studio/ ./
ARG VITE_TILE_PROXY=/api/tiles
ENV VITE_TILE_PROXY=$VITE_TILE_PROXY
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home app
COPY server/ ./server/
COPY web/ ./web/
COPY --from=studio-builder /studio/dist/ ./studio/dist/
USER app
EXPOSE 8086
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8086"]
