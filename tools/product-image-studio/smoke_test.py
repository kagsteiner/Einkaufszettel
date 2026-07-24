from __future__ import annotations

import argparse
import json
import platform
import resource
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import torch

from flux_runtime import MODEL_ID, MODEL_REVISION, prepare_pipeline
PROMPT = (
    "A single ripe red tomato as a cheerful premium grocery catalog illustration. "
    "Centered, fully visible, three-quarter view, bold colorful stylized shapes, "
    "subtle tactile texture, soft studio lighting, gentle contact shadow, "
    "clean warm off-white background, generous empty margin, instantly recognizable, "
    "purely visual and completely text-free. Leave every surface and the background blank: "
    "do not render letters, words, numbers, labels, packaging print, logos, captions, "
    "signatures, watermarks, or writing-like marks. Zero readable or pseudo-readable text."
)
SEED = 20260724


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Erzeugt ein lokales FLUX.2-klein-Testbild über Apple MPS."
    )
    parser.add_argument("--cache-directory", required=True, type=Path)
    parser.add_argument("--output-directory", required=True, type=Path)
    parser.add_argument("--size", default=768, type=int)
    return parser.parse_args()


def gibibytes(byte_count: int) -> float:
    return round(byte_count / 1024**3, 3)


def main() -> None:
    arguments = parse_arguments()
    if arguments.size < 256 or arguments.size > 2048 or arguments.size % 16 != 0:
        raise SystemExit("--size muss zwischen 256 und 2048 liegen und durch 16 teilbar sein.")
    cache_directory = arguments.cache_directory.expanduser().resolve()
    output_directory = arguments.output_directory.expanduser().resolve()
    cache_directory.mkdir(parents=True, exist_ok=True)
    output_directory.mkdir(parents=True, exist_ok=True)

    print(f"Modell: {MODEL_ID}@{MODEL_REVISION}", flush=True)
    print(f"Cache: {cache_directory}", flush=True)
    load_started = time.perf_counter()
    try:
        pipeline = prepare_pipeline(cache_directory)
    except RuntimeError as error:
        raise SystemExit(str(error)) from error
    load_seconds = time.perf_counter() - load_started

    torch.mps.empty_cache()
    generation_started = time.perf_counter()
    result = pipeline(
        prompt=PROMPT,
        height=arguments.size,
        width=arguments.size,
        guidance_scale=1.0,
        num_inference_steps=4,
        generator=torch.Generator(device="cpu").manual_seed(SEED),
    )
    generation_seconds = time.perf_counter() - generation_started
    image = result.images[0]

    image_path = output_directory / "flux2-klein-mps-smoke.png"
    result_path = output_directory / "flux2-klein-mps-smoke.json"
    image.save(image_path, format="PNG", optimize=True)

    metrics = {
        "createdAt": datetime.now(UTC).isoformat(),
        "device": "mps",
        "generationSeconds": round(generation_seconds, 3),
        "height": arguments.size,
        "loadSeconds": round(load_seconds, 3),
        "macOS": platform.mac_ver()[0],
        "model": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "mpsAllocatedGiB": gibibytes(torch.mps.current_allocated_memory()),
        "mpsDriverAllocatedGiB": gibibytes(torch.mps.driver_allocated_memory()),
        "peakProcessResidentGiB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**3, 3),
        "prompt": PROMPT,
        "python": platform.python_version(),
        "seed": SEED,
        "size": arguments.size,
        "torch": torch.__version__,
        "width": arguments.size,
    }
    result_path.write_text(f"{json.dumps(metrics, indent=2, ensure_ascii=False)}\n", encoding="utf-8")

    print(f"Bild: {image_path}", flush=True)
    print(f"Messwerte: {result_path}", flush=True)
    print(
        f"Pipeline geladen in {load_seconds:.1f}s; Bild erzeugt in {generation_seconds:.1f}s.",
        flush=True,
    )


if __name__ == "__main__":
    main()
