from __future__ import annotations

from pathlib import Path

import torch
from diffusers import Flux2KleinPipeline


MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
MODEL_REVISION = "e7b7dc27f91deacad38e78976d1f2b499d76a294"


def load_pipeline(cache_directory: Path) -> Flux2KleinPipeline:
    snapshot_directory = (
        cache_directory
        / "models--black-forest-labs--FLUX.2-klein-4B"
        / "snapshots"
        / MODEL_REVISION
    )
    if (snapshot_directory / "model_index.json").exists():
        print(f"Lade vorhandenen lokalen Snapshot: {snapshot_directory}", flush=True)
        try:
            return Flux2KleinPipeline.from_pretrained(
                snapshot_directory,
                torch_dtype=torch.bfloat16,
                local_files_only=True,
            )
        except OSError:
            print(
                "Der lokale Snapshot ist unvollständig; setze den Download über Hugging Face fort …",
                flush=True,
            )

    print("Lade Pipeline; fehlende Modellgewichte werden heruntergeladen …", flush=True)
    return Flux2KleinPipeline.from_pretrained(
        MODEL_ID,
        cache_dir=cache_directory,
        revision=MODEL_REVISION,
        torch_dtype=torch.bfloat16,
    )


def prepare_pipeline(cache_directory: Path) -> Flux2KleinPipeline:
    if not torch.backends.mps.is_available():
        raise RuntimeError("Apple MPS ist in dieser PyTorch-Installation nicht verfügbar.")

    pipeline = load_pipeline(cache_directory)
    pipeline.enable_attention_slicing()
    pipeline.to("mps")
    return pipeline
