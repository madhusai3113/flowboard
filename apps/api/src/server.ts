import { createApp } from "./app.js";
import { openDatabase } from "./db.js";
import { migrate } from "./migrations.js";
import { seed } from "./seed.js";

const db = openDatabase();
migrate(db);
seed(db);

const port = Number(process.env.PORT ?? 4000);
createApp(db).listen(port, () => {
  console.log(`Flowboard API listening on http://localhost:${port}`);
});
