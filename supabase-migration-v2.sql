-- ============================================
-- FB Marketplace Tool: Multi-User Migration
-- Run this in Supabase SQL Editor AFTER v1 migration
-- ============================================

-- 1. Profiles table (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'salesperson' CHECK (role IN ('admin', 'salesperson')),
  daily_post_limit INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add user tracking columns to vehicles
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS queued_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 3. Add user tracking to posting_log
ALTER TABLE posting_log ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 4. Replace posting_daily_count with per-user version
DROP TABLE IF EXISTS posting_daily_count;
CREATE TABLE posting_daily_count (
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  count INTEGER DEFAULT 0,
  last_post_at TIMESTAMPTZ,
  PRIMARY KEY (date, user_id)
);

-- 5. Auto-create profile on signup via trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'salesperson')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_daily_count ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies for profiles
CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can manage all profiles"
  ON profiles FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 8. RLS Policies for vehicles (everyone reads, admin manages)
CREATE POLICY "Authenticated users can view vehicles"
  ON vehicles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert vehicles"
  ON vehicles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete vehicles"
  ON vehicles FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Authenticated users can update vehicles"
  ON vehicles FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 9. RLS Policies for posting_log
CREATE POLICY "Users can view own posting logs"
  ON posting_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can insert posting logs"
  ON posting_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 10. RLS Policies for posting_daily_count
CREATE POLICY "Users can view own daily count"
  ON posting_daily_count FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can manage daily counts"
  ON posting_daily_count FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 11. Index for per-user queue lookups
CREATE INDEX IF NOT EXISTS idx_vehicles_queued_by ON vehicles(queued_by);
CREATE INDEX IF NOT EXISTS idx_posting_log_user ON posting_log(user_id);
