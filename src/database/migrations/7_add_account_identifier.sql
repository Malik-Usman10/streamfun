-- Add account_identifier column for unique account identification
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_identifier VARCHAR(255);

-- Create unique index on provider_type + account_identifier
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_unique_identifier 
  ON accounts(provider_type, account_identifier);

-- Add comment
COMMENT ON COLUMN accounts.account_identifier IS 'Unique identifier for the account (e.g., rclone remote name, email, user ID)';
