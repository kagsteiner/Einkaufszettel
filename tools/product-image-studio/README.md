# Product Image Studio – MPS-Smoke-Test

Dieser erste Baustein prüft, ob `black-forest-labs/FLUX.2-klein-4B` lokal über PyTorch MPS
auf Apple Silicon geladen werden und ein reproduzierbares Produktbild erzeugen kann.

## Ausführen

```bash
npm run product-images:smoke
```

Beim ersten Lauf werden automatisch:

1. eine isolierte Python-Umgebung angelegt,
2. die festgelegten Python-Pakete installiert,
3. die festgelegte Modellrevision von Hugging Face geladen,
4. fehlende Modellgewichte heruntergeladen,
5. ein 768 × 768 Pixel großes Testbild erzeugt,
6. Laufzeit- und Speichermesswerte gespeichert.

Python-Umgebung und Modellgewichte liegen standardmäßig unter:

```text
~/Library/Caches/Einkaufszettel/product-image-studio/
```

Sie werden weder von OneDrive synchronisiert noch in Git aufgenommen. Testbild und Messwerte
erscheinen lokal unter `tools/product-image-studio/output/`; auch dieses Verzeichnis ist ignoriert.

Nur das isolierte Setup ohne Modelllauf kann separat ausgeführt werden:

```bash
npm run product-images:setup
```

Ein abweichender Cache lässt sich direkt über den Bootstrap-Aufruf festlegen:

```bash
python3 tools/product-image-studio/bootstrap.py \
  --runtime-directory /anderer/cache/pfad \
  --run-smoke
```

## Verifizierter Lauf auf dem Entwicklungs-Mac

Erfolgreich geprüft am 24. Juli 2026 auf einem MacBook Pro mit Apple M5 Max und 48 GB
Unified Memory:

- Modellrevision: `e7b7dc27f91deacad38e78976d1f2b499d76a294`
- PyTorch: `2.13.0`
- Python: `3.14.5`
- Ausgabe: 768 × 768 Pixel, vier Inferenzschritte
- erstmaliger Download und Pipeline-Start: 460,9 Sekunden
- erneuter Pipeline-Start aus dem lokalen Cache: 5,9 Sekunden
- erneute Bildgenerierung inklusive Decode: 3,8–3,9 Sekunden
- von MPS-Treiber belegter Speicher nach der Generierung: 18,4 GiB
- lokaler Gesamtcache einschließlich Python-Umgebung: rund 16 GB

Mehrere Läufe mit demselben Seed erzeugten byte-identische PNG-Dateien. Der Test lief nach dem
ersten Download auch mit `HF_HUB_OFFLINE=1` vollständig aus dem lokalen Snapshot. Modellrevision,
Paketversionen, Prompt und Seed sind festgelegt, damit spätere Änderungen bewusst erfolgen.
