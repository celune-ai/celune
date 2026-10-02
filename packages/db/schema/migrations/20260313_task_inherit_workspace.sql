-- Task workspace_id inheritance trigger
-- When a task is inserted or updated with a project_id but no workspace_id,
-- automatically inherit workspace_id from the parent project.
-- This prevents orphaned tasks that don't appear in the workspace UI.

CREATE OR REPLACE FUNCTION public.task_inherit_workspace_id()
RETURNS trigger AS $$
BEGIN
  -- Only act when project_id is set and workspace_id is null
  IF NEW.project_id IS NOT NULL AND NEW.workspace_id IS NULL THEN
    SELECT workspace_id INTO NEW.workspace_id
    FROM projects
    WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fire before insert/update so we can modify NEW
DROP TRIGGER IF EXISTS task_inherit_workspace_id_trigger ON tasks;
CREATE TRIGGER task_inherit_workspace_id_trigger
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.task_inherit_workspace_id();
