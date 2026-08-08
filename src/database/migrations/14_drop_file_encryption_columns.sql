-- Drop file content encryption columns from files table
ALTER TABLE files
  DROP COLUMN IF EXISTS encryption_key,
  DROP COLUMN IF EXISTS encryption_iv;

COMMENT ON TABLE files IS 'File metadata and chunk information';
