-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add index on key for faster lookups (though it's already the primary key, explicit index can help depending on the engine)
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
