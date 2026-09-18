-- 0021: firmware_releases.counter — anti-downgrade NPM manifest counter.
-- firmware-ninbus releases embed the counter in the signed manifest; the
-- server now records it so the AUTOMATIC signing policy (max+1) works
-- without any manual input. Existing rows predate the column (treated as 0 —
-- no firmware-ninbus release ever deployed successfully pre-contract).

ALTER TABLE "firmware_releases" ADD COLUMN "counter" integer;
