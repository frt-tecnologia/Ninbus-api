# ═══════════════════════════════════════════════════════════════════════
# Ninbus — Reverse Proxy image
#
# Minimal nginx + the main config baked in. The vhosts (conf.d/) are
# bind-mounted from the host (docker-compose.yml) so config edits take
# effect with `docker compose restart nginx` — no rebuild needed.
#
# Build:  docker compose build nginx
# ═══════════════════════════════════════════════════════════════════════
FROM nginx:1.27-alpine

# Bake in the global nginx.conf (vhosts come from the bind mount).
COPY nginx.conf /etc/nginx/nginx.conf

# Run with the image default: nginx master as root (required to bind :80
# and create /var/cache/nginx/*), workers as the `nginx` user (already the
# image default via `user nginx;` in nginx.conf). Forcing USER nginx here
# breaks cache dir creation at startup.

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	# Use 127.0.0.1 (IPv4) — `localhost` resolves to ::1 (IPv6) which nginx
	# does not listen on, causing a spurious "unhealthy".
	CMD wget -qO- http://127.0.0.1/health >/dev/null 2>&1 || exit 1
