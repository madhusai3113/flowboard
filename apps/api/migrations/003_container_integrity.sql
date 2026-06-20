CREATE TRIGGER IF NOT EXISTS containers_valid_parent_insert
BEFORE INSERT ON containers
WHEN
  (NEW.type = 'workspace' AND NEW.parent_id IS NOT NULL)
  OR
  (NEW.type != 'workspace' AND NOT EXISTS (
    SELECT 1
    FROM containers parent
    WHERE parent.id = NEW.parent_id
      AND parent.type = CASE NEW.type
        WHEN 'space' THEN 'workspace'
        WHEN 'folder' THEN 'space'
        WHEN 'list' THEN 'folder'
      END
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid container parent');
END;

CREATE TRIGGER IF NOT EXISTS containers_valid_parent_update
BEFORE UPDATE OF type, parent_id ON containers
WHEN
  (NEW.type = 'workspace' AND NEW.parent_id IS NOT NULL)
  OR
  (NEW.type != 'workspace' AND NOT EXISTS (
    SELECT 1
    FROM containers parent
    WHERE parent.id = NEW.parent_id
      AND parent.type = CASE NEW.type
        WHEN 'space' THEN 'workspace'
        WHEN 'folder' THEN 'space'
        WHEN 'list' THEN 'folder'
      END
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid container parent');
END;

CREATE TRIGGER IF NOT EXISTS statuses_require_list_insert
BEFORE INSERT ON statuses
WHEN NOT EXISTS (
  SELECT 1 FROM containers WHERE id = NEW.list_id AND type = 'list'
)
BEGIN
  SELECT RAISE(ABORT, 'status owner must be a list');
END;

CREATE TRIGGER IF NOT EXISTS statuses_require_list_update
BEFORE UPDATE OF list_id ON statuses
WHEN NOT EXISTS (
  SELECT 1 FROM containers WHERE id = NEW.list_id AND type = 'list'
)
BEGIN
  SELECT RAISE(ABORT, 'status owner must be a list');
END;

CREATE TRIGGER IF NOT EXISTS tasks_require_list_insert
BEFORE INSERT ON tasks
WHEN NOT EXISTS (
  SELECT 1 FROM containers WHERE id = NEW.primary_list_id AND type = 'list'
)
BEGIN
  SELECT RAISE(ABORT, 'task owner must be a list');
END;

CREATE TRIGGER IF NOT EXISTS tasks_require_list_update
BEFORE UPDATE OF primary_list_id ON tasks
WHEN NOT EXISTS (
  SELECT 1 FROM containers WHERE id = NEW.primary_list_id AND type = 'list'
)
BEGIN
  SELECT RAISE(ABORT, 'task owner must be a list');
END;
