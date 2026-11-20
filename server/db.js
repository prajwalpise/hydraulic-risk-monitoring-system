import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const { Pool } = pg;
export const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE || "hydraulic_production_db",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "",
  max: 10,
  connectionTimeoutMillis: 3000
});

export async function query(text, values) {
  return pool.query(text, values);
}
