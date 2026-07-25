from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


TERMINAL_STATUSES = {"completed", "cancelled", "failed"}


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class JobStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS generation_jobs (
                    id TEXT PRIMARY KEY,
                    product_name TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    variant_count INTEGER NOT NULL,
                    image_size INTEGER NOT NULL,
                    seed INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    reference_paths TEXT NOT NULL DEFAULT '[]',
                    results TEXT NOT NULL DEFAULT '[]',
                    selected_index INTEGER,
                    error TEXT,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS generation_jobs_queue_idx
                ON generation_jobs(status, created_at)
                """
            )
            connection.execute(
                """
                UPDATE generation_jobs
                SET status = 'queued',
                    progress = 0,
                    error = NULL,
                    updated_at = ?
                WHERE status = 'running'
                """,
                (utc_now(),),
            )

    @staticmethod
    def _deserialize(row: sqlite3.Row) -> dict[str, Any]:
        job = dict(row)
        job["reference_paths"] = json.loads(job["reference_paths"])
        job["results"] = json.loads(job["results"])
        job["cancel_requested"] = bool(job["cancel_requested"])
        return job

    def create(
        self,
        *,
        job_id: str,
        product_name: str,
        prompt: str,
        variant_count: int,
        image_size: int,
        seed: int,
        reference_paths: list[str],
    ) -> dict[str, Any]:
        timestamp = utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO generation_jobs (
                    id, product_name, prompt, variant_count, image_size, seed,
                    status, reference_paths, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
                """,
                (
                    job_id,
                    product_name,
                    prompt,
                    variant_count,
                    image_size,
                    seed,
                    json.dumps(reference_paths),
                    timestamp,
                    timestamp,
                ),
            )
        job = self.get(job_id)
        if job is None:
            raise RuntimeError("The newly created job could not be read.")
        return job

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM generation_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        return self._deserialize(row) if row else None

    def list(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM generation_jobs
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [self._deserialize(row) for row in rows]

    def claim_next(self) -> dict[str, Any] | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT * FROM generation_jobs
                WHERE status = 'queued' AND cancel_requested = 0
                ORDER BY created_at ASC
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                """
                UPDATE generation_jobs
                SET status = 'running', progress = 0, updated_at = ?
                WHERE id = ?
                """,
                (utc_now(), row["id"]),
            )
        return self.get(str(row["id"]))

    def update_progress(self, job_id: str, progress: int, results: list[str]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE generation_jobs
                SET progress = ?, results = ?, updated_at = ?
                WHERE id = ?
                """,
                (progress, json.dumps(results), utc_now(), job_id),
            )

    def complete(self, job_id: str, results: list[str]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE generation_jobs
                SET status = 'completed',
                    progress = 100,
                    results = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(results), utc_now(), job_id),
            )

    def fail(self, job_id: str, message: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE generation_jobs
                SET status = 'failed', error = ?, updated_at = ?
                WHERE id = ?
                """,
                (message[:1000], utc_now(), job_id),
            )

    def request_cancel(self, job_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE generation_jobs
                SET cancel_requested = 1,
                    status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
                    updated_at = ?
                WHERE id = ? AND status IN ('queued', 'running')
                """,
                (utc_now(), job_id),
            )
        return cursor.rowcount > 0

    def is_cancel_requested(self, job_id: str) -> bool:
        job = self.get(job_id)
        return bool(job and job["cancel_requested"])

    def cancel_running(self, job_id: str, results: list[str]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE generation_jobs
                SET status = 'cancelled', results = ?, updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(results), utc_now(), job_id),
            )

    def select(self, job_id: str, selected_index: int) -> bool:
        job = self.get(job_id)
        if job is None or job["status"] != "completed":
            return False
        if selected_index < 0 or selected_index >= len(job["results"]):
            return False
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE generation_jobs
                SET selected_index = ?, updated_at = ?
                WHERE id = ?
                """,
                (selected_index, utc_now(), job_id),
            )
        return True

    def delete(self, job_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                DELETE FROM generation_jobs
                WHERE id = ? AND status != 'running'
                """,
                (job_id,),
            )
        return cursor.rowcount > 0

    def delete_all(self) -> list[str] | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            running = connection.execute(
                "SELECT 1 FROM generation_jobs WHERE status = 'running' LIMIT 1"
            ).fetchone()
            if running is not None:
                return None
            rows = connection.execute("SELECT id FROM generation_jobs").fetchall()
            connection.execute("DELETE FROM generation_jobs")
        return [str(row["id"]) for row in rows]
