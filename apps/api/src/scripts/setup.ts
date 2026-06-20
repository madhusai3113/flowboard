import { openDatabase } from "../db.js";
import { migrate } from "../migrations.js";
import { seed } from "../seed.js";

const db = openDatabase();
migrate(db);
const created = seed(db);
db.close();
console.log(created ? "Database migrated and seeded." : "Database migrated; existing data preserved.");
