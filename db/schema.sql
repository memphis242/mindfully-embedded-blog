PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(page_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_reactions_page_id ON reactions(page_id);

CREATE TABLE IF NOT EXISTS session_fingerprints (
  session_id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  parent_id TEXT,
  session_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  markdown_raw TEXT NOT NULL,
  markdown_html_sanitized TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('visible', 'held', 'hidden', 'deleted')),
  moderation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_page_status_created ON comments(page_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_ip_hash ON comments(ip_hash);

CREATE TABLE IF NOT EXISTS bans (
  id TEXT PRIMARY KEY,
  ban_type TEXT NOT NULL CHECK (ban_type IN ('ip_hash', 'subnet_hash')),
  subject_hash TEXT NOT NULL,
  reason TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bans_subject_hash ON bans(subject_hash);

CREATE TABLE IF NOT EXISTS moderation_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_moderation_audit_created_at ON moderation_audit(created_at);

CREATE TABLE IF NOT EXISTS client_leads (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL CHECK (service_type IN ('training', 'consulting', 'contracts')),
  session_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message_raw TEXT NOT NULL,
  consent_given INTEGER NOT NULL CHECK (consent_given IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('new', 'contacted', 'closed', 'spam')),
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_leads_created_at ON client_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_client_leads_status_created_at ON client_leads(status, created_at);
CREATE INDEX IF NOT EXISTS idx_client_leads_service_created_at ON client_leads(service_type, created_at);
