-- Migration: Add serial_display column for human-readable serial format
-- Stores the dotted display format (e.g. "25.5F.FF.FFF.FFFFF.F") while
-- serial_number stores the hex format used as hawkBit controllerId.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS serial_display text;

-- Backfill: for existing devices, generate display format from hex serial_number
-- Only applies to devices with hex-only serial numbers
UPDATE devices
SET serial_display = serial_number
WHERE serial_number IS NOT NULL
  AND serial_number ~ '^[0-9A-Fa-f]+$'
  AND serial_display IS NULL;
