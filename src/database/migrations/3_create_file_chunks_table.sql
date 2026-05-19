-- Create file_chunks table for chunked file storage
CREATE TABLE IF NOT EXISTS file_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_size BIGINT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_type VARCHAR(50) NOT NULL,
  provider_file_id VARCHAR(500) NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(file_id, chunk_index)
);

-- Create indexes for file_chunks table
CREATE INDEX IF NOT EXISTS idx_chunks_file ON file_chunks(file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_account ON file_chunks(account_id);
CREATE INDEX IF NOT EXISTS idx_chunks_uploaded ON file_chunks(uploaded_at DESC);

-- Add comment
COMMENT ON TABLE file_chunks IS 'Individual chunks for large files distributed across accounts';
