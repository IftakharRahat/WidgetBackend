-- ============================================
-- Live Chat System Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE (Website customers)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(255) NOT NULL,
  site_origin VARCHAR(255),
  device_hash VARCHAR(255),
  email VARCHAR(255),
  full_name VARCHAR(255),
  external_id VARCHAR(255),
  metadata JSONB,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_site_origin ON users(site_origin);
CREATE INDEX IF NOT EXISTS idx_users_external_id ON users(external_id);

-- ============================================
-- CATEGORIES TABLE (5-10 support categories)
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  auto_answer TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categories_active ON categories(is_active);

-- ============================================
-- AGENTS TABLE (Telegram-based support agents)
-- ============================================
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id BIGINT UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  is_online BOOLEAN DEFAULT false,
  handled_chats_count INT DEFAULT 0,
  avg_response_time_ms INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_online ON agents(is_online);
CREATE INDEX idx_agents_telegram ON agents(telegram_user_id);

-- ============================================
-- CHAT THREADS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  assigned_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  channel VARCHAR(20) DEFAULT 'website', -- 'website' or 'telegram'
  status VARCHAR(20) DEFAULT 'open', -- 'open', 'closed', 'pending'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_threads_user ON chat_threads(user_id);
CREATE INDEX idx_threads_agent ON chat_threads(assigned_agent_id);
CREATE INDEX idx_threads_status ON chat_threads(status);
CREATE INDEX idx_threads_created ON chat_threads(created_at);

-- ============================================
-- MESSAGES TABLE (25-day retention)
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL, -- 'customer', 'agent', 'system'
  sender_id UUID,
  content TEXT,
  media_url TEXT,
  media_type VARCHAR(50), -- 'image', 'video', 'voice', 'file'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_created ON messages(created_at);

-- ============================================
-- ANALYTICS TABLE (persisted beyond 25 days)
-- ============================================
CREATE TABLE IF NOT EXISTS analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  contact_count INT DEFAULT 1,
  last_contacted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category_id)
);

CREATE INDEX idx_analytics_user ON analytics(user_id);
CREATE INDEX idx_analytics_category ON analytics(category_id);

-- ============================================
-- AGENT ACTIVITY LOG TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  event_type VARCHAR(50), -- 'online', 'offline', 'message_handled'
  response_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_agent ON agent_activity_log(agent_id);
CREATE INDEX idx_activity_created ON agent_activity_log(created_at);

-- ============================================
-- ADMIN USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

-- Insert sample categories
INSERT INTO categories (title, description, auto_answer, sort_order) VALUES
  ('Payment Issues', 'Questions about payments, refunds, and billing', 'We are checking your payment issue. An agent will be with you shortly.', 1),
  ('Order Status', 'Track your order or report delivery issues', 'You can track your order using the tracking link in your email. An agent will assist you shortly.', 2),
  ('Product Information', 'Questions about products and availability', 'Thank you for your interest! An agent will provide detailed product information shortly.', 3),
  ('Account Issues', 'Login problems, password reset, account settings', 'Please provide your registered email address. An agent will help you shortly.', 4),
  ('Technical Support', 'Technical issues and troubleshooting', 'Please describe your technical issue in detail. Our support team will assist you shortly.', 5),
  ('General Inquiry', 'Other questions and feedback', 'Thank you for reaching out. An agent will respond to your inquiry shortly.', 6)
ON CONFLICT DO NOTHING;

-- ============================================
-- STORAGE BUCKET (Run separately)
-- ============================================
-- Create a storage bucket named 'chat-media' in Supabase Dashboard
-- Settings:
--   - Public bucket: Yes (for easy access)
--   - Allowed MIME types: image/*, video/*, application/pdf
--   - Max file size: Adjust as needed (e.g., 100MB)

-- ============================================
-- ROW LEVEL SECURITY POLICIES (Optional)
-- ============================================
-- Enable RLS if needed for additional security
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- etc.
