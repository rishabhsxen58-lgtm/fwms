import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
dotenv.config({ path: path.join(projectRoot, ".env") });
const defaultFile = path.resolve(here, "../data/workload.sqlite");
const filename = process.env.DATABASE_FILE
  ? path.resolve(projectRoot, process.env.DATABASE_FILE)
  : defaultFile;
fs.mkdirSync(path.dirname(filename), { recursive: true });

export const db = new Database(filename);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

const migrationDir = path.resolve(here, "../migrations");
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

for (const name of fs.readdirSync(migrationDir).filter((file) => file.endsWith(".sql")).sort()) {
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(name);
  if (!applied) {
    const sql = fs.readFileSync(path.join(migrationDir, name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(name);
    })();
  }
}
