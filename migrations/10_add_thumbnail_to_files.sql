-- Add thumbnail column to files table
ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_data TEXT;

-- Add comment
COMMENT ON COLUMN files.thumbnail_data IS 'Base64 encoded thumbnail image for videos and images';
