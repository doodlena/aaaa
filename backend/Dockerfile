FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/app backend/app
RUN pip install --no-cache-dir ./backend
COPY backend/ backend/
COPY config/ config/
COPY data/ data/
WORKDIR /app/backend
RUN useradd --create-home appuser && mkdir -p /app/reports /app/data/cache && chown -R appuser /app/reports /app/data/cache
USER appuser
EXPOSE 8000
CMD ["sh", "-c", "foodaccess bootstrap && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
