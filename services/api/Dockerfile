# syntax=docker/dockerfile:1.7
FROM python:3.11-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends gdal-bin libgdal32 libgeos-c1v5 libproj25 curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

FROM base AS dev
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
COPY . .
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

FROM base AS prod
RUN useradd --create-home --uid 10001 app
COPY --chown=app:app . .
ENV DJANGO_SETTINGS_MODULE=config.settings.prod
RUN DJANGO_SECRET_KEY=build-only-$(head -c 32 /dev/urandom | base64) ENVIRONMENT=build SMS_PROVIDER=msg91 \
    python manage.py collectstatic --noinput -v0
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD curl -fsS http://localhost:8000/health || exit 1
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--threads", "4", "--timeout", "30", "--access-logfile", "-"]
