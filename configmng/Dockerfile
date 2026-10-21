# Monaco editor is bundled at build time so the UI works without internet.
FROM node:22-alpine AS monaco
WORKDIR /m
RUN npm install --no-audit --no-fund monaco-editor@0.52.2

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY --from=monaco /m/node_modules/monaco-editor/min/vs ./app/static/vs
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
