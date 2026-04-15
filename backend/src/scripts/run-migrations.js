import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../lib/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../db/migrations");

async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedVersions(client) {
  const { rows } = await client.query(`SELECT version FROM schema_migrations`);
  return new Set(rows.map((row) => row.version));
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureSchemaMigrationsTable(client);

    const files = (await fs.readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    const applied = await getAppliedVersions(client);

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sql = await fs.readFile(fullPath, "utf8");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
      console.log(`Applied migration: ${file}`);
    }

    await client.query("COMMIT");
    console.log("Migrations complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
