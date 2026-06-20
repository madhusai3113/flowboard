import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  containerSchema,
  createTaskSchema,
  grantSchema,
  moveContainerSchema,
  moveTaskSchema,
  reorderSchema,
  statusSchema,
  updateContainerSchema,
  updateTaskSchema,
  type ContainerNode,
  type Task,
  type User
} from "@flowboard/shared";
import type { Db } from "./db.js";
import { transaction } from "./db.js";
import { errors, HttpError } from "./http.js";
import { accessibleIds, canAccess } from "./permissions.js";

interface ContainerRow {
  id: string;
  name: string;
  type: "workspace" | "space" | "folder" | "list";
  parent_id: string | null;
  position: number;
  visibility: "public" | "private";
  archived_at: string | null;
}

function containerDto(row: ContainerRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    parentId: row.parent_id,
    position: row.position,
    visibility: row.visibility,
    archivedAt: row.archived_at
  };
}

interface TaskRow {
  id: string;
  primary_list_id: string;
  title: string;
  description: string | null;
  status_id: string;
  priority: Task["priority"];
  due_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

const validParent: Record<string, string | null> = {
  workspace: null,
  space: "workspace",
  folder: "space",
  list: "folder"
};

function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw errors.validation(error.issues.map((issue) => issue.message).join("; "));
    }
    throw error;
  }
}

function userFrom(res: Response): User {
  return res.locals.user as User;
}

function requireAdmin(res: Response) {
  const user = userFrom(res);
  if (user.role !== "admin") throw errors.forbidden();
  return user;
}

function containerOrThrow(db: Db, id: string) {
  const row = db.prepare("SELECT * FROM containers WHERE id = ?").get(id) as ContainerRow | undefined;
  if (!row || row.archived_at) throw errors.notFound("Container");
  return row;
}

function requireContainerAccess(db: Db, user: User, id: string) {
  const row = containerOrThrow(db, id);
  if (!canAccess(db, user.id, user.role, id)) throw errors.forbidden();
  return row;
}

function normalize(db: Db, table: "containers" | "statuses" | "tasks", where: string, params: (string | number | null)[]) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE ${where} ORDER BY position, id`).all(...params) as { id: string }[];
  const update = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
  rows.forEach((row, index) => update.run(index, row.id));
}

function placeAt(
  db: Db,
  table: "containers" | "statuses" | "tasks",
  id: string,
  where: string,
  params: (string | number | null)[],
  position: number
) {
  const rows = db.prepare(
    `SELECT id FROM ${table} WHERE ${where} AND id != ? ORDER BY position, id`
  ).all(...params, id) as { id: string }[];
  rows.splice(Math.min(position, rows.length), 0, { id });
  const update = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
  rows.forEach((row, index) => update.run(index, row.id));
}

function assigneesFor(db: Db, taskId: string): User[] {
  return db.prepare(
    `SELECT u.id, u.name, u.role, u.color
     FROM users u JOIN task_assignees ta ON ta.user_id = u.id
     WHERE ta.task_id = ? ORDER BY u.name`
  ).all(taskId) as unknown as User[];
}

function taskDto(db: Db, row: TaskRow): Task {
  const assignees = assigneesFor(db, row.id);
  return {
    id: row.id,
    primaryListId: row.primary_list_id,
    title: row.title,
    description: row.description,
    statusId: row.status_id,
    priority: row.priority,
    assigneeIds: assignees.map((user) => user.id),
    assignees,
    dueDate: row.due_date,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function replaceAssignees(db: Db, taskId: string, userIds: string[]) {
  const unique = [...new Set(userIds)];
  const known = db.prepare(
    `SELECT id FROM users WHERE id IN (${unique.map(() => "?").join(",") || "NULL"})`
  ).all(...unique) as { id: string }[];
  if (known.length !== unique.length) throw errors.validation("Every assignee must be a workspace user.");
  db.prepare("DELETE FROM task_assignees WHERE task_id = ?").run(taskId);
  const insert = db.prepare("INSERT INTO task_assignees(task_id, user_id) VALUES (?, ?)");
  unique.forEach((userId) => insert.run(taskId, userId));
}

function validateStatus(db: Db, listId: string, statusId: string) {
  const status = db.prepare("SELECT id FROM statuses WHERE id = ? AND list_id = ?").get(statusId, listId);
  if (!status) throw errors.validation("Status must belong to the task's list.");
}

export function createApp(db: Db) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => res.json({ data: { status: "ok" } }));

  app.use((req, res, next) => {
    const id = req.header("X-User-Id");
    const user = id
      ? db.prepare("SELECT id, name, role, color FROM users WHERE id = ?").get(id)
      : undefined;
    if (!user) return next(errors.unauthorized());
    res.locals.user = user;
    next();
  });

  app.get("/api/users", (_req, res) => {
    const users = db.prepare("SELECT id, name, role, color FROM users ORDER BY role, name").all();
    res.json({ data: users });
  });

  app.get("/api/tree", (_req, res) => {
    const user = userFrom(res);
    const rows = db.prepare(
      "SELECT id, name, type, parent_id, position, visibility, archived_at FROM containers WHERE archived_at IS NULL ORDER BY position, name"
    ).all() as unknown as ContainerRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const visible = accessibleIds(db, user.id, user.role);
    const included = new Set(visible);
    for (const id of visible) {
      let parent = byId.get(id)?.parent_id;
      while (parent) {
        included.add(parent);
        parent = byId.get(parent)?.parent_id ?? null;
      }
    }

    const nodes = new Map<string, ContainerNode>();
    rows.filter((row) => included.has(row.id)).forEach((row) => {
      const restricted = !visible.has(row.id);
      nodes.set(row.id, {
        id: row.id,
        name: restricted ? "Restricted" : row.name,
        type: row.type,
        parentId: row.parent_id,
        position: row.position,
        visibility: row.visibility,
        restricted,
        children: []
      });
    });
    const roots: ContainerNode[] = [];
    nodes.forEach((node) => {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    });
    res.json({ data: roots });
  });

  app.get("/api/grants", (_req, res) => {
    requireAdmin(res);
    const grants = db.prepare(
      `SELECT
         g.resource_id AS resourceId,
         c.name AS resourceName,
         c.type AS resourceType,
         g.user_id AS userId,
         u.name AS userName,
         g.mode
       FROM grants g
       JOIN containers c ON c.id = g.resource_id
       JOIN users u ON u.id = g.user_id
       WHERE c.archived_at IS NULL
       ORDER BY c.name, u.name`
    ).all();
    res.json({ data: grants });
  });

  app.get("/api/containers/archived", (_req, res) => {
    requireAdmin(res);
    const containers = db.prepare(
      `SELECT id, name, type, parent_id AS parentId, position, visibility, archived_at AS archivedAt
       FROM containers WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, name`
    ).all();
    res.json({ data: containers });
  });

  app.put("/api/grants/:resourceId/:userId", (req, res) => {
    requireAdmin(res);
    const resource = containerOrThrow(db, req.params.resourceId);
    if (resource.type === "workspace") throw errors.validation("Grants can only attach to spaces, folders, or lists.");
    const grantee = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.userId);
    if (!grantee) throw errors.notFound("User");
    const { mode } = parse(grantSchema, req.body);
    db.prepare(
      `INSERT INTO grants(resource_id, user_id, mode) VALUES (?, ?, ?)
       ON CONFLICT(resource_id, user_id) DO UPDATE SET mode = excluded.mode`
    ).run(resource.id, req.params.userId, mode);
    res.json({
      data: {
        resourceId: resource.id,
        userId: req.params.userId,
        mode
      }
    });
  });

  app.delete("/api/grants/:resourceId/:userId", (req, res) => {
    requireAdmin(res);
    containerOrThrow(db, req.params.resourceId);
    db.prepare("DELETE FROM grants WHERE resource_id = ? AND user_id = ?")
      .run(req.params.resourceId, req.params.userId);
    res.status(204).end();
  });

  app.get("/api/containers/:id/access", (req, res) => {
    const resource = requireContainerAccess(db, userFrom(res), req.params.id);
    if (resource.type === "workspace") throw errors.validation("Access checks apply to spaces, folders, and lists.");
    const users = db.prepare("SELECT id, role FROM users ORDER BY name").all() as { id: string; role: string }[];
    const explicit = db.prepare("SELECT user_id, mode FROM grants WHERE resource_id = ?").all(resource.id) as {
      user_id: string;
      mode: "allow" | "deny";
    }[];
    const modes = new Map(explicit.map((grant) => [grant.user_id, grant.mode]));
    res.json({
      data: users.map((user) => ({
        userId: user.id,
        canAccess: canAccess(db, user.id, user.role, resource.id),
        explicitMode: modes.get(user.id) ?? null
      }))
    });
  });

  app.post("/api/containers", (req, res) => {
    requireAdmin(res);
    const input = parse(containerSchema, req.body);
    if (input.type === "workspace") throw errors.validation("Only one workspace is supported.");
    const parent = input.parentId ? containerOrThrow(db, input.parentId) : null;
    if (!parent || parent.type !== validParent[input.type]) throw errors.validation("Invalid parent type.");
    const position = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM containers WHERE parent_id = ? AND archived_at IS NULL"
    ).get(input.parentId) as { count: number }).count);
    const id = randomUUID();
    transaction(db, () => {
      db.prepare(
        "INSERT INTO containers(id, name, type, parent_id, position, visibility) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, input.name, input.type, input.parentId, position, input.visibility);
      if (input.type === "list") {
        const insert = db.prepare(
          "INSERT INTO statuses(id, list_id, name, category, color, position) VALUES (?, ?, ?, ?, ?, ?)"
        );
        insert.run(randomUUID(), id, "To do", "not_started", "#94a3b8", 0);
        insert.run(randomUUID(), id, "In progress", "active", "#3b82f6", 1);
        insert.run(randomUUID(), id, "Done", "completed", "#22c55e", 2);
      }
    });
    res.status(201).json({ data: containerDto(containerOrThrow(db, id)) });
  });

  app.patch("/api/containers/:id", (req, res) => {
    requireAdmin(res);
    const row = containerOrThrow(db, req.params.id);
    const input = parse(updateContainerSchema, req.body);
    db.prepare(
      "UPDATE containers SET name = ?, visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(input.name ?? row.name, input.visibility ?? row.visibility, row.id);
    res.json({ data: containerDto(containerOrThrow(db, row.id)) });
  });

  app.post("/api/containers/:id/move", (req, res) => {
    requireAdmin(res);
    const row = containerOrThrow(db, req.params.id);
    if (row.type === "workspace") throw errors.validation("Workspace cannot be moved.");
    const input = parse(moveContainerSchema, req.body);
    const parent = input.parentId ? containerOrThrow(db, input.parentId) : null;
    if (!parent || parent.type !== validParent[row.type]) throw errors.validation("Invalid parent type.");
    transaction(db, () => {
      const oldParent = row.parent_id;
      db.prepare("UPDATE containers SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(input.parentId, row.id);
      placeAt(db, "containers", row.id, "parent_id = ? AND archived_at IS NULL", [input.parentId], input.position);
      if (oldParent && oldParent !== input.parentId) normalize(db, "containers", "parent_id = ? AND archived_at IS NULL", [oldParent]);
    });
    res.json({ data: containerDto(containerOrThrow(db, row.id)) });
  });

  app.delete("/api/containers/:id", (req, res) => {
    requireAdmin(res);
    const row = containerOrThrow(db, req.params.id);
    if (row.type === "workspace") throw errors.validation("Workspace cannot be archived.");
    transaction(db, () => {
      db.prepare("UPDATE containers SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
      if (row.parent_id) normalize(db, "containers", "parent_id = ? AND archived_at IS NULL", [row.parent_id]);
    });
    res.status(204).end();
  });

  app.post("/api/containers/:id/restore", (req, res) => {
    requireAdmin(res);
    const row = db.prepare("SELECT * FROM containers WHERE id = ?").get(req.params.id) as ContainerRow | undefined;
    if (!row) throw errors.notFound("Container");
    if (!row.archived_at) throw errors.conflict("Container is not archived.");
    if (row.parent_id) containerOrThrow(db, row.parent_id);
    transaction(db, () => {
      const position = row.parent_id
        ? Number((db.prepare(
          "SELECT COUNT(*) AS count FROM containers WHERE parent_id = ? AND archived_at IS NULL"
        ).get(row.parent_id) as { count: number }).count)
        : 0;
      db.prepare(
        "UPDATE containers SET archived_at = NULL, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(position, row.id);
    });
    res.json({ data: containerDto(containerOrThrow(db, row.id)) });
  });

  app.get("/api/lists/:listId/statuses", (req, res) => {
    requireContainerAccess(db, userFrom(res), req.params.listId);
    const statuses = db.prepare(
      "SELECT id, list_id AS listId, name, category, color, position FROM statuses WHERE list_id = ? ORDER BY position"
    ).all(req.params.listId);
    res.json({ data: statuses });
  });

  app.post("/api/lists/:listId/statuses", (req, res) => {
    requireAdmin(res);
    const list = requireContainerAccess(db, userFrom(res), req.params.listId);
    if (list.type !== "list") throw errors.validation("Statuses belong to lists.");
    const input = parse(statusSchema, req.body);
    const count = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM statuses WHERE list_id = ?"
    ).get(list.id) as { count: number }).count);
    const position = input.position ?? count;
    const id = randomUUID();
    transaction(db, () => {
      db.prepare("INSERT INTO statuses(id, list_id, name, category, color, position) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, list.id, input.name, input.category, input.color, count);
      placeAt(db, "statuses", id, "list_id = ?", [list.id], position);
    });
    const status = db.prepare(
      "SELECT id, list_id AS listId, name, category, color, position FROM statuses WHERE id = ?"
    ).get(id);
    res.status(201).json({ data: status });
  });

  app.patch("/api/statuses/:id", (req, res) => {
    requireAdmin(res);
    const current = db.prepare("SELECT * FROM statuses WHERE id = ?").get(req.params.id) as {
      id: string;
      list_id: string;
      name: string;
      category: string;
      color: string;
    } | undefined;
    if (!current) throw errors.notFound("Status");
    requireContainerAccess(db, userFrom(res), current.list_id as string);
    const input = parse(statusSchema.partial(), req.body);
    db.prepare("UPDATE statuses SET name = ?, category = ?, color = ? WHERE id = ?").run(
      input.name ?? current.name,
      input.category ?? current.category,
      input.color ?? current.color,
      req.params.id
    );
    res.json({ data: db.prepare(
      "SELECT id, list_id AS listId, name, category, color, position FROM statuses WHERE id = ?"
    ).get(req.params.id) });
  });

  app.put("/api/lists/:listId/statuses/reorder", (req, res) => {
    requireAdmin(res);
    requireContainerAccess(db, userFrom(res), req.params.listId);
    const { orderedIds } = parse(reorderSchema, req.body);
    const existing = db.prepare("SELECT id FROM statuses WHERE list_id = ? ORDER BY position").all(req.params.listId) as { id: string }[];
    if (existing.length !== orderedIds.length || existing.some(({ id }) => !orderedIds.includes(id))) {
      throw errors.validation("orderedIds must include every status in the list exactly once.");
    }
    transaction(db, () => {
      const update = db.prepare("UPDATE statuses SET position = ? WHERE id = ?");
      orderedIds.forEach((id, index) => update.run(index, id));
    });
    res.status(204).end();
  });

  app.delete("/api/statuses/:id", (req, res) => {
    requireAdmin(res);
    const status = db.prepare("SELECT * FROM statuses WHERE id = ?").get(req.params.id) as { id: string; list_id: string } | undefined;
    if (!status) throw errors.notFound("Status");
    requireContainerAccess(db, userFrom(res), status.list_id);
    const used = Number((db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status_id = ?").get(status.id) as { count: number }).count);
    if (used) throw errors.conflict("Cannot delete a status that is in use.");
    const count = Number((db.prepare("SELECT COUNT(*) AS count FROM statuses WHERE list_id = ?").get(status.list_id) as { count: number }).count);
    if (count === 1) throw errors.conflict("Cannot delete the final status in a list.");
    db.prepare("DELETE FROM statuses WHERE id = ?").run(status.id);
    normalize(db, "statuses", "list_id = ?", [status.list_id]);
    res.status(204).end();
  });

  app.get("/api/lists/:listId/tasks", (req, res) => {
    const list = requireContainerAccess(db, userFrom(res), req.params.listId);
    if (list.type !== "list") throw errors.validation("Tasks belong to lists.");
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const sort = String(req.query.sort ?? "position");
    const direction = String(req.query.direction ?? "asc") === "desc" ? "DESC" : "ASC";
    const order = sort === "dueDate"
      ? `due_date IS NULL, due_date ${direction}, position`
      : sort === "priority"
        ? `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ${direction}, position`
        : "status_id, position";
    const rows = db.prepare(
      `SELECT * FROM tasks WHERE primary_list_id = ? ORDER BY ${order} LIMIT ? OFFSET ?`
    ).all(list.id, limit, offset) as unknown as TaskRow[];
    const total = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM tasks WHERE primary_list_id = ?"
    ).get(list.id) as { count: number }).count);
    res.json({ data: rows.map((row) => taskDto(db, row)), meta: { offset, limit, total } });
  });

  app.post("/api/lists/:listId/tasks", (req, res) => {
    const list = requireContainerAccess(db, userFrom(res), req.params.listId);
    if (list.type !== "list") throw errors.validation("Tasks belong to lists.");
    const input = parse(createTaskSchema, req.body);
    validateStatus(db, list.id, input.statusId);
    const position = Number((db.prepare(
      "SELECT COUNT(*) AS count FROM tasks WHERE primary_list_id = ? AND status_id = ?"
    ).get(list.id, input.statusId) as { count: number }).count);
    const id = randomUUID();
    const now = new Date().toISOString();
    transaction(db, () => {
      db.prepare(
        `INSERT INTO tasks(id, primary_list_id, title, description, status_id, priority, due_date, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, list.id, input.title, input.description ?? null, input.statusId, input.priority, input.dueDate ?? null, position, now, now);
      replaceAssignees(db, id, input.assigneeIds);
    });
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as TaskRow;
    res.status(201).json({ data: taskDto(db, row) });
  });

  app.get("/api/tasks/:id", (req, res) => {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as unknown as TaskRow | undefined;
    if (!row) throw errors.notFound("Task");
    requireContainerAccess(db, userFrom(res), row.primary_list_id);
    res.json({ data: taskDto(db, row) });
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const current = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as unknown as TaskRow | undefined;
    if (!current) throw errors.notFound("Task");
    const user = userFrom(res);
    requireContainerAccess(db, user, current.primary_list_id);
    const input = parse(updateTaskSchema, req.body);
    const listId = input.primaryListId ?? current.primary_list_id;
    const destination = requireContainerAccess(db, user, listId);
    if (destination.type !== "list") throw errors.validation("Destination must be a list.");
    if (listId !== current.primary_list_id && !input.statusId) {
      throw errors.validation("statusId is required when moving a task to another list.");
    }
    const statusId = input.statusId ?? current.status_id;
    validateStatus(db, listId, statusId);
    const columnChanged = listId !== current.primary_list_id || statusId !== current.status_id;
    transaction(db, () => {
      db.prepare(
        `UPDATE tasks
         SET primary_list_id = ?, title = ?, description = ?, status_id = ?, priority = ?, due_date = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        listId,
        input.title ?? current.title,
        input.description === undefined ? current.description : input.description,
        statusId,
        input.priority ?? current.priority,
        input.dueDate === undefined ? current.due_date : input.dueDate,
        new Date().toISOString(),
        current.id
      );
      if (input.assigneeIds) replaceAssignees(db, current.id, input.assigneeIds);
      if (columnChanged || input.position !== undefined) {
        placeAt(
          db,
          "tasks",
          current.id,
          "primary_list_id = ? AND status_id = ?",
          [listId, statusId],
          input.position ?? Number.MAX_SAFE_INTEGER
        );
      }
      if (columnChanged) {
        normalize(db, "tasks", "primary_list_id = ? AND status_id = ?", [
          current.primary_list_id,
          current.status_id
        ]);
      }
    });
    res.json({ data: taskDto(db, db.prepare("SELECT * FROM tasks WHERE id = ?").get(current.id) as unknown as TaskRow) });
  });

  app.post("/api/tasks/:id/move", (req, res) => {
    const current = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as unknown as TaskRow | undefined;
    if (!current) throw errors.notFound("Task");
    const user = userFrom(res);
    requireContainerAccess(db, user, current.primary_list_id);
    const input = parse(moveTaskSchema, req.body);
    const destination = requireContainerAccess(db, user, input.listId);
    if (destination.type !== "list") throw errors.validation("Destination must be a list.");
    validateStatus(db, input.listId, input.statusId);
    transaction(db, () => {
      const oldList = current.primary_list_id;
      const oldStatus = current.status_id;
      db.prepare(
        "UPDATE tasks SET primary_list_id = ?, status_id = ?, updated_at = ? WHERE id = ?"
      ).run(input.listId, input.statusId, new Date().toISOString(), current.id);
      placeAt(
        db,
        "tasks",
        current.id,
        "primary_list_id = ? AND status_id = ?",
        [input.listId, input.statusId],
        input.position
      );
      if (oldList !== input.listId || oldStatus !== input.statusId) {
        normalize(db, "tasks", "primary_list_id = ? AND status_id = ?", [oldList, oldStatus]);
      }
    });
    res.json({ data: taskDto(db, db.prepare("SELECT * FROM tasks WHERE id = ?").get(current.id) as unknown as TaskRow) });
  });

  app.delete("/api/tasks/:id", (req, res) => {
    const current = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id) as unknown as TaskRow | undefined;
    if (!current) throw errors.notFound("Task");
    requireContainerAccess(db, userFrom(res), current.primary_list_id);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(current.id);
    normalize(db, "tasks", "primary_list_id = ? AND status_id = ?", [current.primary_list_id, current.status_id]);
    res.status(204).end();
  });

  app.use((_req, _res, next) => next(errors.notFound("Route")));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const malformedJson = error instanceof SyntaxError
      && typeof error === "object"
      && error !== null
      && "type" in error
      && error.type === "entity.parse.failed";
    const normalized = error instanceof HttpError
      ? error
      : malformedJson
        ? errors.validation("Request body must contain valid JSON.")
        : new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    if (normalized.status === 500) console.error(error);
    res.status(normalized.status).json({ error: { code: normalized.code, message: normalized.message } });
  });

  return app;
}
