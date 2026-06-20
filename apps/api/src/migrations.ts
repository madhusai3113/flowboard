import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Db } from "./db.js";
import { transaction } from "./db.js";

export function migrate(db: Db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const directory = resolve(import.meta.dirname, "../migrations");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(file);
    if (applied) continue;
    transaction(db, () => {
      db.exec(readFileSync(resolve(directory, file), "utf8"));
      db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(file);
    });
  }
}
