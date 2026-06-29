-- Migration 0006: Allow created_by to be NULL for auto-provisioned devices
-- Auto-provisioned devices are created by the sync engine, not by a user.
-- onDelete changed from CASCADE to SET NULL.

ALTER TABLE devices ALTER COLUMN created_by DROP NOT NULL;
