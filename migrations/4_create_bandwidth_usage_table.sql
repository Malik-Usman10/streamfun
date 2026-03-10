-- Create bandwidth_usage table
CREATE TABLE IF NOT EXISTS bandwidth_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('upload', 'download')),
  bytes_transferred BIGINT NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  time_window VARCHAR(20) NOT NULL CHECK (time_window IN ('hourly', 'daily', 'monthly'))
);

-- Create indexes for bandwidth_usage table
CREATE INDEX IF NOT EXISTS idx_bandwidth_account_window ON bandwidth_usage(account_id, time_window, timestamp);
CREATE INDEX IF NOT EXISTS idx_bandwidth_timestamp ON bandwidth_usage(timestamp DESC);

-- Add comment
COMMENT ON TABLE bandwidth_usage IS 'Bandwidth tracking for account rotation and monitoring';
