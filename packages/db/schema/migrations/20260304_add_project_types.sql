-- Add 'research' and 'plan' to project_type enum
ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'research';
ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'plan';
