import { openDatabase } from "../db.js";
import { migrate } from "../migrations.js";

const db = openDatabase();
migrate(db);
db.close();
console.log("Database migrations applied.");
