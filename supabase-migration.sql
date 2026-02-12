-- ============================================
-- FB Marketplace Auto-Poster: Database Setup
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Add posting columns to vehicles table (skip if already exist)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fb_status TEXT DEFAULT 'not_posted';
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fb_posted_at TIMESTAMPTZ;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fb_listing_url TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fb_queued_at TIMESTAMPTZ;

-- 2. Posting activity log
CREATE TABLE IF NOT EXISTS posting_log (
  id BIGSERIAL PRIMARY KEY,
  vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,           -- 'posted', 'failed', 'removed', 'queued', 'skipped'
  details TEXT,                   -- Error message or notes
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Daily posting counter (resets daily)
CREATE TABLE IF NOT EXISTS posting_daily_count (
  date DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  count INTEGER DEFAULT 0,
  last_post_at TIMESTAMPTZ
);

-- 4. Index for quick queue lookups
CREATE INDEX IF NOT EXISTS idx_vehicles_fb_status ON vehicles(fb_status);
CREATE INDEX IF NOT EXISTS idx_posting_log_created ON posting_log(created_at DESC);
