# Waterflow v0.3 — Classic MapLibre map and GPU Studio share one origin.
# Build Claude's independently tested Vite/Three.js engine first.
FROM node:22-alpine AS gpu-studio-build
WORKDIR /build/studio
COPY studio/package.json studio/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY studio/ ./
RUN npm run build

# Keep the existing, lightweight FastAPI terrain API and classic frontend.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home app
COPY server/ ./server/
COPY web/ ./web/
COPY --from=gpu-studio-build /build/studio/dist ./studio/dist
USER app
EXPOSE 8086
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8086"]
