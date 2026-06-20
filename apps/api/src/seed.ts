import type { Db } from "./db.js";
import { transaction } from "./db.js";

const users = [
  ["alice", "Alice Admin", "admin", "#7c3aed"],
  ["bob", "Bob Builder", "member", "#0891b2"],
  ["carol", "Carol Chen", "member", "#db2777"]
] as const;

const containers = [
  ["workspace", "Flowboard", "workspace", null, 0, "public"],
  ["space-eng", "Engineering", "space", "workspace", 0, "public"],
  ["space-product", "Product", "space", "workspace", 1, "private"],
  ["folder-launch", "Q2 Launch", "folder", "space-eng", 0, "private"],
  ["folder-discovery", "Discovery", "folder", "space-product", 0, "public"],
  ["list-backlog", "Backlog", "list", "folder-launch", 0, "public"],
  ["list-sprint", "Current Sprint", "list", "folder-launch", 1, "public"],
  ["list-roadmap", "Product Roadmap", "list", "folder-discovery", 0, "public"]
] as const;

const statusTemplates = [
  ["todo", "To do", "not_started", "#94a3b8"],
  ["progress", "In progress", "active", "#3b82f6"],
  ["done", "Done", "completed", "#22c55e"]
] as const;

const taskTitles = [
  "Set up deployment pipeline",
  "Draft API conventions",
  "Design empty states",
  "Add keyboard navigation",
  "Review database indexes",
  "Build permission matrix",
  "Polish task cards",
  "Write onboarding copy",
  "Test drag and drop",
  "Document archive behavior",
  "Interview pilot users",
  "Prioritize feedback themes",
  "Sketch reporting dashboard",
  "Define week two scope",
  "Prepare stakeholder demo",
  "Audit accessibility"
];

export function seed(db: Db, force = false) {
  const count = Number((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count);
  if (count && !force) return false;

  transaction(db, () => {
    if (force) {
      db.exec("DELETE FROM task_assignees; DELETE FROM tasks; DELETE FROM statuses; DELETE FROM grants; DELETE FROM containers; DELETE FROM users;");
    }

    const insertUser = db.prepare("INSERT INTO users(id, name, role, color) VALUES (?, ?, ?, ?)");
    for (const user of users) insertUser.run(...user);

    const insertContainer = db.prepare(
      "INSERT INTO containers(id, name, type, parent_id, position, visibility) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const container of containers) insertContainer.run(...container);

    const insertGrant = db.prepare("INSERT INTO grants(resource_id, user_id, mode) VALUES (?, ?, ?)");
    insertGrant.run("space-eng", "bob", "deny");
    insertGrant.run("list-backlog", "bob", "allow");
    insertGrant.run("space-product", "carol", "allow");
    insertGrant.run("list-roadmap", "carol", "deny");

    const lists = ["list-backlog", "list-sprint", "list-roadmap"];
    const insertStatus = db.prepare(
      "INSERT INTO statuses(id, list_id, name, category, color, position) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const listId of lists) {
      statusTemplates.forEach(([suffix, name, category, color], position) => {
        insertStatus.run(`${listId}-${suffix}`, listId, name, category, color, position);
      });
    }

    const insertTask = db.prepare(
      `INSERT INTO tasks(
        id, primary_list_id, title, description, status_id, priority, due_date, position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAssignee = db.prepare("INSERT INTO task_assignees(task_id, user_id) VALUES (?, ?)");
    const priorities = ["urgent", "high", "normal", "low", "none"];
    const now = new Date("2026-06-01T09:00:00.000Z");

    taskTitles.forEach((title, index) => {
      const listId = lists[index % lists.length];
      const statusSuffix = statusTemplates[Math.floor(index / lists.length) % statusTemplates.length][0];
      const taskId = `task-${String(index + 1).padStart(2, "0")}`;
      const due = index % 4 === 0 ? null : new Date(now.getTime() + (index + 1) * 86_400_000).toISOString();
      insertTask.run(
        taskId,
        listId,
        title,
        index % 2 ? "Seeded task for the Flowboard reviewer demo." : null,
        `${listId}-${statusSuffix}`,
        priorities[index % priorities.length],
        due,
        Math.floor(index / 3),
        now.toISOString(),
        now.toISOString()
      );
      insertAssignee.run(taskId, index % 2 ? "bob" : "alice");
      if (index % 3 === 0) insertAssignee.run(taskId, "carol");
    });
  });
  return true;
}
