-- Create account_quotas table for caching quota information
CREATE TABLE IF NOT EXISTS account_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  total_space BIGINT NOT NULL,
  used_space BIGINT NOT NULL,
  available_space BIGINT NOT NULL,
  last_refreshed TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

-- Create index for efficient sorting by available space
CREATE INDEX IF NOT EXISTS idx_account_quotas_available ON account_quotas(available_space DESC);
CREATE INDEX IF NOT EXISTS idx_account_quotas_account ON account_quotas(account_id);

-- Add comment
COMMENT ON TABLE account_quotas IS 'Cached quota information for accounts to enable intelligent account selection';
