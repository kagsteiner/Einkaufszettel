from __future__ import annotations

import argparse
import base64
import binascii
import json
import mimetypes
import os
import secrets
import shutil
import signal
import threading
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


from bridge import PROJECT_ROOT, call_bridge

from model_config import MODEL_ID, MODEL_REVISION
OPENAI_MODELS = {"gpt-image-1.5", "gpt-image-2", "chatgpt-image-latest"}
from job_store import JobStore


STUDIO_DIRECTORY = Path(__file__).resolve().parent
WEB_DIRECTORY = STUDIO_DIRECTORY / "web"
DEFAULT_PROMPT_TEMPLATE = (
    "Create a cheerful premium grocery catalog illustration of this exact item: "
    "{product_name}. Show one typical, unmistakable {product_name} with its characteristic "
    "real-world shape and details; never depict the written product name and do not replace "
    "the product with a symbolic object or a fruit. "
    "Centered, fully visible, bold colorful stylized shapes, "
    "subtle tactile texture, soft studio lighting, gentle contact shadow, "
    "clean warm off-white background, generous empty margin, instantly recognizable."
)
REFERENCE_INSTRUCTION = (
    "Use the supplied images only as visual style references: follow their color language, "
    "shape simplification, lighting, texture, and composition. Ignore all writing, branding, "
    "labels, and packaging visible in the references. Do not copy their depicted objects; "
    "the only subject in the result must be {product_name}."
)
TEXT_FREE_INSTRUCTION = (
    "The finished image must be purely visual and completely text-free. Leave every surface "
    "and the background blank: do not render any letters, words, numbers, labels, price tags, "
    "packaging print, logos, captions, signatures, watermarks, or writing-like marks. "
    "If the real product normally has printed packaging, show it unwrapped or in plain, "
    "entirely unmarked packaging. Zero readable or pseudo-readable text anywhere in the image."
)
MAX_REQUEST_BYTES = 36 * 1024 * 1024
MAX_REFERENCE_BYTES = 6 * 1024 * 1024
ALLOWED_IMAGE_SIZES = {512, 768, 1024}


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Startet das lokale Product Image Studio mit persistenter FLUX-Queue."
    )
    parser.add_argument("--cache-directory", required=True, type=Path)
    parser.add_argument("--runtime-directory", required=True, type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=7861, type=int)
    return parser.parse_args()


def build_prompt(product_name: str, direction: str, has_references: bool) -> str:
    prompt = DEFAULT_PROMPT_TEMPLATE.format(product_name=product_name)
    if direction:
        prompt = f"{prompt} Additional art direction: {direction}"
    if has_references:
        prompt = (
            f"{prompt} "
            f"{REFERENCE_INSTRUCTION.format(product_name=product_name)}"
        )
    return f"{prompt} {TEXT_FREE_INSTRUCTION}"


def public_job(job: dict[str, Any]) -> dict[str, Any]:
    job_id = job["id"]
    results = [
        {
            "filename": filename,
            "url": f"/api/jobs/{job_id}/images/{filename}",
        }
        for filename in job["results"]
    ]
    return {
        "id": job_id,
        "productName": job["product_name"],
        "prompt": job["prompt"],
        "variantCount": job["variant_count"],
        "imageSize": job["image_size"],
        "seed": job["seed"],
        "provider": job["provider"],
        "model": job["model"],
        "quality": job["quality"],
        "adoptedIndex": job["adopted_index"],
        "status": job["status"],
        "progress": job["progress"],
        "referenceCount": len(job["reference_paths"]),
        "results": results,
        "selectedIndex": job["selected_index"],
        "error": job["error"],
        "cancelRequested": job["cancel_requested"],
        "createdAt": job["created_at"],
        "updatedAt": job["updated_at"],
    }


class GenerationWorker(threading.Thread):
    def __init__(self, store: JobStore, cache_directory: Path, jobs_directory: Path) -> None:
        super().__init__(name="flux-generation-worker", daemon=True)
        self.store = store
        self.cache_directory = cache_directory
        self.jobs_directory = jobs_directory
        self.wake_event = threading.Event()
        self.stop_event = threading.Event()
        self.pipeline: Any | None = None

    def wake(self) -> None:
        self.wake_event.set()

    def stop(self) -> None:
        self.stop_event.set()
        self.wake_event.set()

    def run(self) -> None:
        while not self.stop_event.is_set():
            job = self.store.claim_next()
            if job is None:
                self.wake_event.wait(timeout=2)
                self.wake_event.clear()
                continue
            self._process(job)

    def _ensure_pipeline(self) -> Any:
        if self.pipeline is None:
            print("Lade FLUX für die Generierungsqueue …", flush=True)
            from flux_runtime import prepare_pipeline
            self.pipeline = prepare_pipeline(self.cache_directory)
            print("FLUX ist bereit.", flush=True)
        return self.pipeline

    def _process(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        result_names: list[str] = list(job["results"])
        references: list[Any] = []
        try:
            if job["provider"] == "openai":
                self._process_openai(job, result_names)
                return
            import torch
            from PIL import Image
            pipeline = self._ensure_pipeline()
            for reference_path in job["reference_paths"]:
                with Image.open(reference_path) as source:
                    references.append(source.convert("RGB"))

            output_directory = self.jobs_directory / job_id / "results"
            output_directory.mkdir(parents=True, exist_ok=True)

            for index in range(len(result_names), int(job["variant_count"])):
                if self.stop_event.is_set():
                    return
                if self.store.is_cancel_requested(job_id):
                    self.store.cancel_running(job_id, result_names)
                    return

                seed = int(job["seed"]) + index
                torch.mps.empty_cache()
                response = pipeline(
                    image=references or None,
                    prompt=job["prompt"],
                    height=int(job["image_size"]),
                    width=int(job["image_size"]),
                    guidance_scale=1.0,
                    num_inference_steps=4,
                    generator=torch.Generator(device="cpu").manual_seed(seed),
                )
                filename = f"variant-{index + 1:02d}-seed-{seed}.png"
                response.images[0].save(output_directory / filename, format="PNG", optimize=True)
                result_names.append(filename)
                progress = round(len(result_names) / int(job["variant_count"]) * 100)
                self.store.update_progress(job_id, progress, result_names)

            self.store.complete(job_id, result_names)
        except Exception as error:
            if self.store.is_cancel_requested(job_id):
                self.store.cancel_running(job_id, result_names)
            else:
                self.store.fail(job_id, str(error) if job["provider"] == "openai" else "Lokale Generierung fehlgeschlagen; Modell und Speicher prüfen.")
        finally:
            for reference in references:
                reference.close()

    def _process_openai(self, job: dict[str, Any], results: list[str]) -> None:
        from PIL import Image
        job_id = job["id"]
        directory = self.jobs_directory / job_id / "results"
        directory.mkdir(parents=True, exist_ok=True)
        for index in range(len(results), job["variant_count"]):
            if self.stop_event.is_set() or self.store.is_cancel_requested(job_id):
                self.store.cancel_running(job_id, results)
                return
            response = call_bridge(job, openai=True, cancelled=lambda: self.stop_event.is_set() or self.store.is_cancel_requested(job_id))
            raw = base64.b64decode(response["image"], validate=True)
            filename = f"variant-{index + 1:02d}.png"
            path = directory / filename
            path.write_bytes(raw)
            try:
                with Image.open(path) as image:
                    image.verify()
            except Exception:
                path.unlink(missing_ok=True)
                raise ValueError("OpenAI lieferte kein lesbares Bild.") from None
            results.append(filename)
            self.store.update_progress(job_id, round(len(results) / job["variant_count"] * 100), results)
        if self.store.is_cancel_requested(job_id):
            self.store.cancel_running(job_id, results)
        else:
            self.store.complete(job_id, results)


class StudioApplication:
    def __init__(self, runtime_directory: Path, cache_directory: Path) -> None:
        self.catalog_lock = threading.Lock()
        self.runtime_directory = runtime_directory
        self.jobs_directory = runtime_directory / "jobs"
        self.jobs_directory.mkdir(parents=True, exist_ok=True)
        self.store = JobStore(runtime_directory / "studio.sqlite")
        self.worker = GenerationWorker(self.store, cache_directory, self.jobs_directory)

    def start(self) -> None:
        self.worker.start()
        self.worker.wake()

    def stop(self) -> None:
        self.worker.stop()
        self.worker.join(timeout=10)

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        product_name = str(payload.get("productName", "")).strip()
        if not product_name or len(product_name) > 120:
            raise ValueError("The product name must be between 1 and 120 characters long.")

        direction = str(payload.get("direction", "")).strip()
        if len(direction) > 600:
            raise ValueError("Additional art direction must not exceed 600 characters.")

        try:
            variant_count = int(payload.get("variantCount", 4))
            image_size = int(payload.get("imageSize", 768))
            seed = int(payload.get("seed", secrets.randbelow(2_000_000_000)))
        except (TypeError, ValueError) as error:
            raise ValueError("Variants, image size, and seed must be whole numbers.") from error
        if variant_count < 1 or variant_count > 10:
            raise ValueError("You can generate between 1 and 10 variants.")
        if image_size not in ALLOWED_IMAGE_SIZES:
            raise ValueError("Allowed image sizes are 512, 768, and 1024 pixels.")
        if seed < 0 or seed > 2_147_483_637:
            raise ValueError("The seed must be between 0 and 2147483637.")

        provider = payload.get("provider", "local")
        model = payload.get("model", "gpt-image-1.5")
        quality = payload.get("quality", "medium")
        if (not isinstance(provider, str) or not isinstance(model, str) or not isinstance(quality, str)
                or provider not in {"local", "openai"} or model not in OPENAI_MODELS or quality not in {"low", "medium", "high"}):
            raise ValueError("Ungültiger Anbieter, Modell oder Qualität.")
        if provider == "openai":
            if not os.environ.get("OPENAI_API_KEY"):
                raise ValueError("OPENAI_API_KEY fehlt in der Startumgebung des Studios.")
            if image_size != 1024:
                raise ValueError("OpenAI-Aufträge verwenden 1024 Pixel.")

        references = payload.get("referenceImages", [])
        if not isinstance(references, list) or len(references) > 4:
            raise ValueError("You can use up to four reference images.")

        job_id = uuid.uuid4().hex
        reference_directory = self.jobs_directory / job_id / "references"
        reference_paths = self._save_references(reference_directory, references)
        prompt = build_prompt(product_name, direction, bool(reference_paths))
        job = self.store.create(
            job_id=job_id,
            product_name=product_name,
            prompt=prompt,
            variant_count=variant_count,
            image_size=image_size,
            seed=seed,
            reference_paths=reference_paths,
            provider=provider,
            model=model,
            quality=quality,
        )
        self.worker.wake()
        return public_job(job)

    @staticmethod
    def _save_references(directory: Path, references: list[Any]) -> list[str]:
        if not references:
            return []
        from PIL import Image, ImageOps, UnidentifiedImageError
        saved_paths: list[str] = []
        try:
            for index, reference in enumerate(references):
                if not isinstance(reference, dict):
                    raise ValueError("A reference image has an invalid format.")
                encoded = reference.get("data")
                if not isinstance(encoded, str):
                    raise ValueError("A reference image does not contain image data.")
                if "," in encoded and encoded.startswith("data:"):
                    encoded = encoded.split(",", 1)[1]
                try:
                    raw = base64.b64decode(encoded, validate=True)
                except (binascii.Error, ValueError) as error:
                    raise ValueError("A reference image is not valid Base64 data.") from error
                if not raw or len(raw) > MAX_REFERENCE_BYTES:
                    raise ValueError("Each reference image must be no larger than 6 MB.")

                directory.mkdir(parents=True, exist_ok=True)
                temporary_path = directory / f"reference-{index + 1}.upload"
                temporary_path.write_bytes(raw)
                try:
                    with Image.open(temporary_path) as source:
                        source.verify()
                    with Image.open(temporary_path) as source:
                        clean = ImageOps.exif_transpose(source).convert("RGB")
                        clean.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
                        target = directory / f"reference-{index + 1}.jpg"
                        clean.save(target, format="JPEG", quality=92, optimize=True)
                except (UnidentifiedImageError, OSError) as error:
                    raise ValueError("A reference file is not a readable image.") from error
                finally:
                    temporary_path.unlink(missing_ok=True)
                saved_paths.append(str(target))
        except Exception:
            shutil.rmtree(directory.parent, ignore_errors=True)
            raise
        return saved_paths

    def import_backlog(self, payload: dict[str, Any]) -> dict[str, Any]:
        from datetime import UTC, datetime
        if payload.get("version") != 1 or payload.get("kind") != "product-image-backlog":
            raise ValueError("Bitte einen Produktbild-Backlog der Version 1 importieren.")
        products = payload.get("products")
        if not isinstance(products, list) or len(products) > 10000:
            raise ValueError("Ungültiger oder zu großer Backlog.")
        cleaned_products = []
        for product in products:
            if (not isinstance(product, dict) or not isinstance(product.get("name"), str)
                or not product["name"].strip() or len(product["name"]) > 120
                or product.get("reason") not in ("missing", "reported")
                or type(product.get("occurrences")) is not int or product["occurrences"] < 1
                or not isinstance(product.get("imageSignature"), str)
                or len(product["imageSignature"]) > 100):
                raise ValueError("Ungültiger Backlog-Eintrag.")
            clean = {key: product[key] for key in ("name", "reason", "occurrences", "imageSignature")}
            for field in ("firstSeen", "lastSeen"):
                value = product.get(field)
                if not isinstance(value, str) or len(value) > 40:
                    raise ValueError("Ungültiges Sichtungsdatum.")
                try:
                    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                    if parsed.tzinfo is None:
                        raise ValueError("Zeitzone fehlt.")
                    clean[field] = parsed.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                except ValueError:
                    raise ValueError("Ungültiges Sichtungsdatum.") from None
            if clean["firstSeen"] > clean["lastSeen"]:
                raise ValueError("Ungültiger Sichtungszeitraum.")
            cleaned_products.append(clean)
        self.store.import_backlog(cleaned_products)
        return self.backlog()

    def backlog(self) -> dict[str, Any]:
        products = self.store.list_backlog()
        catalog = call_bridge({"action": "catalog", "names": [product["name"] for product in products]})
        for product, local in zip(products, catalog["products"]):
            product["localImage"] = local["file"]
            product["resolvedLocally"] = (local["signature"] != "unknown" if product["reason"] == "missing"
                                          else local["signature"] != product["imageSignature"])
        return {"products": products, "images": catalog["images"]}

    def adopt(self, job_id: str) -> None:
        with self.catalog_lock:
            job = self.store.get(job_id)
            if not job or job["status"] != "completed" or job["selected_index"] is None:
                raise ValueError("Bitte zuerst eine fertige Variante auswählen.")
            index = job["selected_index"]
            if index == job["adopted_index"]:
                return
            source = self.jobs_directory / job_id / "results" / job["results"][index]
            call_bridge({"action": "adopt", "name": job["product_name"], "source": str(source)})
            self.store.mark_adopted(job_id, index)

    def assign(self, payload: dict[str, Any]) -> None:
        name, image_id = payload.get("name"), payload.get("imageId")
        if not isinstance(name, str) or not name.strip() or len(name) > 120 or not isinstance(image_id, str):
            raise ValueError("Ungültige Zuordnung.")
        with self.catalog_lock:
            call_bridge({"action": "assign", "name": name, "imageId": image_id})

    def delete_job(self, job_id: str) -> bool:
        if not self.store.delete(job_id):
            return False
        shutil.rmtree(self.jobs_directory / job_id, ignore_errors=True)
        return True

    def delete_all_jobs(self) -> int | None:
        job_ids = self.store.delete_all()
        if job_ids is None:
            return None
        for job_id in job_ids:
            shutil.rmtree(self.jobs_directory / job_id, ignore_errors=True)
        return len(job_ids)


class StudioRequestHandler(BaseHTTPRequestHandler):
    server_version = "ProductImageStudio/1.0"

    @property
    def application(self) -> StudioApplication:
        return self.server.application  # type: ignore[attr-defined]

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"{self.address_string()} - {format_string % args}", flush=True)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; "
            "style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'",
        )
        super().end_headers()

    def do_GET(self) -> None:
        if not self._allow_request():
            return
        path = unquote(urlparse(self.path).path)
        if path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "model": MODEL_ID,
                    "modelRevision": MODEL_REVISION,
                    "device": "mps",
                    "openAiAvailable": bool(os.environ.get("OPENAI_API_KEY")),
                    "openAiModels": sorted(OPENAI_MODELS),
                },
            )
            return
        if path == "/api/backlog":
            try:
                self._send_json(HTTPStatus.OK, self.application.backlog())
            except ValueError as error:
                self._send_error(HTTPStatus.BAD_REQUEST, str(error))
            return
        if path.startswith("/catalog/"):
            filename = path.removeprefix("/catalog/")
            if Path(filename).name != filename or not filename.endswith(".jpg"):
                self._send_error(HTTPStatus.NOT_FOUND, "Bild nicht gefunden.")
                return
            self._serve_file(PROJECT_ROOT / "public/images/products" / filename, "image/jpeg", "no-store")
            return
        if path == "/api/jobs":
            self._send_json(
                HTTPStatus.OK,
                {"jobs": [public_job(job) for job in self.application.store.list()]},
            )
            return
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "jobs"]:
            job = self.application.store.get(parts[2])
            if job is None:
                self._send_error(HTTPStatus.NOT_FOUND, "Job not found.")
            else:
                self._send_json(HTTPStatus.OK, {"job": public_job(job)})
            return
        if len(parts) == 5 and parts[:2] == ["api", "jobs"] and parts[3] == "images":
            self._serve_result_image(parts[2], parts[4])
            return
        self._serve_static(path)

    def do_POST(self) -> None:
        if not self._allow_request():
            return
        path = unquote(urlparse(self.path).path)
        if path in {"/api/backlog/import", "/api/backlog/assign"}:
            try:
                payload = self._read_json()
                if path.endswith("/import"):
                    result = self.application.import_backlog(payload)
                else:
                    self.application.assign(payload)
                    result = self.application.backlog()
                self._send_json(HTTPStatus.OK, result)
            except ValueError as error:
                self._send_error(HTTPStatus.BAD_REQUEST, str(error))
            return
        if path == "/api/jobs":
            try:
                job = self.application.create_job(self._read_json())
            except ValueError as error:
                self._send_error(HTTPStatus.BAD_REQUEST, str(error))
                return
            self._send_json(HTTPStatus.CREATED, {"job": job})
            return

        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "jobs"]:
            job_id, action = parts[2], parts[3]
            job = self.application.store.get(job_id)
            if job is None:
                self._send_error(HTTPStatus.NOT_FOUND, "Job not found.")
                return
            if action == "cancel":
                if not self.application.store.request_cancel(job_id):
                    self._send_error(
                        HTTPStatus.CONFLICT,
                        "Only queued or running jobs can be cancelled.",
                    )
                    return
                self.application.worker.wake()
                updated = self.application.store.get(job_id)
                self._send_json(HTTPStatus.OK, {"job": public_job(updated or job)})
                return
            if action == "adopt":
                try:
                    self.application.adopt(job_id)
                    updated = self.application.store.get(job_id)
                    self._send_json(HTTPStatus.OK, {"job": public_job(updated or job)})
                except ValueError as error:
                    self._send_error(HTTPStatus.BAD_REQUEST, str(error))
                return
            if action == "select":
                try:
                    selected_index = int(self._read_json().get("selectedIndex"))
                except (TypeError, ValueError) as error:
                    self._send_error(HTTPStatus.BAD_REQUEST, "Invalid selection.")
                    return
                if not self.application.store.select(job_id, selected_index):
                    self._send_error(
                        HTTPStatus.CONFLICT,
                        "This result cannot be selected.",
                    )
                    return
                updated = self.application.store.get(job_id)
                self._send_json(HTTPStatus.OK, {"job": public_job(updated or job)})
                return
        self._send_error(HTTPStatus.NOT_FOUND, "Not found.")

    def do_DELETE(self) -> None:
        if not self._allow_request():
            return
        path = unquote(urlparse(self.path).path)
        if path == "/api/jobs":
            deleted = self.application.delete_all_jobs()
            if deleted is None:
                self._send_error(
                    HTTPStatus.CONFLICT,
                    "Cancel the running job before deleting all drafts.",
                )
                return
            self._send_json(HTTPStatus.OK, {"deleted": deleted})
            return
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "jobs"]:
            if self.application.store.get(parts[2]) is None:
                self._send_error(HTTPStatus.NOT_FOUND, "Job not found.")
                return
            if not self.application.delete_job(parts[2]):
                self._send_error(
                    HTTPStatus.CONFLICT,
                    "A running job must be cancelled first.",
                )
                return
            self._send_json(HTTPStatus.OK, {"deleted": True})
            return
        self._send_error(HTTPStatus.NOT_FOUND, "Not found.")

    def _allow_request(self) -> bool:
        host = self.headers.get("Host", "")
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        origin = self.headers.get("Origin")
        if host not in allowed or (origin and origin != f"http://{host}") or self.headers.get("Sec-Fetch-Site") == "cross-site":
            self._send_error(HTTPStatus.FORBIDDEN, "Nur lokale Studio-Anfragen sind erlaubt.")
            return False
        return True

    def _read_json(self) -> dict[str, Any]:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length.") from error
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            raise ValueError("The request is empty or larger than 36 MB.")
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("The request does not contain valid JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("The request must contain a JSON object.")
        return payload

    def _serve_result_image(self, job_id: str, filename: str) -> None:
        job = self.application.store.get(job_id)
        if job is None or filename not in job["results"] or Path(filename).name != filename:
            self._send_error(HTTPStatus.NOT_FOUND, "Image not found.")
            return
        self._serve_file(
            self.application.jobs_directory / job_id / "results" / filename,
            "image/png",
            cache_control="private, max-age=31536000, immutable",
        )

    def _serve_static(self, path: str) -> None:
        relative_path = "index.html" if path in {"", "/"} else path.lstrip("/")
        requested = (WEB_DIRECTORY / relative_path).resolve()
        if requested != WEB_DIRECTORY and WEB_DIRECTORY not in requested.parents:
            self._send_error(HTTPStatus.NOT_FOUND, "Not found.")
            return
        if not requested.is_file():
            self._send_error(HTTPStatus.NOT_FOUND, "Not found.")
            return
        content_type, _ = mimetypes.guess_type(requested.name)
        self._serve_file(
            requested,
            content_type or "application/octet-stream",
            cache_control="no-store",
        )

    def _serve_file(self, path: Path, content_type: str, cache_control: str) -> None:
        try:
            data = path.read_bytes()
        except OSError:
            self._send_error(HTTPStatus.NOT_FOUND, "File not found.")
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_error(self, status: HTTPStatus, message: str) -> None:
        self._send_json(status, {"error": message})


class StudioHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        application: StudioApplication,
    ) -> None:
        self.application = application
        super().__init__(server_address, StudioRequestHandler)


def main() -> None:
    arguments = parse_arguments()
    if arguments.host not in {"127.0.0.1", "localhost"}:
        raise SystemExit("Das Product Image Studio darf nur an localhost gebunden werden.")
    if arguments.port < 1024 or arguments.port > 65535:
        raise SystemExit("--port muss zwischen 1024 und 65535 liegen.")

    application = StudioApplication(
        arguments.runtime_directory.expanduser().resolve(),
        arguments.cache_directory.expanduser().resolve(),
    )
    server = StudioHttpServer((arguments.host, arguments.port), application)

    def shutdown(_signal_number: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    application.start()
    print(f"Product Image Studio: http://{arguments.host}:{arguments.port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        application.stop()
        print("Product Image Studio wurde beendet.", flush=True)


if __name__ == "__main__":
    main()
