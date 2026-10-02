-- Migration 20260926_project_type_system_value: adds the 'system' value to project_type.
-- Kept in its own file so 20260926_reconstruct_hosted_drift.sql can use the value; Postgres
-- rejects a new enum value in the transaction that adds it. No-op on the hosted project.

ALTER TYPE project_type ADD VALUE IF NOT EXISTS 'system';
