import { openDatabase } from "../db.js";
import { migrate } from "../migrations.js";
import { seed } from "../seed.js";

const db = openDatabase();
migrate(db);
const created = seed(db, process.argv.includes("--force"));
db.close();
console.log(created ? "Seed data written." : "Existing data preserved. Use npm run db:reset to replace it.");
