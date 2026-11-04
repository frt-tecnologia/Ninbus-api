#!/usr/bin/env bash
# Generates a self-signed certificate for LOCAL development, placed in the
# exact path nginx expects: certbot/conf/live/ninbus.frt.com.br/ (the compose
# nginx mounts ./certbot/conf as /etc/letsencrypt). Production servers already
# have the real Let's Encrypt files there — this script is local-only and the
# directory is gitignored. Re-run is a no-op while the files exist.

set -euo pipefail

CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certbot/conf/live/ninbus.frt.com.br"
FULLCHAIN="$CERT_DIR/fullchain.pem"
PRIVKEY="$CERT_DIR/privkey.pem"
DAYS=825

if [[ -f "$FULLCHAIN" && -f "$PRIVKEY" ]]; then
	echo "[LOCAL-CERTS] $FULLCHAIN already exists — nothing to do."
	exit 0
fi

mkdir -p "$CERT_DIR"

SUBJECT="/CN=ninbus.frt.com.br"
SAN="subjectAltName=DNS:ninbus.frt.com.br,DNS:api.ninbus.frt.com.br,DNS:hb.ninbus.frt.com.br,DNS:localhost,IP:127.0.0.1"

run_openssl() {
	to_native() {
		if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi
	}
	if command -v openssl >/dev/null 2>&1; then
		MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days "$DAYS" \
			-keyout "$(to_native "$PRIVKEY")" -out "$(to_native "$FULLCHAIN")" \
			-subj "$SUBJECT" -addext "$SAN"
	else
		docker run --rm \
			-v "$CERT_DIR:$CERT_DIR" alpine/openssl \
			req -x509 -newkey rsa:2048 -nodes -days "$DAYS" \
			-keyout "$PRIVKEY" -out "$FULLCHAIN" \
			-subj "$SUBJECT" -addext "$SAN"
	fi
}

run_openssl

echo "[LOCAL-CERTS] Generated (valid ${DAYS} days, self-signed):"
echo "  $FULLCHAIN"
echo "  $PRIVKEY"
echo
echo "Browser will show a certificate warning (self-signed). To silence it on"
echo "Windows, import the cert into the Trusted Root store:"
echo "  certutil -addstore -f Root \"$FULLCHAIN\""
