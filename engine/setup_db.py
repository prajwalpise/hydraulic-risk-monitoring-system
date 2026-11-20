"""Create the PostgreSQL schema used by the edge simulator and dashboard."""

from pathlib import Path
import os
import sys

import psycopg2
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

FEATURE_COLUMNS = [
    "PS1_mean", "PS1_max", "PS1_std", "PS2_mean", "PS2_max", "PS2_std",
    "PS3_mean", "PS3_max", "PS3_std", "PS4_mean", "PS4_max", "PS4_std",
    "PS5_mean", "PS5_max", "PS5_std", "PS6_mean", "PS6_max", "PS6_std",
    "TS1_mean", "TS1_max", "TS1_std", "TS2_mean", "TS2_max", "TS2_std",
    "TS3_mean", "TS3_max", "TS3_std", "TS4_mean", "TS4_max", "TS4_std",
    "EPS1_mean", "EPS1_max", "EPS1_std",
]

METRIC_COLUMNS = ",\n".join(f'"{column}" DOUBLE PRECISION NOT NULL' for column in FEATURE_COLUMNS)

SCHEMA_SQL = f"""
CREATE TABLE IF NOT EXISTS live_cycle_metrics (
    id BIGSERIAL PRIMARY KEY,
    cycle_number INTEGER NOT NULL,
    cycle_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    machine_id VARCHAR(50) NOT NULL DEFAULT 'PRESS_01',
    {METRIC_COLUMNS},
    scored BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (machine_id, cycle_number)
);

CREATE TABLE IF NOT EXISTS live_predictions (
    id BIGSERIAL PRIMARY KEY,
    cycle_id BIGINT NOT NULL REFERENCES live_cycle_metrics(id) ON DELETE CASCADE,
    prediction_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    machine_id VARCHAR(50) NOT NULL DEFAULT 'PRESS_01',
    health_status VARCHAR(20) NOT NULL CHECK (health_status IN ('SAFE', 'AT RISK')),
    risk_confidence DOUBLE PRECISION NOT NULL CHECK (risk_confidence BETWEEN 0 AND 100),
    ps3_std DOUBLE PRECISION NOT NULL,
    failure_probability DOUBLE PRECISION NOT NULL CHECK (failure_probability BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_live_metrics_timestamp
    ON live_cycle_metrics (cycle_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_live_predictions_timestamp
    ON live_predictions (prediction_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_live_predictions_cycle
    ON live_predictions (cycle_id);
"""


def main() -> None:
    connection = psycopg2.connect(
        host=os.getenv("PG_HOST", "localhost"),
        port=os.getenv("PG_PORT", "5432"),
        dbname=os.getenv("PG_DATABASE", "hydraulic_production_db"),
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
    )
    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute(SCHEMA_SQL)
        print("PostgreSQL schema is ready.")
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except psycopg2.Error as error:
        print(f"Database setup failed: {error}", file=sys.stderr)
        raise
