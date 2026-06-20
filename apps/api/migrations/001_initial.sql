CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('workspace', 'space', 'folder', 'list')),
  parent_id TEXT REFERENCES containers(id),
  position INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS containers_parent_idx ON containers(parent_id, position);

CREATE TABLE IF NOT EXISTS grants (
  resource_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('allow', 'deny')),
  PRIMARY KEY (resource_id, user_id)
);

CREATE TABLE IF NOT EXISTS statuses (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('not_started', 'active', 'completed')),
  color TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE(list_id, id)
);
CREATE INDEX IF NOT EXISTS statuses_list_idx ON statuses(list_id, position);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  primary_list_id TEXT NOT NULL REFERENCES containers(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description TEXT,
  status_id TEXT NOT NULL REFERENCES statuses(id),
  priority TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('urgent', 'high', 'normal', 'low', 'none')),
  due_date TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_column_idx ON tasks(primary_list_id, status_id, position);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
