"""Stream deterministic hydraulic telemetry and score it with the RF model."""

from __future__ import annotations

import csv
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import psycopg2
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

FEATURE_COLUMNS = json.loads((ROOT / "feature_columns.json").read_text())
MACHINE_ID = os.getenv("MACHINE_ID", "PRESS_01")
INTERVAL_SECONDS = float(os.getenv("CYCLE_INTERVAL_SECONDS", "2"))
RETENTION_HOURS = int(os.getenv("RETENTION_HOURS", "24"))
THRESHOLD = 0.9200
BASELINE = 0.86

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("simulate_and_score")

METRIC_COLUMNS = ", ".join(column.lower() for column in FEATURE_COLUMNS)
METRIC_VALUES = ", ".join(f"%({column})s" for column in FEATURE_COLUMNS)
INSERT_SQL = f"""
INSERT INTO live_cycle_metrics
    (cycle_timestamp, machine_id, {METRIC_COLUMNS})
VALUES (%(cycle_timestamp)s, %(machine_id)s, {METRIC_VALUES})
RETURNING id
"""


def send_mobile_alert(cycle_number, ps3_std, confidence, status_str):
    print(f"\n=======================================================", flush=True)
    print(f">>> [NTFY TRIGGERED] Sending alert for Cycle #{cycle_number}...", flush=True)
    url = "https://ntfy.sh/fixit_patil_press_alerts_2026"
    payload = (
        f"CRITICAL ALERT: PRESS_01 Cycle #{cycle_number}\n"
        f"Status: {status_str}\n"
        f"PS3 Line Instability: {ps3_std:.4f} bar (Threshold: 0.9200 bar)\n"
        f"Confidence: {confidence:.1f}%\n"
        f"Action: Nitrogen pre-charge loss detected. Inspect accumulator immediately."
    )
    headers = {
        "Title": f"CRITICAL: FIXIT Alert PRESS_01 Cycle #{cycle_number}",
        "Priority": "urgent",
        "Tags": "warning,rotating_light,wrench"
    }
    try:
        resp = requests.post(url, data=payload.encode("utf-8"), headers=headers, timeout=5)
        print(f">>> [NTFY SUCCESS] HTTP Status: {resp.status_code}", flush=True)
    except Exception as err:
        print(f">>> [NTFY ERROR] Failed to send push: {err}", flush=True)
    print(f"=======================================================\n", flush=True)


def load_baseline(model: Any) -> dict[str, float]:
    with (ROOT / "demo_readings.csv").open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    if not rows:
        raise ValueError("demo_readings.csv contains no telemetry rows")

    healthy_rows = [
        row for row in rows
        if int(model.predict(pd.DataFrame(
            [[float(row[column]) for column in FEATURE_COLUMNS]],
            columns=FEATURE_COLUMNS,
        ))[0]) == 0
    ]
    if not healthy_rows:
        raise ValueError("demo_readings.csv contains no model-classified SAFE baseline")

    baseline = min(healthy_rows, key=lambda row: abs(float(row["PS3_std"]) - BASELINE))
    return {column: float(baseline[column]) for column in FEATURE_COLUMNS}


def get_connection() -> psycopg2.extensions.connection:
    return psycopg2.connect(
        host=os.getenv("PG_HOST", "localhost"),
        port=os.getenv("PG_PORT", "5432"),
        dbname=os.getenv("PG_DATABASE", "hydraulic_production_db"),
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
        application_name="patil-industries-edge-simulator",
    )


def score(model: Any, row: dict[str, float]) -> tuple[str, float, float]:
    input_df = pd.DataFrame(
        [[row[column] for column in FEATURE_COLUMNS]],
        columns=FEATURE_COLUMNS,
    )
    prediction = int(model.predict(input_df)[0])
    probabilities = model.predict_proba(input_df)[0]
    at_risk_probability = float(probabilities[1])
    return (
        "AT RISK" if prediction == 1 or row["PS3_std"] >= THRESHOLD else "SAFE",
        round(float(max(probabilities)) * 100, 2),
        round(at_risk_probability * 100, 2),
    )


def build_cycle(baseline: dict[str, float], cycle_number: int) -> dict[str, float]:
    row = dict(baseline)
    step = cycle_number % 30

    # Phase 1: SAFE (Cycles 0 to 9 -> ~20 seconds of healthy green baseline)
    if step < 10:
        phase_name = "SAFE (Optimal Operating Conditions)"
        drift = 0.0

    # Phase 2: DEGRADING (Cycles 10 to 19 -> ~20 seconds of rising oscillation on chart)
    elif step < 20:
        phase_name = "DEGRADING (Accumulator Leakage)"
        drift = ((step - 10) / 10.0) * 0.075

    # Phase 3: CRITICAL AT RISK (Cycles 20 to 25 -> ~12 seconds where alert fires & phone rings)
    elif step < 26:
        phase_name = "CRITICAL: AT RISK"
        drift = 0.095

    # Phase 4: MAINTENANCE RECHARGE (Cycles 26 to 29 -> ~8 seconds reset back to safe)
    else:
        phase_name = "MAINTENANCE RECHARGE"
        drift = 0.095 * (1.0 - ((step - 25) / 4.0))

    ps3_std = BASELINE + drift
    row["PS3_std"] = ps3_std
    row["TS2_mean"] = baseline["TS2_mean"] + max(0.0, ps3_std - BASELINE) * 25
    row["phase_name"] = phase_name
    return row


def prune(connection: psycopg2.extensions.connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM live_cycle_metrics WHERE cycle_timestamp < NOW() - (%s * INTERVAL '1 hour')",
            (RETENTION_HOURS,),
        )


def run() -> None:
    model = joblib.load(ROOT / "hydraulic_risk_rf_model.joblib")
    if model.n_features_in_ != len(FEATURE_COLUMNS):
        raise RuntimeError("Model feature count does not match feature_columns.json")

    baseline = load_baseline(model)
    logger.info("Using healthy baseline PS3_std=%.4f", baseline["PS3_std"])
    connection = get_connection()
    running = True

    def stop(_signal: int, _frame: Any) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    cycle_number = 0

    last_alert_state = False

    try:
        while running:
            cycle_number += 1
            row = build_cycle(baseline, cycle_number)
            status, confidence, failure_probability = score(model, row)
            cycle_counter = cycle_number
            ps3_std_val = float(row["PS3_std"])
            confidence_val = float(confidence)
            phase_name = row.get("phase_name", "SAFE")
            health_status = status
            pred_status = status
            pred_label = 1 if status == "AT RISK" else 0
            timestamp = datetime.now(timezone.utc)

            with connection:
                with connection.cursor() as cursor:
                    cursor.execute(
                        INSERT_SQL,
                        {**row, "cycle_timestamp": timestamp, "machine_id": MACHINE_ID},
                    )
                    cycle_id = cursor.fetchone()[0]
                    cursor.execute(
                        """INSERT INTO live_predictions
                        (cycle_id, prediction_timestamp, machine_id, health_status,
                         risk_confidence, ps3_std, failure_probability)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                        (cycle_id, timestamp, MACHINE_ID, status, confidence,
                         row["PS3_std"], failure_probability),
                    )
                    cursor.execute("UPDATE live_cycle_metrics SET scored = TRUE WHERE id = %s", (cycle_id,))
                    prune(connection)

            print(f"[CYCLE {cycle_counter}] Phase: {phase_name} | PS3_std: {ps3_std_val:.4f} | Health: {locals().get('health_status', 'N/A')}", flush=True)

            logger.info("Cycle %d | %s | PS3_std=%.4f | %s", cycle_number, status, row["PS3_std"], phase_name)

            # --- DIRECT NOTIFICATION DISPATCH ---
            # Keep the transition state on run() so it remains valid when this
            # file is launched directly as __main__.
            if not hasattr(run, "last_alert_fired"):
                run.last_alert_fired = False

            is_at_risk = (
                "AT RISK" in str(phase_name).upper()
                or float(ps3_std_val) >= THRESHOLD
                or "RISK" in str(health_status).upper()
                or "RISK" in str(pred_status).upper()
                or pred_label == 1
            )

            if is_at_risk:
                if not run.last_alert_fired:
                    print("\n>>> [NTFY TRIGGERED] FIRING NOTIFICATION TO PHONE NOW...", flush=True)
                    try:
                        res = requests.post(
                            "https://ntfy.sh/fixit_patil_press_alerts_2026",
                            data=(
                                f"CRITICAL HAZARD: PRESS_01 Cycle #{cycle_counter} "
                                f"reached {ps3_std_val:.4f} bar instability. "
                                "Immediate bladder inspection required."
                            ).encode("utf-8"),
                            headers={
                                "Title": f"CRITICAL: FIXIT Alert PRESS_01 Cycle #{cycle_counter}",
                                "Priority": "urgent",
                                "Tags": "warning,rotating_light,wrench",
                            },
                            timeout=5,
                        )
                        print(f">>> [NTFY RESULT] HTTP Status: {res.status_code}\n", flush=True)
                        if 200 <= res.status_code < 300:
                            run.last_alert_fired = True
                    except Exception as error:
                        print(f">>> [NTFY FAILED] {error}\n", flush=True)
            else:
                # Reset when the machine returns to SAFE so the next risk
                # transition can produce another notification.
                run.last_alert_fired = False

            time.sleep(2)
    finally:
        connection.close()


if __name__ == "__main__":
    run()
