#!/usr/bin/env bash
# Проверка онлайна: поднимает сервер на временной базе, гоняет ботов (рейтинговая игра и дуэль) и проверку друзей/реванша.
set -e
cd "$(dirname "$0")/.."
PORT=${PORT:-8797}
DB=$(mktemp -d)/ci.sqlite
ALLOW_DEV=1 PORT=$PORT DB=$DB TURN_SEC=30 bun server/server.ts > server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 30); do grep -q "ws://" server.log 2>/dev/null && break; sleep 0.5; done
URL=ws://localhost:$PORT/ws
timeout 300 bun server/test-bots.ts $URL 1
timeout 300 bun server/test-bots.ts $URL 1 duel
timeout 120 bun tests/online-social.ts $URL
curl -sf localhost:$PORT/health
echo; echo "онлайн: OK"
