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
- einen strikten textfreien Grundprompt, der auch Beschriftungen aus Referenzen ignoriert,
- eine dauerhafte Warteschlange mit genau einem GPU-Worker,
- Fortschritt, Abbruch und Löschen von Aufträgen,
- sicheres Löschen aller Drafts einschließlich ihrer Referenzen und Varianten,
- Auswahl und Download des bevorzugten Ergebnisses.

Queue, Referenzen, Ergebnisse und Auswahl bleiben nach einem Neustart erhalten. Ein beim Beenden
unterbrochener Auftrag wird beim nächsten Start wieder in die Warteschlange gestellt und setzt bei
der nächsten noch fehlenden Variante fort.

`Delete all` entfernt nach einer Bestätigung sämtliche Drafts, hochgeladenen Stilreferenzen und
generierten Varianten. Bereits nach `tools/product-image-studio/results/` übernommene Produktbilder
bleiben erhalten. Während eine Generierung läuft, ist die Funktion gesperrt; der Auftrag muss
zuerst abgebrochen werden.

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

## Ausgewählte Bilder in die App importieren

Ausgewählte PNG-Dateien liegen lokal unter `tools/product-image-studio/results/`. Ihre Dateinamen
werden als Produktnamen behandelt. Der Import erzeugt daraus 768 × 768 Pixel große, progressive
JPEG-Dateien mit MozJPEG-Qualität 84:

```bash
npm run product-images:import
```

Die fertigen Assets stehen unter `public/images/products/`. Der Katalog
`public/images/product-images.json` trennt die verfügbaren Bilddateien von visuellen
Produktknoten. Echte Synonyme stehen gemeinsam in `names`:

```json
{
  "id": "mozzarella",
  "names": ["mozzarella", "mozzarellas"],
  "image": "mozzarella",
  "imageFallback": "kaese"
}
```

Verschiedene Produkte erhalten getrennte Knoten, auch wenn sie zunächst dasselbe Bild verwenden.
Besitzt ein Produkt kein eigenes Bild, verweist `imageFallback` auf den visuell sinnvollsten
Produktknoten. Das ist ausdrücklich keine natürliche Produkthierarchie. Geriebener Mozzarella
sieht beispielsweise eher wie anderer Reibekäse als wie eine Mozzarellakugel aus:

```json
{
  "id": "mozzarella-gerieben",
  "names": ["mozzarella gerieben"],
  "imageFallback": "reibekaese"
}
```

Die App folgt der visuellen Kette, bis sie ein Bild findet, zum Beispiel
`wacholderschinken → schinken → fleisch`. Zyklen, fehlende Referenzen und doppelte normalisierte
Namen werden von den Tests abgelehnt. Ein erneuter Import konvertiert die PNG-Dateien neu, erhält
aber alle gepflegten Produktknoten und Fallbacks. Kataloge der alten Version 1 werden beim ersten
Import automatisch nach Version 2 migriert. Neue PNG-Dateien erzeugen automatisch je ein Bild und
einen gleichnamigen Produktknoten. Existiert bereits ein gleichnamiger reiner Fallback-Knoten,
erhält er beim Import automatisch das neue eigene Bild und behält seinen bisherigen Fallback als
Reserve. Die lokalen PNG-Quellen werden weder verändert noch in Git aufgenommen.

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
