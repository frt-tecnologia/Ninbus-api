-- 0024: normalize devices.connection_status vocabulary.
-- Legacy rows mixed 'online'/'offline' (event vocabulary) with the public
-- status vocabulary 'connected'/'disconnected'. One vocabulary per concept:
--   devices.connection_status / SSE 's' → 'connected' | 'disconnected' | 'unknown'
--   device_connections.event             → 'online' | 'offline'
-- Idempotent UPDATEs (0 rows on re-run) — safe on every boot, no skip-check needed.

UPDATE devices SET connection_status = 'connected' WHERE connection_status = 'online';
UPDATE devices SET connection_status = 'disconnected' WHERE connection_status = 'offline';
