-- Task attachments table for file uploads
-- API routes and UI already exist — this creates the missing backing table.

CREATE TABLE IF NOT EXISTS task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_size integer NOT NULL,
  mime_type text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);

-- RLS — service role (used by API routes) has full access
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on task_attachments"
  ON task_attachments
  FOR ALL
  USING (true)
  WITH CHECK (true);
