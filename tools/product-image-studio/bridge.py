"""Local Node helpers. Provider credentials stay in the inherited server environment."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Callable

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def call_bridge(payload: dict[str, Any], *, openai: bool = False,
                cancelled: Callable[[], bool] | None = None) -> dict[str, Any]:
    script = "product-image-openai-bridge.ts" if openai else "product-image-studio-bridge.ts"
    command = [os.environ.get("PRODUCT_IMAGE_NODE", "node"), "--import", "tsx", f"scripts/{script}"]
    with subprocess.Popen(command, cwd=PROJECT_ROOT, stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True) as process:
        data = json.dumps(payload)
        for attempt in range(1400 if openai else 120):
            try:
                output, _ = process.communicate(input=data if attempt == 0 else None, timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                if cancelled and cancelled():
                    process.kill()
                    process.communicate()
                    raise ValueError("Auftrag abgebrochen. Ein laufender API-Aufruf kann bereits berechnet worden sein.")
        else:
            process.kill()
            process.communicate()
            raise ValueError("Zeitlimit erreicht. API-Auftrag vor einem erneuten Start prüfen.")
    try:
        result = json.loads(output)
    except (ValueError, TypeError):
        raise ValueError("Lokaler Helfer konnte nicht ausgeführt werden.") from None
    if process.returncode or "error" in result:
        raise ValueError(result.get("error", "Lokaler Helfer ist fehlgeschlagen."))
    return result
