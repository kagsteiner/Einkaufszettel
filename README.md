# Zettel

Mobile, gemeinsame Einkaufszettel für einen Haushalt – als kleine TypeScript-Web-App mit Node.js, SQLite, Echtzeit-Updates und optionaler Rezeptanalyse über OpenAI.

## Lokal starten

Voraussetzung ist Node.js 20.20.2 oder neuer.

```bash
npm install
cp .env.example .env
npm run dev
```

Die Werte in `.env` werden ausschließlich vom Repository-Eigentümer gepflegt. Für persönliche OpenAI API Keys wird ein 32-Byte-Hauptschlüssel benötigt; ein passender Wert lässt sich mit `openssl rand -base64 32` erzeugen und als `APP_ENCRYPTION_KEY` eintragen.

## Benutzer administrieren

Die Benutzerverwaltung ist bewusst nur als Server-CLI verfügbar und verwendet die konfigurierte `DATABASE_PATH`:

```sh
npm run admin:users -- list
npm run admin:users -- reset-password <E-Mail-oder-ID>
npm run admin:users -- delete <E-Mail-oder-ID>
```

Das Skript zeigt den verwendeten Datenbankpfad an. Vor dem unwiderruflichen Löschen sollte ein aktuelles Backup vorhanden sein und muss die exakte E-Mail-Adresse interaktiv eingegeben werden. Ohne interaktives Terminal ist `--confirm <exakte-E-Mail>` erforderlich. In einem gemeinsamen Haushalt bleiben Zettel, Items, Vorräte und Bilder erhalten; ihre technische Urheberschaft geht an ein verbleibendes Mitglied über. War die Person allein in ihrem Haushalt, werden der Haushalt und seine Daten vollständig gelöscht.

`reset-password` erzeugt einen vertraulichen Einmal-Link, der 30 Minuten gültig ist. Auf der verlinkten Seite vergibt der Benutzer selbst ein neues Passwort. Nach erfolgreicher Änderung werden alle bestehenden Sitzungen und weiteren Reset-Links des Kontos ungültig.

Im Entwicklungsmodus verwendet die Rezeptanalyse bevorzugt `OPENAI_API_KEY` aus der lokalen Laufzeitumgebung. Fehlt er, gilt der persönliche Schlüssel des angemeldeten Benutzers. Die übrige App funktioniert ohne OpenAI Key.

## Prüfen

```bash
npm test                 # Node- und SQLite-Tests
npm run test:browser     # mobile Chromium- und WebKit-Flows
npm run lint             # Biome
npm run build            # Typprüfung und gehashter Client-Build
npm run icons:app        # App- und Browser-Icons aus public/icon.png erzeugen
npm run check            # komplette Prüfung
```

OpenAI wird in automatisierten Tests gefälscht; Tests benötigen weder Netzwerk noch echte Zugangsdaten.

## Produktkategorien pflegen

Ändert ein Benutzer die Kategorie eines Produkts, merkt sich die Anwendung die exakte Zuordnung
für den gesamten Haushalt. Bei einem neuen Eintrag gilt diese Zuordnung vor dem allgemeinen
Produktkatalog und der Schlüsselwort-Heuristik.

Der vollständige, wiederkehrende Ablauf vom Export auf dem VPS über den Dateitransfer und die
Konfliktprüfung bis zu Commit und Deployment steht in
[Produktwissen-Workflow.md](Produktwissen-Workflow.md).

Das bewusst korrigierte Produktwissen lässt sich auf dem produktiven Server ohne Schreibzugriff
auf die Datenbank exportieren:

```bash
npm run categories:export -- --database <datenbank.db> --output <export.json>
```

Stimmen Haushalte bei einem Produkt nicht überein, führt der Export die Kategorien als Konflikt
auf und übernimmt das Produkt nicht automatisch. Nach dem Transfer ins Entwicklungsverzeichnis
wird ein konfliktfreier Export in den versionierten Katalog übernommen:

```bash
npm run categories:import -- --input <export.json>
```

Der Import ergänzt ausschließlich neue Zuordnungen. Widerspricht eine Zuordnung dem bestehenden
Katalog, bricht er ohne Änderung ab. Anschließend muss `npm run check` ausgeführt werden.

## Produktion

Setze mindestens `APP_ENV=production`, eine HTTPS-`APP_ORIGIN`, `DATABASE_PATH`, `UPLOAD_DIRECTORY` und `APP_ENCRYPTION_KEY`. Für einen Betrieb unter einem Unterpfad wie `/zettel` setze zusätzlich `APP_BASE_PATH=/zettel`. Der Server erwartet HTTPS-Terminierung durch einen Reverse Proxy. `TRUST_PROXY=true` ist nur korrekt, wenn der Proxy eingehende `X-Forwarded-For`-Header zuverlässig ersetzt.

SQLite-Migrationen laufen beim Start. Sichere Datenbank und Upload-Verzeichnis gemeinsam und teste die Wiederherstellung. Es gibt absichtlich keinen cache-basierten Service Worker; HTML und API bleiben `no-store`, während gehashte Assets langfristig gecacht werden dürfen.
