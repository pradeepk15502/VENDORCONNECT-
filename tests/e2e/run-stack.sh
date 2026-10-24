#!/usr/bin/env bash
# Starts API + production-built apps for E2E. Usage: tests/e2e/run-stack.sh [start|stop]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${PYTHON:-python}"
LOG="$ROOT/tests/e2e/.logs"; mkdir -p "$LOG"
if [ "${1:-start}" = "stop" ]; then pkill -f "manage.py runserver 8000" || true; pkill -f "vite preview" || true; exit 0; fi

cd "$ROOT/services/api"
# THROTTLE_ANON's production-sane default (120/min) is shared by every unauthenticated read in the
# app (vendor list, search, categories, vendor profile...) and keyed per client IP — a full sequential
# Playwright run drives all of those from one IP inside well under a minute, so without raising it
# here, an E2E run can trip "Too many tries" on a perfectly correct build partway through the suite
# (observed on vendors.spec.ts's category-filter test). Raised generously for the same reason the OTP
# throttles already are below — this is the E2E stack, not production traffic.
export DJANGO_SETTINGS_MODULE=config.settings.dev OTP_DEV_ECHO=true THROTTLE_OTP_IP=1000/hour THROTTLE_OTP_VERIFY_IP=1000/hour THROTTLE_ADMIN_LOGIN=1000/hour OTP_MAX_PER_PHONE_PER_HOUR=100 OTP_RESEND_COOLDOWN_SECONDS=0 THROTTLE_ANON=6000/min THROTTLE_USER=6000/min
$PY manage.py migrate -v0
# Clear vendors/non-admin users before seeding: this dev DB is a persistent sandbox reused across
# many local `start` calls (unlike CI's ephemeral one), so without this, vendors created by earlier
# vendor-onboarding/screenshot runs (e.g. @TESTWALA00N) keep accumulating and pollute any "list
# nearby vendors" assertion. `flush` isn't used here — it would also empty migration-seeded reference
# data (e.g. accounts_role) that nothing re-seeds outside of running migrations again.
# Orders/Payments (Phase 8) PROTECT their vendor/customer/order FKs on purpose (order history must
# survive an account being removed elsewhere) — so this dev-only reset deletes them first, in FK
# order, rather than relaxing that constraint just to make repeated local runs convenient.
$PY manage.py shell -c "
from vc.orders.models import Order, Payment
from vc.vendors.models import Vendor
from vc.accounts.models import User
Payment.objects.all().delete()
Order.objects.all().delete()
Vendor.objects.all().delete()
User.objects.filter(is_superuser=False).delete()
" >/dev/null
$PY manage.py seed_taxonomy -v0
$PY manage.py seed_demo -v0
$PY manage.py shell -c "
from vc.accounts.models import User
u = User.objects.filter(phone='+91${E2E_ADMIN_PHONE:-9000000001}').first() or User.objects.create_superuser('+91${E2E_ADMIN_PHONE:-9000000001}', '${E2E_ADMIN_PASSWORD:-e2e-admin-password-123}', name='E2E Admin')
u.set_password('${E2E_ADMIN_PASSWORD:-e2e-admin-password-123}'); u.save()
" >/dev/null
nohup $PY manage.py runserver 8000 --noreload > "$LOG/api.log" 2>&1 &

cd "$ROOT"
for app in web admin; do
  nohup npm run preview -w @vc/$app > "$LOG/$app.log" 2>&1 &
done
for port in 8000 4173 4175; do
  for i in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$port/$( [ $port = 8000 ] && echo health )" && break; sleep 0.5; done
done
echo "stack up: api:8000 web:4173 admin:4175"
