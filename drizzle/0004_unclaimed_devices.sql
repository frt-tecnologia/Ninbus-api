-- Migration: Add unclaimed status and allow nullable company_id for pre-provisioned devices
-- Devices pre-provisioned at the factory have no company until claimed by an admin.

-- 1. Add 'unclaimed' to the device_status enum
ALTER TYPE device_status ADD VALUE IF NOT EXISTS 'unclaimed' BEFORE 'pending';

-- 2. Make company_id nullable (unclaimed devices have no company)
ALTER TABLE devices ALTER COLUMN company_id DROP NOT NULL;

-- 3. Make created_by nullable (system-provisioned devices may not have a user)
ALTER TABLE devices ALTER COLUMN created_by DROP NOT NULL;
