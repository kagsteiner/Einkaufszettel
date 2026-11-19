# Neue Produktbilder hinzufügen

## 1. Bildwünsche in der App sammeln

Fehlt einem neu hinzugefügten Produkt ein Bild, merkt die App den Produktnamen automatisch auf dem VPS vor. Das funktioniert auch beim Hinzufügen über Rezepte und Spracheingaben.

Wenn ein vorhandenes Bild nicht passt oder du ein bereits bestehendes Produkt melden möchtest:

1. Den Eintrag in der App bearbeiten.
2. **„Bild fehlt / passt nicht“** anklicken.
3. Die Bestätigung **„Bildwunsch vorgemerkt“** abwarten.

Die Meldung verwendet den gespeicherten Produktnamen. Namensänderungen deshalb zuerst speichern.

## 2. JSON-Datei auf dem VPS exportieren

Auf dem Mac im Terminal:

```bash
ssh vps
cd /home/agsteiner/nodejs/zettel
npm run product-images:export -- \
  --database /home/agsteiner/nodejs/zettel/data/einkaufszettel.db \
  --output /tmp/product-image-backlog.json
exit
```

Die Ausgabe nennt die Anzahl der exportierten Bildwünsche. Die Datenbank wird dabei nur gelesen.

**Wichtig:** Die App sammelt automatisch in ihrer Datenbank. Die JSON-Datei entsteht erst durch diesen Exportbefehl. Den Export vor jedem neuen Durchlauf wiederholen; eine vorhandene Exportdatei wird ersetzt.

## 3. Export auf den Mac kopieren

Im lokalen Projektverzeichnis `Einkaufszettel` ausführen:

```bash
scp vps:/tmp/product-image-backlog.json ./product-image-backlog.json
```

Die Datei enthält Produktnamen und ist von Git ausgeschlossen.

## 4. Product Image Studio starten

Ebenfalls im lokalen Projektverzeichnis:

```bash
npm run product-images:studio
```

Im Browser öffnen: [http://127.0.0.1:7861](http://127.0.0.1:7861).

Das Terminal während der Arbeit geöffnet lassen. Zum Beenden später `Ctrl+C` drücken. Beim ersten Start kann die Einrichtung länger dauern.

## 5. Backlog importieren und Bilder erstellen

1. Im Studio **„Backlog importieren“** wählen und die kopierte Datei `product-image-backlog.json` öffnen.
2. Beim gewünschten Produkt **„Generieren / neu versuchen“** anklicken. Der Produktname wird übernommen.
3. Anbieter auswählen:
   - **Lokal · FLUX:** Generierung auf dem Mac. Das Modell wird beim ersten lokalen Auftrag geladen.
   - **OpenAI · API:** Für schwierigere Motive. Modell, Qualität und Variantenanzahl wählen. Der vorhandene `OPENAI_API_KEY` wird beim npm-Start aus der lokalen Konfiguration übernommen; im Browser muss kein Schlüssel eingegeben werden.
4. Optional Stilhinweise und bis zu vier Referenzbilder hinzufügen.
5. Den Auftrag starten und auf die fertigen Varianten warten.
6. Die gewünschte Variante durch Anklicken auswählen.
7. **„In Bildersammlung übernehmen“** anklicken und **„Lokal übernommen“** abwarten.

OpenAI-Aufträge sind kostenpflichtig. Produktbeschreibung und gewählte Referenzbilder werden an OpenAI gesendet. Jede Variante erzeugt einen eigenen API-Aufruf. Bei einem unterbrochenen oder fehlgeschlagenen Auftrag vor einem erneuten Start die API-Nutzung prüfen; automatische Wiederholungen sind deaktiviert. Auch ein abgebrochener Aufruf kann bereits Kosten verursacht haben.

### Vorhandenes Bild verwenden

Wenn ein passendes Bild schon existiert, brauchst du keine Generierung:

1. Im Backlog unter **„Vorhandenes Bild zuordnen“** ein Bild auswählen.
2. Die Vorschau prüfen.
3. **„Zuordnung übernehmen“** anklicken.

Damit lassen sich beispielsweise bislang unbekannte Schreibweisen ergänzen.

## 6. Was wird automatisch gespeichert?

Beim Übernehmen einer generierten Variante schreibt das Studio:

- die PNG-Quelle nach `tools/product-image-studio/results/`,
- das fertige JPEG nach `public/images/products/`,
- die Produktzuordnung nach `public/images/product-images.json`.

Du musst keine Dateien manuell verschieben und keinen zusätzlichen Importbefehl ausführen. Vorhandene Katalogbilder bleiben erhalten. Erneutes Importieren desselben Backlogs erzeugt keine Duplikate.

**„Lokal erledigt · Deployment separat“** bedeutet: Die lokale Bildersammlung deckt den Bedarf ab. Auf dem VPS ist das Bild damit noch nicht verfügbar.

## 7. Bilder produktiv verfügbar machen

Nach der Auswahl müssen die geänderten JPEG-Dateien und der Bildkatalog geprüft, committed, nach GitHub gepusht und mit dem üblichen Verfahren auf dem VPS deployed werden. PNG-Quellen und Backlog-Export werden nicht committed.

Dafür kannst du Codex beispielsweise beauftragen:

> Prüfe die neu übernommenen Produktbilder und den Katalog, führe alle Checks aus, committe ausschließlich diese Änderungen und pushe sie nach GitHub.

Anschließend den üblichen VPS-Deploymentprozess ausführen. Diese Anleitung richtet keinen automatischen Deploymentprozess ein.

Wenn die App danach noch alte Bilder zeigt: In den Einstellungen **„Bilder neu laden“** anklicken.

Beim nächsten VPS-Export werden inzwischen produktiv behobene Bildwünsche ausgefiltert. Der bereits importierte lokale Backlog bleibt als Verlauf erhalten.

## Kurzablauf

```text
App nutzen / falsche Bilder melden
→ auf dem VPS exportieren
→ per scp auf den Mac kopieren
→ npm run product-images:studio
→ Backlog importieren
→ generieren oder vorhandenes Bild zuordnen
→ Variante auswählen und übernehmen
→ prüfen, committen, ausdrücklich pushen und deployen
→ bei Bedarf in der App „Bilder neu laden“
```
