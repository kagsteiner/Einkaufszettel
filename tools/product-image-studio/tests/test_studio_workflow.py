from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_server import StudioApplication
from job_store import JobStore


class StudioWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.app = StudioApplication(self.root / "studio", self.root / "models")

    def tearDown(self):
        self.directory.cleanup()

    def test_openai_settings_persist_and_interrupted_requests_are_not_repeated(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "fake-test-key"}):
            job = self.app.create_job({"productName": "Butter", "provider": "openai", "imageSize": 1024,
                                       "variantCount": 1, "quality": "high", "model": "gpt-image-2"})
        claimed = self.app.store.claim_next()
        self.assertEqual(claimed["model"], "gpt-image-2")
        self.assertEqual(claimed["quality"], "high")
        restored = JobStore(self.app.store.database_path)
        self.assertIsNone(restored.claim_next())
        self.assertEqual(restored.get(job["id"])["status"], "failed")
        self.assertNotIn("fake-test-key", str(restored.get(job["id"])))

    def test_missing_key_and_bad_provider_rejected_without_jobs(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            with self.assertRaises(ValueError):
                self.app.create_job({"productName": "Butter", "provider": "openai", "imageSize": 1024})
        with self.assertRaises(ValueError):
            self.app.create_job({"productName": "Butter", "provider": "other"})
        self.assertEqual(self.app.store.list(), [])

    def test_backlog_reimport_is_idempotent_and_keeps_newer_observations(self):
        product = {"name": "Butter", "lastSeen": "2026-11-19T10:00:00.000Z", "firstSeen": "2026-11-19T09:00:00.000Z",
                   "occurrences": 3, "reason": "missing", "imageSignature": "unknown"}
        payload = {"version": 1, "kind": "product-image-backlog", "products": [product]}
        with patch.object(self.app, "backlog", return_value={"products": []}):
            self.app.import_backlog(payload)
            self.app.import_backlog(payload)
        self.assertEqual(len(self.app.store.list_backlog()), 1)
        self.assertEqual(self.app.store.list_backlog()[0]["occurrences"], 3)
        self.app.store.import_backlog([{**product, "lastSeen": "2026-11-18T10:00:00.000Z", "occurrences": 1}])
        self.assertEqual(self.app.store.list_backlog()[0]["occurrences"], 3)
        with self.assertRaises(ValueError):
            self.app.import_backlog({**payload, "products": [product, {**product, "name": ""}]})
        self.assertEqual(len(self.app.store.list_backlog()), 1)

    def test_adopt_requires_completed_selected_job_and_is_idempotent(self):
        job = self.app.create_job({"productName": "Butter"})
        with self.assertRaises(ValueError):
            self.app.adopt(job["id"])
        self.app.store.complete(job["id"], ["variant.png"])
        self.app.store.select(job["id"], 0)
        with patch("studio_server.call_bridge", return_value={"ok": True}) as bridge:
            self.app.adopt(job["id"])
            self.app.adopt(job["id"])
            self.assertEqual(bridge.call_count, 1)
        self.assertEqual(self.app.store.get(job["id"])["adopted_index"], 0)

    def test_backlog_distinguishes_local_resolution_from_missing_and_wrong_images(self):
        self.app.store.import_backlog([
            {"name": "Butter", "lastSeen": "now", "occurrences": 3, "reason": "missing", "imageSignature": "unknown"},
            {"name": "Milch", "lastSeen": "now", "occurrences": 2, "reason": "reported", "imageSignature": "old"},
        ])
        with patch("studio_server.call_bridge", return_value={"images": [], "products": [
            {"file": "images/products/butter.jpg", "signature": "new"},
            {"file": "images/products/milch.jpg", "signature": "old"},
        ]}):
            rows = self.app.backlog()["products"]
        self.assertTrue(rows[0]["resolvedLocally"])
        self.assertFalse(rows[1]["resolvedLocally"])

    def test_local_studio_rejects_foreign_origins_and_dns_rebinding(self):
        from email.message import Message
        from types import SimpleNamespace
        from studio_server import StudioRequestHandler
        for host, origin, allowed in [
            ("127.0.0.1:7861", "http://127.0.0.1:7861", True),
            ("localhost:7861", None, True),
            ("attacker.example:7861", None, False),
            ("localhost:7861", "https://attacker.example", False),
            ("localhost:7861", "null", False),
        ]:
            handler = StudioRequestHandler.__new__(StudioRequestHandler)
            handler.headers = Message()
            handler.headers["Host"] = host
            if origin is not None:
                handler.headers["Origin"] = origin
            handler.server = SimpleNamespace(server_port=7861)
            with patch.object(handler, "_send_error"):
                self.assertEqual(handler._allow_request(), allowed)
