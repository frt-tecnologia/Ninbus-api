-- Migration: Mender to hawkBit schema migration
-- Renames mender_device_id to hawkbit_target_id in devices table
-- Renames mender_tenant_id to hawkbit_tenant_id in companies table

-- Rename column in devices table
ALTER TABLE devices RENAME COLUMN mender_device_id TO hawkbit_target_id;

-- Rename column in companies table
ALTER TABLE companies RENAME COLUMN mender_tenant_id TO hawkbit_tenant_id;
