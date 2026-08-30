-- Add use_count column for source popularity signals
ALTER TABLE agents ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;
