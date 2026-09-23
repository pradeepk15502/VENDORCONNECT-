#!/usr/bin/env bash
# Starts API + production-built apps for E2E. Usage: tests/e2e/run-stack.sh [start|stop]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${PYTHON:-python}"
LOG="$ROOT/tests/e2e/.logs"; mkdir -p "$LOG"
if [ "${1:-start}" = "stop" ]; then pkill -f "manage.py runserver 8000" || true; pkill -f "vite preview" || true; exit 0; fi

cd "$ROOT/services/api"
export DJANGO_SETTINGS_MODULE=config.settings.dev OTP_DEV_ECHO=true THROTTLE_OTP_IP=1000/hour THROTTLE_OTP_VERIFY_IP=1000/hour THROTTLE_ADMIN_LOGIN=1000/hour OTP_MAX_PER_PHONE_PER_HOUR=100 OTP_RESEND_COOLDOWN_SECONDS=0
$PY manage.py migrate -v0
$PY manage.py seed_taxonomy -v0
$PY manage.py shell -c "
from vc.accounts.models import User
u = User.objects.filter(phone='+91${E2E_ADMIN_PHONE:-9000000001}').first() or User.objects.create_superuser('+91${E2E_ADMIN_PHONE:-9000000001}', '${E2E_ADMIN_PASSWORD:-e2e-admin-password-123}', name='E2E Admin')
u.set_password('${E2E_ADMIN_PASSWORD:-e2e-admin-password-123}'); u.save()
" >/dev/null
nohup $PY manage.py runserver 8000 --noreload > "$LOG/api.log" 2>&1 &

cd "$ROOT"
for app in customer vendor admin; do
  nohup npm run preview -w @vc/$app > "$LOG/$app.log" 2>&1 &
done
for port in 8000 4173 4174 4175; do
  for i in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$port/$( [ $port = 8000 ] && echo health )" && break; sleep 0.5; done
done
echo "stack up: api:8000 customer:4173 vendor:4174 admin:4175"
