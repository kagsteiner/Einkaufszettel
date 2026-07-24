from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


STUDIO_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STUDIO_DIRECTORY))

from job_store import JobStore  # noqa: E402


def create_job(store: JobStore, job_id: str = "job-1") -> dict[str, object]:
    return store.create(
        job_id=job_id,
        product_name="Butter",
        prompt="A single butter illustration.",
        variant_count=2,
        image_size=768,
        seed=42,
        reference_paths=[],
    )


class JobStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "studio.sqlite"
        self.store = JobStore(self.database_path)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_job_runs_to_completion_and_persists_selection(self) -> None:
        created = create_job(self.store)
        self.assertEqual(created["status"], "queued")

        claimed = self.store.claim_next()
        self.assertIsNotNone(claimed)
        self.assertEqual(claimed["status"], "running")

        results = ["variant-01.png", "variant-02.png"]
        self.store.update_progress("job-1", 50, results[:1])
        self.store.complete("job-1", results)
        self.assertTrue(self.store.select("job-1", 1))

        completed = self.store.get("job-1")
        self.assertIsNotNone(completed)
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["progress"], 100)
        self.assertEqual(completed["results"], results)
        self.assertEqual(completed["selected_index"], 1)

    def test_only_queued_jobs_can_be_claimed(self) -> None:
        create_job(self.store, "first")
        create_job(self.store, "second")

        first = self.store.claim_next()
        second = self.store.claim_next()

        self.assertEqual(first["id"], "first")
        self.assertEqual(second["id"], "second")
        self.assertIsNone(self.store.claim_next())

    def test_queued_job_can_be_cancelled_and_deleted(self) -> None:
        create_job(self.store)
        self.assertTrue(self.store.request_cancel("job-1"))
        self.assertEqual(self.store.get("job-1")["status"], "cancelled")
        self.assertTrue(self.store.delete("job-1"))
        self.assertIsNone(self.store.get("job-1"))

    def test_running_job_is_requeued_when_store_reopens(self) -> None:
        create_job(self.store)
        self.store.claim_next()

        reopened = JobStore(self.database_path)

        job = reopened.get("job-1")
        self.assertEqual(job["status"], "queued")
        self.assertEqual(job["progress"], 0)

    def test_running_job_cannot_be_deleted(self) -> None:
        create_job(self.store)
        self.store.claim_next()
        self.assertFalse(self.store.delete("job-1"))


if __name__ == "__main__":
    unittest.main()
