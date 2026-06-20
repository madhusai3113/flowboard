CREATE TRIGGER IF NOT EXISTS tasks_status_matches_list_insert
BEFORE INSERT ON tasks
WHEN NOT EXISTS (
  SELECT 1 FROM statuses
  WHERE id = NEW.status_id AND list_id = NEW.primary_list_id
)
BEGIN
  SELECT RAISE(ABORT, 'task status must belong to primary list');
END;

CREATE TRIGGER IF NOT EXISTS tasks_status_matches_list_update
BEFORE UPDATE OF primary_list_id, status_id ON tasks
WHEN NOT EXISTS (
  SELECT 1 FROM statuses
  WHERE id = NEW.status_id AND list_id = NEW.primary_list_id
)
BEGIN
  SELECT RAISE(ABORT, 'task status must belong to primary list');
END;

