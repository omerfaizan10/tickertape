import { config } from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy env.example to .env.local first.",
    );
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf-8");
  await pool.query(sql);
  await pool.end();
  console.log("Schema applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
