#!/usr/bin/env bash
# Observability adversarial test battery — exercises good + bad paths.
# Runs against the API in Docker (http://localhost:8081).
set -uo pipefail

BASE="http://localhost:8081"
SA=$(cat /tmp/sa.cookie)
REG=$(cat /tmp/reg.cookie)
CID=$(cat /tmp/cid)

PASS=0
FAIL=0
declare -a FAILURES

# assert <description> <expected> <actual>
assert() {
	local desc="$1" expected="$2" actual="$3"
	if [ "$expected" = "$actual" ]; then
		PASS=$((PASS+1))
		printf "  ✓ %-58s %s\n" "$desc" "$actual"
	else
		FAIL=$((FAIL+1))
		FAILURES+=("$desc (expected $expected got $actual)")
		printf "  ✗ %-58s expected %s got %s\n" "$desc" "$expected" "$actual"
	fi
}

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FROM1H=$(python -c "import datetime as d;print((d.datetime.now(d.UTC)-d.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))" 2>/dev/null)
FROM30D=$(python -c "import datetime as d;print((d.datetime.now(d.UTC)-d.timedelta(days=30)).strftime('%Y-%m-%dT%H:%M:%SZ'))" 2>/dev/null)
FROM1D=$(python -c "import datetime as d;print((d.datetime.now(d.UTC)-d.timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))" 2>/dev/null)

echo "=========================================="
echo "  BATERIA DE TESTES — OBSERVABILITY API"
echo "=========================================="

echo ""
echo "─── 1. CONTROLE DE ACESSO (401/403/200) ───"
assert "activity sem auth → 401"                401 "$(code "$BASE/api/admin/activity")"
assert "connections sem auth → 401"             401 "$(code "$BASE/api/admin/devices/connections?from=$FROM1H&to=$NOW")"
assert "categories sem auth → 401"              401 "$(code "$BASE/api/admin/categories")"
assert "activity user comum → 403"              403 "$(code -H "Cookie: $REG" "$BASE/api/admin/activity")"
assert "connections user comum → 403"           403 "$(code -H "Cookie: $REG" "$BASE/api/admin/devices/connections?from=$FROM1H&to=$NOW")"
assert "categories user comum → 403"            403 "$(code -H "Cookie: $REG" "$BASE/api/admin/categories")"
assert "activity superadmin → 200"              200 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity")"
assert "connections superadmin → 200"           200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM1H&to=$NOW")"
assert "categories superadmin → 200"            200 "$(code -H "Cookie: $SA" "$BASE/api/admin/categories")"

echo ""
echo "─── 2. AUTENTICAÇÃO ADVERSARIAL ───"
assert "cookie adulterado → 401"                401 "$(code -H 'Cookie: auth.session_token=FALSO' "$BASE/api/admin/activity")"
assert "cookie vazio → 401"                     401 "$(code -H 'Cookie: ' "$BASE/api/admin/activity")"
assert "cookie formato errado → 401"            401 "$(code -H 'Cookie: garbage' "$BASE/api/admin/activity")"
assert "header Bearer inválido → 401"           401 "$(code -H 'Authorization: Bearer falso' "$BASE/api/admin/activity")"

echo ""
echo "─── 3. VALIDAÇÃO DE TIPOS (400 em query/param) ───"
assert "activity companyId não-UUID → 400"      400 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?companyId=NAO-UUID")"
assert "activity limit=string → 400"            400 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?limit=abc")"
assert "activity limit=0 → 400"                 400 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?limit=0")"
assert "activity limit=9999 → 400"              400 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?limit=9999")"
assert "activity limit=-5 → 400"                400 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?limit=-5")"
assert "activity before=string → 400"           400 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?before=abc")"
assert "connections sem from → 400"             400 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?to=$NOW")"
assert "connections sem to → 400"               400 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM1H")"
assert "connections sem from/to → 400"          400 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections")"
assert "connections from malformado → 400"      400 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=naodata&to=$NOW")"
assert "connections to malformado → 400"        400 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM1H&to=naodata")"
assert "connections deviceId não-UUID → 400"    400 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM1H&to=$NOW&deviceId=NAO")"
assert "connections companyId não-UUID → 400"   400 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM1H&to=$NOW&companyId=NAO")"
assert "connections view=banana → 400"          400 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM1H&to=$NOW&view=banana")"
assert "categories type=inexistente → 400"      400 "$(code -H "Cookie: $SA" "$BASE/api/admin/categories?type=inexistente")"
assert "categories companyId não-UUID → 400"    400 "$(code -H "Cookie: $SA" "$BASE/api/admin/categories?companyId=NAO")"

echo ""
echo "─── 4. ENUM FILTERS (400 vs 200) ───"
assert "activity action inválido → 400"         400 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?action=foo.bar")"
assert "activity entityType inválido → 400"     400 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?entityType=banana")"
assert "activity action válido → 200"           200 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?action=company.created")"
assert "activity entityType válido → 200"       200 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?entityType=company")"
assert "categories type=garage → 200"           200 "$(code -H "Cookie: $SA" "$BASE/api/admin/categories?type=garage")"
assert "categories type=region → 200"           200 "$(code -H "Cookie: $SA" "$BASE/api/admin/categories?type=region")"
assert "categories type=bus_line → 200"         200 "$(code -H "Cookie: $SA" "$BASE/api/admin/categories?type=bus_line")"

echo ""
echo "─── 5. VIEW AUTO-SELECT (session vs aggregate) ───"
assert "1h range → 200 (session)"               200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM1H&to=$NOW")"
assert "24h range → 200 (session)"              200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM1D&to=$NOW")"
assert "30d range → 200 (aggregate auto)"       200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM30D&to=$NOW")"
assert "30d view=session forçado → 200"         200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM30D&to=$NOW&view=session")"
assert "30d view=aggregate forçado → 200"       200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$FROM30D&to=$NOW&view=aggregate")"
assert "range invertido (from>to) → 200"        200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?from=$NOW&to=$FROM1H")"

echo ""
echo "─── 6. MÉTODOS HTTP ERRADOS ───"
assert "POST /activity → 404"                   404 "$(code -X POST -H "Cookie: $SA" "$BASE/api/admin/activity")"
assert "PUT /activity → 404"                    404 "$(code -X PUT -H "Cookie: $SA" "$BASE/api/admin/activity")"
assert "DELETE /activity → 404"                 404 "$(code -X DELETE -H "Cookie: $SA" "$BASE/api/admin/activity")"
assert "POST /categories → 404"                 404 "$(code -X POST -H "Cookie: $SA" "$BASE/api/admin/categories")"

echo ""
echo "─── 7. ISOLAMENTO TENANT (empresa inexistente → data vazia) ───"
assert "activity company inexistente → 200"     200 "$(code -H "Cookie: $SA" "$BASE/api/admin/activity?companyId=00000000-0000-0000-0000-000000000000")"
assert "connections company inexistente → 200"  200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices/connections?companyId=00000000-0000-0000-0000-000000000000&from=$FROM1H&to=$NOW")"

echo ""
echo "─── 8. AUDITORIA: MUTAÇÃO FALHA NÃO LOGA ───"
BEFORE=$(curl -s -H "Cookie: $SA" "$BASE/api/admin/activity?action=company.created" | python -c "import sys,json;print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
assert "company POST body vazio → 400"          400 "$(code -X POST -H 'Content-Type: application/json' -H "Cookie: $SA" "$BASE/api/companies" -d '{}')"
AFTER=$(curl -s -H "Cookie: $SA" "$BASE/api/admin/activity?action=company.created" | python -c "import sys,json;print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
assert "audit count inalterado após falha"      "$BEFORE" "$AFTER"

echo ""
echo "─── 9. REGRESSÃO (endpoints existentes + Flutter) ───"
assert "GET /health → 200"                      200 "$(code "$BASE/health")"
assert "GET /api/companies → 200"               200 "$(code -H "Cookie: $SA" "$BASE/api/companies")"
assert "GET /api/admin/companies → 200"         200 "$(code -H "Cookie: $SA" "$BASE/api/admin/companies")"
assert "GET /api/admin/devices → 200"           200 "$(code -H "Cookie: $SA" "$BASE/api/admin/devices")"
assert "GET /api/admin/users → 200"             200 "$(code -H "Cookie: $SA" "$BASE/api/admin/users")"
assert "GET /api/devices/unclaimed → 200"       200 "$(code -H "Cookie: $SA" "$BASE/api/devices/unclaimed")"

echo ""
echo "─── 10. DEVICE CATEGORY EDITOR (novo fluxo F1) ───"
# Criar categoria na empresa de teste
CATRESP=$(curl -s -X POST "$BASE/api/companies/$CID/categories" -H "Content-Type: application/json" -H "Cookie: $SA" -d '{"name":"Garagem Bateria","type":"garage"}')
CATID=$(echo "$CATRESP" | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
echo "    categoria criada: $CATID"
assert "GET categorias da empresa → 200"        200 "$(code -H "Cookie: $SA" "$BASE/api/companies/$CID/categories")"
assert "POST categoria body vazio → 400"        400 "$(code -X POST -H 'Content-Type: application/json' -H "Cookie: $SA" "$BASE/api/companies/$CID/categories" -d '{}')"
assert "POST categoria type inválido → 400"     400 "$(code -X POST -H 'Content-Type: application/json' -H "Cookie: $SA" "$BASE/api/companies/$CID/categories" -d '{"name":"X","type":"invalido"}')"
assert "POST category user comum (viewer) → 403" 403 "$(code -X POST -H 'Content-Type: application/json' -H "Cookie: $REG" "$BASE/api/companies/$CID/categories" -d '{"name":"X","type":"garage"}')"

echo ""
echo "─── 11. AUDIT CAPTURE END-TO-END (categoria) ───"
CATLOGS=$(curl -s -H "Cookie: $SA" "$BASE/api/admin/activity?action=category.created&companyId=$CID" | python -c "import sys,json;print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
assert "audit capturou category.created"        "1" "$CATLOGS"

echo ""
echo "─── 12. RETENÇÃO (env + job) ───"
RETENV=$(docker exec ninbus-api printenv OBS_CONNECTIONS_RETENTION_DAYS 2>/dev/null)
assert "env OBS_CONNECTIONS_RETENTION_DAYS=90"  "90" "$RETENV"
RETLOG=$(docker logs ninbus-api 2>&1 | grep -c "Retention job started")
assert "log 'Retention job started' presente"   "1" "$RETLOG"

echo ""
echo "=========================================="
printf "  RESULTADO: %d PASS · %d FAIL\n" "$PASS" "$FAIL"
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
	echo "FALHAS:"
	for f in "${FAILURES[@]}"; do echo "  - $f"; done
fi
echo "$PASS" > /tmp/pass.count
echo "$FAIL" > /tmp/fail.count
