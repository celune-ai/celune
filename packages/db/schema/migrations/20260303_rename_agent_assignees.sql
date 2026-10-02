-- Rename agent assignees: flatten from pod hierarchy to functional roles
-- HELM → sage, VETT → scan, SAGE(career) → trek
-- Retire: LINK, LORE, COIN, KNOX, CORE, and all utility agents

-- Head renames
UPDATE tasks SET assignee = 'sage' WHERE assignee = 'head-of-product';
UPDATE tasks SET assignee = 'scan' WHERE assignee = 'head-of-quality';
UPDATE tasks SET assignee = 'trek' WHERE assignee = 'head-of-career';
UPDATE tasks SET assignee = 'noir' WHERE assignee = 'head-of-design';
UPDATE tasks SET assignee = 'delv' WHERE assignee = 'head-of-research';
UPDATE tasks SET assignee = 'echo' WHERE assignee = 'head-of-brand';
UPDATE tasks SET assignee = 'bond' WHERE assignee = 'head-of-relationships';
UPDATE tasks SET assignee = 'vita' WHERE assignee = 'head-of-growth';

-- Retired heads → reassign to rick
UPDATE tasks SET assignee = 'rick' WHERE assignee = 'head-of-engineering';
UPDATE tasks SET assignee = 'rick' WHERE assignee = 'head-of-content';
UPDATE tasks SET assignee = 'rick' WHERE assignee = 'head-of-finance';
UPDATE tasks SET assignee = 'rick' WHERE assignee = 'head-of-security';
UPDATE tasks SET assignee = 'rick' WHERE assignee = 'head-of-infrastructure';

-- Retired utility agents → reassign to rick
UPDATE tasks SET assignee = 'rick' WHERE assignee IN (
  'explorer', 'builder', 'writer', 'analyst', 'auditor',
  'scanner', 'scoper', 'prototyper', 'crawler', 'networker', 'drafter'
);

-- Also update activity_log agent_id references
UPDATE activity_log SET agent_id = 'sage' WHERE agent_id = 'head-of-product';
UPDATE activity_log SET agent_id = 'scan' WHERE agent_id = 'head-of-quality';
UPDATE activity_log SET agent_id = 'trek' WHERE agent_id = 'head-of-career';
UPDATE activity_log SET agent_id = 'noir' WHERE agent_id = 'head-of-design';
UPDATE activity_log SET agent_id = 'delv' WHERE agent_id = 'head-of-research';
UPDATE activity_log SET agent_id = 'echo' WHERE agent_id = 'head-of-brand';
UPDATE activity_log SET agent_id = 'bond' WHERE agent_id = 'head-of-relationships';
UPDATE activity_log SET agent_id = 'vita' WHERE agent_id = 'head-of-growth';
