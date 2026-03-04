-- ============================================
-- FB Marketplace Tool: Per-User Contact Info
-- Run this in Supabase SQL Editor AFTER v2 migration
-- ============================================

-- 1. Add phone and display_name to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;

-- 2. Set defaults for existing admin user (Gunner)
-- UPDATE profiles SET phone = '435-633-0213', display_name = 'Gunner' WHERE email = 'gunnerhillin@outlook.com';
