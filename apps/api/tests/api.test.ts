import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase, type Db } from "../src/db.js";
import { migrate } from "../src/migrations.js";
import { seed } from "../src/seed.js";

describe("Flowboard API", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    migrate(db);
    seed(db);
    app = createApp(db);
  });

  afterEach(() => db.close());

  it("requires a known mock user", async () => {
    await request(app).get("/api/tree").expect(401, {
      error: { code: "UNAUTHORIZED", message: "Missing or unknown X-User-Id." }
    });
    await request(app).get("/api/tree").set("X-User-Id", "nobody").expect(401);
  });

  it("shows Alice the entire tree", async () => {
    const response = await request(app).get("/api/tree").set("X-User-Id", "alice").expect(200);
    const json = JSON.stringify(response.body.data);
    expect(json).toContain("Engineering");
    expect(json).toContain("Product");
    expect(json).toContain("Current Sprint");
    expect(json).toContain("Product Roadmap");
    expect(json).not.toContain("Restricted");
  });

  it("shows Bob a restricted path to his explicitly allowed list", async () => {
    const response = await request(app).get("/api/tree").set("X-User-Id", "bob").expect(200);
    const json = JSON.stringify(response.body.data);
    expect(json).toContain("Backlog");
    expect(json).toContain("Restricted");
    expect(json).not.toContain("Current Sprint");
    expect(json).not.toContain("Product Roadmap");
  });

  it("shows Carol the Product branch but hides the specifically denied list", async () => {
    const response = await request(app).get("/api/tree").set("X-User-Id", "carol").expect(200);
    const json = JSON.stringify(response.body.data);
    expect(json).toContain("Product");
    expect(json).toContain("Discovery");
    expect(json).not.toContain("Product Roadmap");
  });

  it("distinguishes forbidden resources from nonexistent resources", async () => {
    await request(app)
      .get("/api/lists/list-sprint/tasks")
      .set("X-User-Id", "bob")
      .expect(403, { error: { code: "FORBIDDEN", message: "You do not have access to this resource." } });
    await request(app)
      .get("/api/lists/list-does-not-exist/tasks")
      .set("X-User-Id", "alice")
      .expect(404);
  });

  it("validates task status membership and supports an allowed task update", async () => {
    await request(app)
      .post("/api/lists/list-backlog/tasks")
      .set("X-User-Id", "bob")
      .send({ title: "Invalid status", statusId: "list-sprint-todo" })
      .expect(422);

    const created = await request(app)
      .post("/api/lists/list-backlog/tasks")
      .set("X-User-Id", "bob")
      .send({
        title: "Reviewer task",
        statusId: "list-backlog-todo",
        priority: "high",
        assigneeIds: ["bob"]
      })
      .expect(201);

    await request(app)
      .post(`/api/tasks/${created.body.data.id}/move`)
      .set("X-User-Id", "bob")
      .send({ listId: "list-backlog", statusId: "list-backlog-progress", position: 0 })
      .expect(200)
      .expect((response) => expect(response.body.data.statusId).toBe("list-backlog-progress"));
  });

  it("reserves status configuration for admins", async () => {
    await request(app)
      .post("/api/lists/list-backlog/statuses")
      .set("X-User-Id", "bob")
      .send({ name: "Review", category: "active", color: "#123456" })
      .expect(403);
    await request(app)
      .patch("/api/statuses/list-backlog-todo")
      .set("X-User-Id", "bob")
      .send({ name: "Queued" })
      .expect(403);
  });

  it("creates the required default statuses with every new list", async () => {
    const created = await request(app)
      .post("/api/containers")
      .set("X-User-Id", "alice")
      .send({ name: "QA", type: "list", parentId: "folder-launch", visibility: "public" })
      .expect(201);
    expect(created.body.data).toMatchObject({
      name: "QA",
      type: "list",
      parentId: "folder-launch",
      archivedAt: null
    });
    expect(created.body.data).not.toHaveProperty("parent_id");
    expect(created.body.data).not.toHaveProperty("archived_at");
    const statuses = db.prepare(
      "SELECT name, category, position FROM statuses WHERE list_id = ? ORDER BY position"
    ).all(created.body.data.id) as { name: string; category: string; position: number }[];
    expect(statuses).toEqual([
      { name: "To do", category: "not_started", position: 0 },
      { name: "In progress", category: "active", position: 1 },
      { name: "Done", category: "completed", position: 2 }
    ]);
  });

  it("lets admins manage grants without assignment implicitly changing access", async () => {
    expect(db.prepare(
      "SELECT 1 FROM task_assignees WHERE task_id = 'task-01' AND user_id = 'carol'"
    ).get()).toBeTruthy();
    await request(app)
      .get("/api/tasks/task-01")
      .set("X-User-Id", "carol")
      .expect(403);

    await request(app)
      .put("/api/grants/list-sprint/bob")
      .set("X-User-Id", "alice")
      .send({ mode: "allow" })
      .expect(200);
    await request(app)
      .get("/api/lists/list-sprint/tasks")
      .set("X-User-Id", "bob")
      .expect(200);
    await request(app)
      .delete("/api/grants/list-sprint/bob")
      .set("X-User-Id", "alice")
      .expect(204);
    await request(app)
      .get("/api/lists/list-sprint/tasks")
      .set("X-User-Id", "bob")
      .expect(403);
  });

  it("returns conflicts for in-use and final status deletion", async () => {
    await request(app)
      .delete("/api/statuses/list-backlog-todo")
      .set("X-User-Id", "alice")
      .expect(409);

    db.exec(`
      INSERT INTO containers(id, name, type, parent_id, position, visibility)
      VALUES ('list-empty', 'Empty', 'list', 'folder-launch', 2, 'public');
      INSERT INTO statuses(id, list_id, name, category, color, position)
      VALUES ('only-status', 'list-empty', 'Only', 'not_started', '#000000', 0);
    `);
    await request(app)
      .delete("/api/statuses/only-status")
      .set("X-User-Id", "alice")
      .expect(409);
  });

  it("hides an entire archived subtree, including from admins", async () => {
    await request(app)
      .delete("/api/containers/folder-launch")
      .set("X-User-Id", "alice")
      .expect(204);
    const tree = await request(app).get("/api/tree").set("X-User-Id", "alice").expect(200);
    expect(JSON.stringify(tree.body.data)).not.toContain("Backlog");
    await request(app)
      .get("/api/lists/list-backlog/tasks")
      .set("X-User-Id", "alice")
      .expect(403);
  });

  it("normalizes container positions across archive, create, and restore", async () => {
    await request(app)
      .delete("/api/containers/list-backlog")
      .set("X-User-Id", "alice")
      .expect(204);
    await request(app)
      .post("/api/containers")
      .set("X-User-Id", "alice")
      .send({ name: "QA", type: "list", parentId: "folder-launch", visibility: "public" })
      .expect(201);
    await request(app)
      .post("/api/containers/list-backlog/restore")
      .set("X-User-Id", "alice")
      .expect(200);

    const positions = db.prepare(
      "SELECT position FROM containers WHERE parent_id = 'folder-launch' AND archived_at IS NULL ORDER BY position"
    ).all() as { position: number }[];
    expect(positions.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("rejects restoring an active container without changing sibling positions", async () => {
    const before = db.prepare(
      "SELECT id, position FROM containers WHERE parent_id = 'folder-launch' AND archived_at IS NULL ORDER BY position"
    ).all();
    await request(app)
      .post("/api/containers/list-backlog/restore")
      .set("X-User-Id", "alice")
      .expect(409, {
        error: { code: "CONFLICT", message: "Container is not archived." }
      });
    const after = db.prepare(
      "SELECT id, position FROM containers WHERE parent_id = 'folder-launch' AND archived_at IS NULL ORDER BY position"
    ).all();
    expect(after).toEqual(before);
  });

  it("moves and edits a task atomically through the update endpoint", async () => {
    const updated = await request(app)
      .patch("/api/tasks/task-01")
      .set("X-User-Id", "alice")
      .send({
        primaryListId: "list-sprint",
        statusId: "list-sprint-progress",
        position: 0,
        title: "Moved and renamed",
        priority: "low"
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      id: "task-01",
      primaryListId: "list-sprint",
      statusId: "list-sprint-progress",
      position: 0,
      title: "Moved and renamed",
      priority: "low"
    });
  });

  it("returns the standard validation error for malformed JSON", async () => {
    await request(app)
      .post("/api/lists/list-backlog/tasks")
      .set("X-User-Id", "alice")
      .set("Content-Type", "application/json")
      .send("{bad json")
      .expect(422, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body must contain valid JSON."
        }
      });
  });

  it("enforces container and status ownership integrity in the database", () => {
    expect(() => db.exec(`
      INSERT INTO containers(id, name, type, parent_id, position, visibility)
      VALUES ('invalid-list', 'Invalid', 'list', 'space-eng', 99, 'public');
    `)).toThrow(/invalid container parent/);

    expect(() => db.exec(`
      INSERT INTO statuses(id, list_id, name, category, color, position)
      VALUES ('invalid-status', 'folder-launch', 'Invalid', 'active', '#000000', 99);
    `)).toThrow(/status owner must be a list/);
  });

  it("reorders a task at the exact requested position", async () => {
    await request(app)
      .post("/api/tasks/task-10/move")
      .set("X-User-Id", "alice")
      .send({ listId: "list-backlog", statusId: "list-backlog-todo", position: 0 })
      .expect(200);
    const rows = db.prepare(
      "SELECT id FROM tasks WHERE primary_list_id = ? AND status_id = ? ORDER BY position"
    ).all("list-backlog", "list-backlog-todo") as { id: string }[];
    expect(rows[0].id).toBe("task-10");
  });
});
