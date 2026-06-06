-- Diagnostic queries to check if restore worked

-- 1. Check if accounts table has data
SELECT 'accounts' as table_name, COUNT(*) as count FROM accounts;

-- 2. Check if files table has data  
SELECT 'files' as table_name, COUNT(*) as count FROM files;

-- 3. Show first 5 accounts with their identifiers
SELECT id, provider_type, account_identifier, status, created_at 
FROM accounts 
ORDER BY created_at DESC 
LIMIT 5;

-- 4. Show first 5 files with their account references
SELECT f.id, f.filename, f.mime_type, f.account_id, a.account_identifier
FROM files f
LEFT JOIN accounts a ON f.account_id = a.id
ORDER BY f.uploaded_at DESC
LIMIT 5;

-- 5. Check for orphaned files (files without valid account)
SELECT COUNT(*) as orphaned_files
FROM files f
LEFT JOIN accounts a ON f.account_id = a.id
WHERE a.id IS NULL;

-- 6. Check settings table for backup configuration
SELECT key, value 
FROM settings 
WHERE key LIKE 'backup%'
ORDER BY key;
