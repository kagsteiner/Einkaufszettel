# Zettel

Mobile, gemeinsame Einkaufszettel für einen Haushalt – als kleine TypeScript-Web-App mit Node.js, SQLite, Echtzeit-Updates und optionaler Rezeptanalyse über OpenAI.

## Lokal starten

Voraussetzung ist Node.js 26 oder neuer.

```bash
npm install
cp .env.example .env
npm run dev
```

Die Werte in `.env` werden ausschließlich vom Repository-Eigentümer gepflegt. Für persönliche OpenAI API Keys wird ein 32-Byte-Hauptschlüssel benötigt; ein passender Wert lässt sich mit `openssl rand -base64 32` erzeugen und als `APP_ENCRYPTION_KEY` eintragen.

Im Entwicklungsmodus verwendet die Rezeptanalyse bevorzugt `OPENAI_API_KEY` aus der lokalen Laufzeitumgebung. Fehlt er, gilt der persönliche Schlüssel des angemeldeten Benutzers. Die übrige App funktioniert ohne OpenAI Key.

## Prüfen

```bash
npm test                 # Node- und SQLite-Tests
npm run test:browser     # mobile Chromium- und WebKit-Flows
npm run lint             # Biome
npm run build            # Typprüfung und gehashter Client-Build
npm run check            # komplette Prüfung
```

OpenAI wird in automatisierten Tests gefälscht; Tests benötigen weder Netzwerk noch echte Zugangsdaten.

## Produktion

Setze mindestens `APP_ENV=production`, eine HTTPS-`APP_ORIGIN`, `DATABASE_PATH`, `UPLOAD_DIRECTORY` und `APP_ENCRYPTION_KEY`. Der Server erwartet HTTPS-Terminierung durch einen Reverse Proxy. `TRUST_PROXY=true` ist nur korrekt, wenn der Proxy eingehende `X-Forwarded-For`-Header zuverlässig ersetzt.

SQLite-Migrationen laufen beim Start. Sichere Datenbank und Upload-Verzeichnis gemeinsam und teste die Wiederherstellung. Es gibt absichtlich keinen cache-basierten Service Worker; HTML und API bleiben `no-store`, während gehashte Assets langfristig gecacht werden dürfen.
