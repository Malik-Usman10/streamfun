-- Prevent duplicate files in the same category
-- Using COALESCE for collection_name because NULL <> NULL in standard UNIQUE constraints
CREATE UNIQUE INDEX idx_files_unique_filename_size_collection 
ON files (filename, size, COALESCE(collection_name, ''));

-- Add comment
COMMENT ON INDEX idx_files_unique_filename_size_collection IS 'Prevents duplicate files in the same category (handles NULL collections)';
