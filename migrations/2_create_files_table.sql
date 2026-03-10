-- Create files table
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100),
  size BIGINT NOT NULL,
  provider_type VARCHAR(50) NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_file_id VARCHAR(500) NOT NULL,
  is_chunked BOOLEAN DEFAULT FALSE,
  encryption_key TEXT,
  encryption_iv TEXT,
  metadata JSONB,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for files table
CREATE INDEX IF NOT EXISTS idx_files_account ON files(account_id);
CREATE INDEX IF NOT EXISTS idx_files_provider ON files(provider_type);
CREATE INDEX IF NOT EXISTS idx_files_uploaded ON files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_mime_type ON files(mime_type);
CREATE INDEX IF NOT EXISTS idx_files_is_chunked ON files(is_chunked);

-- Add comment
COMMENT ON TABLE files IS 'File metadata with encryption keys and chunk information';
