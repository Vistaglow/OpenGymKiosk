#!/bin/sh
# Pretend to be the rep sensor: send REPS reps, SECONDS apart, the way the ESP32 does.
#
#   scripts/sim-sensor.sh            8 reps, 2 seconds apart
#   scripts/sim-sensor.sh 5 1.5      5 reps, 1.5 seconds apart
#
# Reads SENSOR_TOKEN and KIOSK_PORT from .env. KIOSK_URL overrides where it sends.
set -eu
cd "$(dirname "$0")/.."
REPS=${1:-8}
GAP=${2:-2}
TOKEN=$(sed -n 's/^SENSOR_TOKEN=//p' .env)
PORT=$(sed -n 's/^KIOSK_PORT=//p' .env)
URL=${KIOSK_URL:-http://localhost:${PORT:-8090}}
[ -n "$TOKEN" ] || { echo "SENSOR_TOKEN is not set in .env" >&2; exit 1; }

curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$URL/sensor/hello" >/dev/null
i=1
while [ "$i" -le "$REPS" ]; do
  sleep "$GAP"
  curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"seq\":\"sim-$$-$i\"}" "$URL/sensor/rep" >/dev/null
  echo "rep $i"
  i=$((i + 1))
done
