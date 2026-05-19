-- Add collection_name and category columns to files table
ALTER TABLE files ADD COLUMN IF NOT EXISTS collection_name VARCHAR(255);
ALTER TABLE files ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_collection ON files(collection_name);

-- Add comments
COMMENT ON COLUMN files.collection_name IS 'Collection name for grouping related files (especially images)';
COMMENT ON COLUMN files.category IS 'File category: video or image, derived from MIME type';
