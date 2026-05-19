-- Create scan_jobs table for tracking directory-watch auto-uploads
CREATE TABLE IF NOT EXISTS scan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path TEXT NOT NULL,                        -- absolute path inside container
  filename VARCHAR(500) NOT NULL,
  directory_name VARCHAR(500),                      -- parent dir name (becomes collection/video name)
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',    -- pending | uploading | completed | failed | skipped
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  provider_type VARCHAR(50),
  account_id UUID,
  progress INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  UNIQUE(source_path)
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_created ON scan_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_directory ON scan_jobs(directory_name);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_file_id ON scan_jobs(file_id);

COMMENT ON TABLE scan_jobs IS 'Tracks directory-watch auto-upload jobs for fault-tolerant media ingestion';
COMMENT ON COLUMN scan_jobs.source_path IS 'Absolute filesystem path inside container (unique constraint prevents double-scanning)';
COMMENT ON COLUMN scan_jobs.directory_name IS 'For images: becomes collection_name. For videos: provides display name.';
COMMENT ON COLUMN scan_jobs.status IS 'pending→uploading→completed|failed|skipped';
