# Product Image Studio

Das Product Image Studio erzeugt mit `black-forest-labs/FLUX.2-klein-4B` lokal auf dem
Entwicklungs-Mac stilisierte Produktbilder. Alternativ erzeugt es Bilder über die OpenAI-API.
Bei lokalen Aufträgen bleiben Bilder und Modell auf dem Mac; bei OpenAI-Aufträgen werden Prompt
und ausgewählte Stilreferenzen an OpenAI gesendet.

## Studio starten

```bash
npm run product-images:studio
```

Danach ist das Studio unter [http://127.0.0.1:7861](http://127.0.0.1:7861) erreichbar.
Beim ersten Start wird die isolierte Python-Umgebung eingerichtet. Modellgewichte werden erst
für den ersten lokalen FLUX-Auftrag geladen. Für OpenAI-Aufträge wird FLUX nicht geladen.
Der npm-Start übergibt `OPENAI_API_KEY` aus der lokalen Startkonfiguration an den Studio-Server.
Der Schlüssel wird nicht im Browser gespeichert oder an ihn ausgeliefert. Die Konfigurationsdatei
bleibt ausschließlich beim Repository-Eigentümer; sie wird weder kopiert noch verändert.

Das Studio bietet:

- Produktname, optionale Stilbeschreibung und bis zu vier Referenzbilder,
- 1 bis 10 Varianten mit 512, 768 oder 1024 Pixeln,
- einen strikten textfreien Grundprompt, der auch Beschriftungen aus Referenzen ignoriert,
- eine dauerhafte Warteschlange mit genau einem GPU-Worker,
- Fortschritt, Abbruch und Löschen von Aufträgen,
- sicheres Löschen aller Drafts einschließlich ihrer Referenzen und Varianten,
- Auswahl und Download des bevorzugten Ergebnisses,
- Import des VPS-Backlogs und Zuordnung vorhandener Bilder mit Vorschau,
- direkte Übernahme einer Variante inklusive JPEG-Konvertierung und Katalogpflege,
- bewusste Wahl zwischen lokalem FLUX und kostenpflichtiger OpenAI-Bildgenerierung.

Queue, Backlog, Referenzen, Ergebnisse, Auswahl und Übernahmestatus bleiben nach einem Neustart
erhalten. Unterbrochene lokale Aufträge setzen bei der nächsten fehlenden Variante fort.
Unterbrochene OpenAI-Aufträge werden als fehlgeschlagen markiert und niemals automatisch wiederholt:
Ein Aufruf könnte bereits berechnet worden sein. Bereits gespeicherte Varianten bleiben erhalten.
Nach Prüfung der API-Nutzung kann ein neuer Auftrag bewusst gestartet werden.

OpenAI verwendet 1024 × 1024 Pixel, eine gewählte Qualität (`low`, `medium`, `high`) und pro
Variante einen API-Aufruf. Modellwahl: GPT Image 1.5, GPT Image 2 oder ChatGPT Image Latest.
Die tatsächliche Verfügbarkeit hängt vom API-Projekt ab. Seeds gelten ausschließlich für FLUX.
Abbruch beendet die lokale Anfrage und verhindert weitere Varianten; ein schon laufender
OpenAI-Aufruf kann trotzdem Kosten verursachen. Das SDK wiederholt fehlgeschlagene Aufrufe nicht.

`Delete all` entfernt nach einer Bestätigung sämtliche Drafts, hochgeladenen Stilreferenzen und
generierten Varianten. Bereits nach `tools/product-image-studio/results/` übernommene Produktbilder
bleiben erhalten. Während eine Generierung läuft, ist die Funktion gesperrt; der Auftrag muss
zuerst abgebrochen werden.

Das Studio ist absichtlich nur an `127.0.0.1` gebunden. Es ist kein Bestandteil des produktiven
VPS und besitzt keine Anmeldung. Um einen anderen lokalen Port zu verwenden:

```bash
npm run product-images:studio -- --port 7862
```

Referenzbilder werden als Stilhinweis an FLUX übergeben. Der Prompt weist das Modell ausdrücklich
an, nur Farbwelt, Formensprache, Textur, Licht und Komposition zu übernehmen. Trotzdem können
inhaltliche Merkmale einer Referenz auf das Ergebnis abfärben; Referenzen mit unterschiedlichen
Motiven eignen sich daher besser als vier Bilder desselben Produkts.

## Fehlende Bilder aus der produktiven App bearbeiten

Nach Deployment dieser Version wird Migration `007-product-image-backlog.sql` automatisch angewendet.
Beim Hinzufügen oder Umbenennen eines gespeicherten Produkts erfasst der Server fehlende Katalogbilder,
auch aus Rezept- und Spracheingaben. Persönliche Fotos werden dabei berücksichtigt. Bloßes Tippen,
Ansehen oder Laden der App erzeugt keine Sichtung. Bereits vorhandene, unveränderte Produkte werden
nicht rückwirkend erfasst; sie können im Produktdialog mit **„Bild fehlt / passt nicht“** gemeldet werden.
Die Meldung bezieht sich auf den gespeicherten Namen. Sie eignet sich auch für falsche Ersatzbilder.

Der gemeinsame Backlog enthält normalisierte Produktnamen, Anzahl und Zeitraum der Sichtungen sowie
den Grund und einen Fingerabdruck des bisherigen Bildes. Keine Benutzer, Zettel, Mengen oder Notizen
werden exportiert. Produktnamen können persönlich sein; Export und lokale Studio-Daten bleiben privat.

Auf dem VPS im Anwendungsverzeichnis:

```bash
npm run product-images:export -- \
  --database /srv/einkaufszettel/data/einkaufszettel.db \
  --output /tmp/product-image-backlog.json
```

Den Datenbankpfad an die Installation anpassen. Standardmäßig wird der ausgelieferte Katalog aus
`dist/public` verwendet; bei abweichendem Aufbau `--public <public-Verzeichnis>` ergänzen.
Die Datenbank wird read-only geöffnet. Die Exportdatei wird atomar mit Dateirechten `0600` ersetzt.
Nach einem Deployment versorgte Produkte bzw. geänderte gemeldete Bilder werden beim Export ausgefiltert.
Dafür wird dieselbe Bildauflösung wie im Browser verwendet, bei gemeldeten Bildern einschließlich
SHA-256 der Bilddatei. Ein bloßer Wechsel von Zeitstempeln löst keine Meldung auf.

Auf dem Mac:

```bash
scp <benutzer>@<vps-host>:/tmp/product-image-backlog.json ./product-image-backlog.json
npm run product-images:studio
```

Im Studio **„Backlog importieren“** wählen. Erneute Importe erzeugen keine Duplikate und addieren
Sichtungszahlen nicht erneut. Dann je Produkt:

1. **„Generieren / neu versuchen“** füllt den Produktnamen aus. Anbieter, Qualität, Varianten und
   optionale Stilreferenzen wählen und den Auftrag starten.
2. Eine fertige Variante durch Anklicken auswählen.
3. **„In Bildersammlung übernehmen“** schreibt automatisch die PNG-Quelle nach
   `tools/product-image-studio/results/`, das JPEG nach `public/images/products/` und die Zuordnung
   nach `public/images/product-images.json`. Vorhandene Synonyme und Fallbacks bleiben erhalten.
4. Alternativ ein vorhandenes Bild auswählen, die Vorschau prüfen und **„Zuordnung übernehmen“**
   klicken. So lassen sich auch bisher unbekannte Schreibweisen ohne Generierung ergänzen.

**„Lokal erledigt · Deployment separat“** bedeutet, dass der lokale Katalog den Bedarf bereits abdeckt.
Es ist keine Bestätigung über den Stand auf dem VPS. Auch ein erneut importierter alter Export öffnet
solche Einträge nicht wieder, solange das lokale Bild den ursprünglichen Bedarf löst. Der lokale
Backlog bleibt als Verlauf erhalten; ein aktueller Export enthält produktiv behobene Fälle nicht mehr.
Bei einer neuen Meldung zu einem inzwischen ausgelieferten Bild wird dessen neuer Fingerabdruck geprüft.

Vor der Veröffentlichung `git diff` und `npm run check` prüfen. Die beabsichtigten JPEG-Dateien und den
Katalog lokal committen. Push und Deployment erfolgen weiterhin nur auf ausdrückliche Anweisung.
Exportdateien und PNG-Quellen sind ignoriert. Ein laufender Entwicklungsserver benötigt nach Übernahme
gegebenenfalls einen Client-Neubuild, da er `dist/public` ausliefert. In der App kann anschließend unter
Einstellungen **„Bilder neu laden“** verwendet werden.

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

Für im Studio übernommene Varianten ist kein weiterer Import nötig. Für manuell abgelegte
PNG-Dateien bleibt `product-images:import` verfügbar. Standardquelle ist
`tools/product-image-studio/results/`; optional lässt sich ein anderes Quellverzeichnis als
Argument übergeben. Dateinamen werden als Produktnamen bzw. vorhandene Produkt-IDs behandelt.
Der Import arbeitet ergänzend und erhält Katalogbilder auch ohne lokale PNG-Quelle. Er erzeugt 768 × 768 Pixel große, progressive
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
einen gleichnamigen Produktknoten. Existiert bereits ein gleichnamiger Knoten, erhält er beim Import
automatisch das neue eigene Bild und behält seinen bisherigen Fallback als Reserve. Damit ersetzt
zum Beispiel ein später ergänztes `schinken.png` das bis dahin nur geliehene generische Bild. Die
lokalen PNG-Quellen werden weder verändert noch in Git aufgenommen.

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
