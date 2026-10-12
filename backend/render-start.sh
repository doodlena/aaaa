#!/bin/sh
# Start command for Render (see render.yaml). Runs from /app/backend inside the image built by backend/Dockerfile.
set -e
foodaccess bootstrap
# A new database starts empty: rebuild the listings from the committed snapshots (skipped once listings exist).
foodaccess load-data --if-empty
# Render's free plan has no shell. Set both variables to create (or reset) an administrator on start, then remove them.
if [ -n "$FOODACCESS_ADMIN_EMAIL" ] && [ -n "$FOODACCESS_ADMIN_PASSWORD" ]; then
  foodaccess create-admin --email "$FOODACCESS_ADMIN_EMAIL"
fi
# The container is reachable only through Render's proxy, so its X-Forwarded-For is trusted (per-client rate limits).
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}" --proxy-headers --forwarded-allow-ips='*'
