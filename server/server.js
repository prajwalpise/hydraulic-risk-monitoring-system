import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { query } from "./db.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });
const app = express();
const port = Number(process.env.API_PORT || 4000);
const threshold = 0.92;

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_request, response) => {
  try {
    await query("SELECT 1");
    response.json({ connected: true });
  } catch (error) {
    response.status(503).json({ connected: false, error: error.message });
  }
});

app.get("/api/status/latest", async (_request, response, next) => {
  try {
    const { rows } = await query(`
      SELECT p.id,
             p.cycle_id AS "cycleNumber",
             p.prediction_timestamp AS timestamp,
             p.health_status AS status,
             p.risk_confidence AS confidence,
             p.failure_probability AS "failureProbability",
             p.ps3_std AS "ps3Std",
             p.machine_id AS "machineId",
             ROUND((p.ps3_std - $1)::numeric, 4) AS "ps3Delta",
             m.ps1_mean,
             m.ps2_mean,
             m.ps3_mean,
             m.ps3_std,
             m.ps4_mean,
             m.ps5_mean,
             m.ps6_mean,
             m.ts1_mean,
             m.ts2_mean,
             m.ts3_mean AS "ts3Mean",
             m.ts4_mean AS "ts4Mean",
             m.eps1_mean AS "eps1Mean",
             m.ts3_mean,
             m.ts4_mean,
             m.eps1_mean
      FROM live_predictions p
      LEFT JOIN live_cycle_metrics m ON m.id = p.cycle_id
      ORDER BY p.id DESC
      LIMIT 1`, [threshold]);
    response.json(rows[0] || null);
  } catch (error) { next(error); }
});

app.get("/api/status/timeseries", async (request, response, next) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 60, 1), 500);
    const { rows } = await query(`
      SELECT p.cycle_id AS "cycleNumber", m.cycle_timestamp AS timestamp,
             m.ps3_std AS "ps3Std", m.ts2_mean AS "ts2Mean", m.eps1_mean AS "eps1Mean"
      FROM live_cycle_metrics m
      JOIN live_predictions p ON m.id = p.cycle_id
      WHERE m.scored = TRUE
      ORDER BY p.cycle_id DESC LIMIT $1`, [limit]);
    response.json(rows.reverse());
  } catch (error) { next(error); }
});

app.get("/api/status/alerts", async (request, response, next) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 15, 1), 100);
    const { rows } = await query(`
      SELECT p.cycle_id AS "cycleNumber", m.cycle_timestamp AS timestamp,
             p.health_status AS status, p.risk_confidence AS confidence,
             p.ps3_std AS "ps3Std", p.failure_probability AS "failureProbability"
      FROM live_predictions p JOIN live_cycle_metrics m ON m.id = p.cycle_id
      ORDER BY p.prediction_timestamp DESC LIMIT $1`, [limit]);
    response.json(rows);
  } catch (error) { next(error); }
});

app.get("/api/status/buffer-metrics", async (_request, response, next) => {
  try {
    const { rows } = await query(`
      SELECT COUNT(*)::int AS active,
             GREATEST(0, EXTRACT(EPOCH FROM (NOW() - MIN(cycle_timestamp))) / 86400) AS age_days
      FROM live_cycle_metrics WHERE cycle_timestamp >= NOW() - INTERVAL '24 hours'`);
    response.json({ active: rows[0].active, capacity: 1440, ageDays: Number(rows[0].age_days || 0) });
  } catch (error) { next(error); }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Unable to load status data" });
});

app.listen(port, () => console.log(`Patil Industries API listening on http://localhost:${port}`));
