# Produktwissen aus der produktiven App übernehmen

Diese Anleitung beschreibt den wiederkehrenden Ablauf, mit dem bewusst korrigierte
Produktkategorien aus der produktiven SQLite-Datenbank in den allgemeinen, versionierten
Produktkatalog der App gelangen.

Der Ablauf ist absichtlich nicht vollautomatisch:

1. Die produktive App sammelt ausschließlich manuelle Kategorieänderungen.
2. Ein Export liest dieses Produktwissen ohne Schreibzugriff aus der Datenbank.
3. Der Export wird ins Entwicklungsverzeichnis übertragen und auf Konflikte geprüft.
4. Ein Import ergänzt den allgemeinen Produktkatalog.
5. Tests, Commit, Push und Deployment verteilen das neue Wissen an alle Installationen.

## Voraussetzung

Die Version mit Migration `006-product-category-knowledge.sql` muss auf dem VPS laufen. Die
Migration wird beim ersten Start dieser Version automatisch ausgeführt. Erst danach können
manuelle Kategorieänderungen als Produktwissen gesammelt und exportiert werden.

Der Pfad der produktiven Datenbank entspricht dem auf dem VPS konfigurierten `DATABASE_PATH`.
Die Konfigurationsdatei selbst soll für diesen Ablauf weder kopiert noch ins
Entwicklungsverzeichnis übertragen werden.

## 1. Kategorien während der Nutzung korrigieren

Produkte werden in der produktiven App ganz normal bearbeitet. Jede echte Änderung des
Einkaufsbereichs wird als exakte Zuordnung für den Haushalt gespeichert, zum Beispiel:

```text
Hafercuisine → Grundnahrungsmittel
```

Das gilt auch für Korrekturen einer falschen automatischen Zuordnung und für eine bewusste
Änderung zurück zu „Sonstiges“. Das bloße Speichern eines unveränderten Einkaufsbereichs erzeugt
kein neues Produktwissen.

## 2. Produktwissen auf dem VPS exportieren

Im Verzeichnis der auf dem VPS installierten Anwendung ausführen:

```bash
npm run categories:export -- \
  --database <absoluter-pfad-zur-produktiven-datenbank> \
  --output /tmp/product-category-export.json
```

Beispiel mit einem fiktiven Datenbankpfad:

```bash
npm run categories:export -- \
  --database /srv/einkaufszettel/data/einkaufszettel.db \
  --output /tmp/product-category-export.json
```

Das Skript öffnet die Datenbank read-only. Es exportiert nur Produktnamen und Kategorien, keine
Benutzer, Zettel, Mengen oder Notizen. Die Ausgabedatei wird mit eingeschränkten Dateirechten
angelegt.

Enthält die Datenbank mehrere Haushalte, werden übereinstimmende Zuordnungen zusammengefasst.
Unterschiedliche Kategorien für denselben normalisierten Produktnamen erscheinen separat unter
`conflicts` und werden nicht automatisch als Produkt übernommen.

## 3. Export ins Entwicklungsverzeichnis übertragen

Auf dem Entwicklungsrechner ausführen und Host, Benutzer sowie Zielverzeichnis anpassen:

```bash
scp <vps-benutzer>@<vps-host>:/tmp/product-category-export.json \
  ./product-category-export.json
```

Die Datei kann alltägliche oder persönliche Produktbezeichnungen enthalten. Sie ist deshalb über
`.gitignore` vom Repository ausgeschlossen und soll nicht committed werden.

## 4. Export prüfen

Die JSON-Datei vor dem Import kurz ansehen. Ein konfliktfreier Export sieht beispielsweise so aus:

```json
{
  "products": [
    {
      "category": "staples",
      "name": "Hafercuisine"
    }
  ],
  "version": 1
}
```

Falls ein Abschnitt `conflicts` vorhanden ist, bricht der Import ohne Änderung ab. Die Konflikte
müssen bewusst entschieden werden: Die gewünschte Zuordnung wird als normaler Eintrag unter
`products` eingetragen und der dazugehörige Konflikt entfernt. Bei Unsicherheit bleibt das Produkt
aus dem allgemeinen Katalog heraus.

## 5. Allgemeinen Produktkatalog aktualisieren

Im Entwicklungsverzeichnis ausführen:

```bash
npm run categories:import -- --input ./product-category-export.json
```

Der Import aktualisiert:

```text
src/shared/product-category-catalog.json
```

Er ergänzt nur neue exakte Zuordnungen. Ist ein Produkt bereits mit derselben Kategorie vorhanden,
wird es übersprungen. Widerspricht der Export einer vorhandenen Kategorie, bricht der Import ohne
Änderung ab und meldet den Konflikt.

Anschließend den tatsächlichen Katalog-Diff prüfen:

```bash
git diff -- src/shared/product-category-catalog.json
```

## 6. App vollständig prüfen

```bash
npm run check
```

Dieser Befehl umfasst Typprüfung, Node-/SQLite-Tests, Lint, Browser-Tests und Produktionsbuild.
Ein fehlgeschlagener Check muss vor der Übernahme geklärt werden.

## 7. Katalog committen, pushen und deployen

Nur den beabsichtigten Katalog und gegebenenfalls dazugehörige Tests oder Dokumentation stagen:

```bash
git add src/shared/product-category-catalog.json
git commit -m "data(categories): expand product catalog"
```

Der Commit verbessert zunächst nur das lokale Entwicklungsrepository. Damit alle Installationen
profitieren, muss er anschließend ausdrücklich nach GitHub gepusht und über den normalen
VPS-Deploymentprozess ausgerollt werden.

Bei Arbeit mit Codex genügt nach dem Transfer zum Beispiel:

```text
Importiere product-category-export.json in den allgemeinen Produktkatalog,
prüfe die Konflikte, führe alle Checks aus und committe das Ergebnis.
```

Ein Push erfolgt gemäß den Repository-Regeln nur auf ausdrückliche Anweisung, beispielsweise:

```text
Übernimm den geprüften Katalog und pushe ihn nach GitHub.
```

## 8. Exportdateien aufräumen

Nach erfolgreicher Übernahme können die lokalen und auf dem VPS liegenden Exportdateien gelöscht
oder außerhalb des Repositorys geschützt archiviert werden. Für den nächsten Durchlauf wird stets
ein neuer Export aus der aktuellen produktiven Datenbank erzeugt.

## Kurzfassung für den nächsten Durchlauf

```text
VPS:
  categories:export → /tmp/product-category-export.json

Entwicklungsrechner:
  scp → Export prüfen → categories:import → git diff → npm run check
  → commit → ausdrücklich pushen → deployen
```
