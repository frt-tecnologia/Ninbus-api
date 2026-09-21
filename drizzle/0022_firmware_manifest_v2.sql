-- 0022: NPM manifest v2 (version-piso) — release metadata + publication gate evidence.
--
-- Contract change (breaks signature compatibility, see docs/notes/ota-v2-research.md):
-- v2 manifests carry version u32 LE @44 (major<<24|minor<<16|patch<<8|build) and
-- flags u32 LE @48 (bit0 = allow_downgrade), both covered by the extended digest
-- SHA-256(image || counter_le || size_le || version_le || flags_le).
--
-- - manifest_version: packed u32 for v2 releases (NULL = v1/legacy manifest).
-- - manifest_flags: bit0 = allow_downgrade (NULL for v1 / non-ninbus types).
-- - gate: JSONB evidence of the pre-publish verification gate (checks, verdict,
--   image sha256, fleet floor at check time) — attached to the release per the
--   OTA v2 contract ("guardar a saída do gate como evidência anexada à release").
-- - gate_at: when the gate last ran/passed.

ALTER TABLE "firmware_releases"
    ADD COLUMN "manifest_version" integer,
    ADD COLUMN "manifest_flags" integer,
    ADD COLUMN "gate" jsonb,
    ADD COLUMN "gate_at" timestamp with time zone;
