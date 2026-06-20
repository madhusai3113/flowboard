import type { Db } from "./db.js";

interface ContainerRow {
  id: string;
  parent_id: string | null;
  visibility: "public" | "private";
  archived_at: string | null;
}

export function canAccess(db: Db, userId: string, role: string, resourceId: string): boolean {
  let currentId: string | null = resourceId;
  const seen = new Set<string>();

  while (currentId) {
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    const node = db.prepare(
      `SELECT id, parent_id, visibility, archived_at FROM containers WHERE id = ?`
    ).get(currentId) as ContainerRow | undefined;
    if (!node || node.archived_at) return false;

    if (role !== "admin") {
      const grant = db.prepare(
        "SELECT mode FROM grants WHERE resource_id = ? AND user_id = ?"
      ).get(currentId, userId) as { mode: "allow" | "deny" } | undefined;
      if (grant) return grant.mode === "allow";
      if (node.visibility === "private") return false;
    }
    currentId = node.parent_id;
  }
  return true;
}

export function accessibleIds(db: Db, userId: string, role: string): Set<string> {
  const rows = db.prepare("SELECT id FROM containers WHERE archived_at IS NULL").all() as { id: string }[];
  return new Set(rows.filter((row) => canAccess(db, userId, role, row.id)).map((row) => row.id));
}
