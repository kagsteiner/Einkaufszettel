from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import venv
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
STUDIO_DIRECTORY = Path(__file__).resolve().parent
REQUIREMENTS_PATH = STUDIO_DIRECTORY / "requirements-smoke.txt"
DEFAULT_RUNTIME_DIRECTORY = (
    Path.home() / "Library" / "Caches" / "Einkaufszettel" / "product-image-studio"
)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Richtet die isolierte FLUX-Runtime ein und startet optional den MPS-Smoke-Test."
    )
    parser.add_argument(
        "--run-smoke",
        action="store_true",
        help="Startet nach dem Setup den lokalen FLUX-MPS-Smoke-Test.",
    )
    parser.add_argument(
        "--runtime-directory",
        type=Path,
        default=DEFAULT_RUNTIME_DIRECTORY,
        help="Verzeichnis für Python-Umgebung und Hugging-Face-Modellcache.",
    )
    return parser.parse_args()


def requirements_fingerprint() -> str:
    return hashlib.sha256(REQUIREMENTS_PATH.read_bytes()).hexdigest()


def ensure_runtime(runtime_directory: Path) -> Path:
    runtime_directory = runtime_directory.expanduser().resolve()
    virtual_environment = runtime_directory / "venv"
    python = virtual_environment / "bin" / "python"
    fingerprint_path = runtime_directory / "requirements.sha256"
    expected_fingerprint = requirements_fingerprint()

    runtime_directory.mkdir(parents=True, exist_ok=True)
    if not python.exists():
        print(f"Erzeuge isolierte Python-Umgebung: {virtual_environment}", flush=True)
        venv.EnvBuilder(with_pip=True).create(virtual_environment)

    installed_fingerprint = (
        fingerprint_path.read_text(encoding="utf-8").strip()
        if fingerprint_path.exists()
        else None
    )
    if installed_fingerprint != expected_fingerprint:
        print("Installiere die festgelegten Smoke-Test-Abhängigkeiten …", flush=True)
        subprocess.run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--requirement",
                str(REQUIREMENTS_PATH),
            ],
            check=True,
            cwd=PROJECT_ROOT,
        )
        fingerprint_path.write_text(f"{expected_fingerprint}\n", encoding="utf-8")
    else:
        print("Python-Abhängigkeiten sind bereits aktuell.", flush=True)

    return python


def run_smoke_test(python: Path, runtime_directory: Path) -> None:
    output_directory = STUDIO_DIRECTORY / "output"
    model_cache = runtime_directory.expanduser().resolve() / "huggingface"
    subprocess.run(
        [
            str(python),
            str(STUDIO_DIRECTORY / "smoke_test.py"),
            "--cache-directory",
            str(model_cache),
            "--output-directory",
            str(output_directory),
        ],
        check=True,
        cwd=PROJECT_ROOT,
    )


def main() -> None:
    arguments = parse_arguments()
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 oder neuer wird benötigt.")

    runtime_directory = arguments.runtime_directory.expanduser().resolve()
    python = ensure_runtime(runtime_directory)
    print(f"Runtime: {runtime_directory}", flush=True)
    if arguments.run_smoke:
        run_smoke_test(python, runtime_directory)
    else:
        print("Setup abgeschlossen. Starte den Test mit npm run product-images:smoke.", flush=True)


if __name__ == "__main__":
    main()
