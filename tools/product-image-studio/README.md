# Product Image Studio

Das Product Image Studio erzeugt mit `black-forest-labs/FLUX.2-klein-4B` lokal auf dem
Entwicklungs-Mac stilisierte Produktbilder. Modell und Bilder verlassen den Rechner nicht.

## Studio starten

```bash
npm run product-images:studio
```

Danach ist das Studio unter [http://127.0.0.1:7861](http://127.0.0.1:7861) erreichbar.
Beim ersten Start werden die isolierte Python-Umgebung und fehlende Modellgewichte automatisch
eingerichtet. Das Modell wird erst geladen, wenn der erste Auftrag verarbeitet wird.

Das Studio bietet:

- Produktname, optionale Stilbeschreibung und bis zu vier Referenzbilder,
- 1 bis 10 Varianten mit 512, 768 oder 1024 Pixeln,
- eine dauerhafte Warteschlange mit genau einem GPU-Worker,
- Fortschritt, Abbruch und Löschen von Aufträgen,
- Auswahl und Download des bevorzugten Ergebnisses.

Queue, Referenzen, Ergebnisse und Auswahl bleiben nach einem Neustart erhalten. Ein beim Beenden
unterbrochener Auftrag wird beim nächsten Start wieder in die Warteschlange gestellt und setzt bei
der nächsten noch fehlenden Variante fort.

Das Studio ist absichtlich nur an `127.0.0.1` gebunden. Es ist kein Bestandteil des produktiven
VPS und besitzt keine Anmeldung. Um einen anderen lokalen Port zu verwenden:

```bash
python3 tools/product-image-studio/bootstrap.py --run-server --port 7862
```

Referenzbilder werden als Stilhinweis an FLUX übergeben. Der Prompt weist das Modell ausdrücklich
an, nur Farbwelt, Formensprache, Textur, Licht und Komposition zu übernehmen. Trotzdem können
inhaltliche Merkmale einer Referenz auf das Ergebnis abfärben; Referenzen mit unterschiedlichen
Motiven eignen sich daher besser als vier Bilder desselben Produkts.

## Technischer Smoke-Test

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

Python-Umgebung, Modellgewichte, Queue und generierte Bilder liegen standardmäßig unter:

```text
~/Library/Caches/Einkaufszettel/product-image-studio/
```

Sie werden weder von OneDrive synchronisiert noch in Git aufgenommen. Das reine Smoke-Testbild
und seine Messwerte erscheinen lokal unter `tools/product-image-studio/output/`; auch dieses
Verzeichnis ist ignoriert.

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

Die Queue-Logik kann ohne Modell und ohne Download getestet werden:

```bash
npm run product-images:test
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
