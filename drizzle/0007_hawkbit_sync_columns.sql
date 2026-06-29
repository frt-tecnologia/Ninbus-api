-- Migration: Add hawkBit sync columns to devices table
-- Stores hawkBit connection/update status locally so the device list API
-- returns real-time data without N+1 hawkBit calls per request.

-- Create enum for hawkBit update status
CREATE TYPE "public"."hawkbit_update_status" AS ENUM('unknown', 'in_sync', 'pending', 'registered', 'error');

-- Add hawkBit sync columns
ALTER TABLE "devices" ADD COLUMN "connection_status" varchar(20) DEFAULT 'unknown';
ALTER TABLE "devices" ADD COLUMN "hawkbit_update_status" "hawkbit_update_status" DEFAULT 'unknown';
ALTER TABLE "devices" ADD COLUMN "ip_address" text;
ALTER TABLE "devices" ADD COLUMN "last_poll_at" timestamp;
ALTER TABLE "devices" ADD COLUMN "next_expected_poll_at" timestamp;
