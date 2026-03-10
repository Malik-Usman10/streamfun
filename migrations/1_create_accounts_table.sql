-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type VARCHAR(50) NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  tokens_encrypted TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  quota_total BIGINT,
  quota_used BIGINT,
  quota_available BIGINT,
  quota_usage_percent DECIMAL(5,2),
  quota_last_checked_at TIMESTAMP,
  last_used_at TIMESTAMP,
  last_health_check_at TIMESTAMP,
  health_latency INTEGER,
  health_error TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for accounts table
CREATE INDEX IF NOT EXISTS idx_accounts_provider_status ON accounts(provider_type, status);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at DESC);

-- Add comment
COMMENT ON TABLE accounts IS 'Storage provider accounts with credentials and quota information';
