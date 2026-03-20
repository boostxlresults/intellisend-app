-- Migration: Add revenue attribution fields to Campaign and Conversation
-- Run this against your Railway PostgreSQL database

-- Add revenue tracking fields to Campaign
ALTER TABLE "Campaign" 
  ADD COLUMN IF NOT EXISTS "totalBookings" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0.0;

-- Add job ID and revenue to Conversation for per-conversation attribution
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "serviceTitanJobId" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceTitanRevenue" DOUBLE PRECISION;

-- Index for efficient revenue sync queries
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_booking_revenue_idx" 
  ON "Conversation" ("tenantId", "serviceTitanBookingId", "serviceTitanRevenue");
