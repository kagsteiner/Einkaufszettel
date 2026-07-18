# Zettel – Produktspezifikation

## Zweck und Produktidee

Zettel ist ein gemeinsamer elektronischer Einkaufszettel für Haushalte. Die Anwendung ist für Smartphones optimiert, funktioniert aber auch auf Desktop-Browsern. Sie verbindet die einfache gemeinsame Bedienung von Apps wie Bring! mit gezielten AI-Funktionen, insbesondere dem Erkennen von Zutaten aus fotografierten Rezepten.

Die Kernfunktionen bleiben auch ohne OpenAI-Zugang nutzbar. AI-Funktionen ergänzen den Einkaufszettel, ersetzen aber keine Benutzerentscheidung.

## Begriffe und Datenmodell

- **Benutzer:** Person mit eigenem Konto, Anzeigenamen und optionalem persönlichem OpenAI API Key.
- **Haushalt:** Gemeinsamer Arbeitsbereich für seine gleichberechtigten Mitglieder. Ein Benutzer gehört in V1 genau einem Haushalt an.
- **Zettel:** Benannte Einkaufsliste innerhalb eines Haushalts, beispielsweise „Aldi“ oder „Baumarkt“. Ein Zettel kann ein optionales Bild haben.
- **Item:** Ein einzukaufendes Produkt auf einem Zettel. Es besitzt einen eindeutigen Namen, ein optionales Bild, optionale Mengenbestandteile und einen optionalen Zusatztext.
- **Vorrat:** Dauerhafte Sammlung von Dingen, die normalerweise vorhanden sind, beispielsweise Salz, Gewürze oder Olivenöl. Der Vorrat ist kein normaler Zettel.

## Konten und Authentifizierung

Die Registrierung erfolgt mit E-Mail-Adresse, Anzeigename und Passwort. Eine Anmeldung über Google, Apple, Meta oder andere externe Identitätsanbieter ist nicht vorgesehen. Der Anzeigename ist für andere Haushaltsmitglieder sichtbar und muss nicht eindeutig sein. Er kann in den Einstellungen geändert werden.

Passwörter werden niemals im Klartext oder reversibel gespeichert, sondern mit einem geeigneten Passwort-Hashverfahren und individuellem Salt gesichert. Nach erfolgreicher Anmeldung verwendet die Anwendung eine sichere serverseitige Sitzung mit `HttpOnly`-, `Secure`- und `SameSite`-Cookie.

Bei der Registrierung wird automatisch ein persönlicher Haushalt angelegt.

## Haushalte und Einladungen

Alle Mitglieder eines Haushalts sind gleichberechtigt. Sie können Zettel und Items bearbeiten, weitere Personen einladen und den Haushalt gemeinsam verwenden.

Eine Einladung wird für eine E-Mail-Adresse erzeugt und als zeitlich begrenzter Link bereitgestellt. Der Link darf nur von einem angemeldeten Benutzer mit der eingeladenen E-Mail-Adresse angenommen werden.

### Beitritt mit vorhandenen Zetteln

Ist der eingeladene Benutzer das einzige Mitglied seines bisherigen Haushalts, kann er beim Beitritt auswählen, ob er seine bisherigen Zettel und Vorräte mitnehmen möchte.

- Die Übertragung erfolgt vollständig in einer Datenbanktransaktion.
- Die App zeigt vor der Bestätigung eine Zusammenfassung der zu übertragenden Daten.
- Bei kollidierenden Zettelnamen erfolgt kein automatischer Merge. Der übertragene Zettel erhält einen verständlichen Zusatz wie „Aldi (alter Haushalt)“.
- Vorräte werden vereinigt; gleiche Produktnamen werden dabei nur einmal übernommen.
- Nach erfolgreicher Übertragung und dem Beitritt wird der leere alte Haushalt entfernt.

Hat der bisherige Haushalt weitere Mitglieder, wird diese Übertragung in V1 nicht angeboten. Ein allgemeines Zusammenführen von Haushalten und die Mitgliedschaft in mehreren Haushalten gehören nicht zu V1.

## Zettel und Items

Ein Haushalt besitzt eine lineare Sammlung von Zetteln ohne Ordner oder weitere Unterstruktur. Benutzer können Zettel und Items anlegen, bearbeiten, löschen und beim Einkauf abhaken.

Items können manuell hinzugefügt werden. Bilder stammen entweder aus einer mitgelieferten Bibliothek, der Kamera oder – soweit der Browser dies unterstützt – der Fotomediathek des Geräts.

### Produktnamen und Duplikate

Die vom Benutzer gewählte Schreibweise bleibt sichtbar und wird nicht automatisch großgeschrieben oder anderweitig korrigiert. Für den Vergleich erzeugt die Anwendung jedoch einen normalisierten Schlüssel: Unicode wird normalisiert, überflüssige Leerzeichen werden entfernt und Groß-/Kleinschreibung wird ignoriert. Umlaute oder andere inhaltliche Zeichen werden nicht entfernt.

Dadurch gelten beispielsweise „Tomaten“, „tomaten“ und „ TOMATEN “ auf demselben Zettel als dasselbe Item. Angezeigt wird weiterhin die zuerst gespeicherte Schreibweise.

### Mengen

Ein Item kann mehrere Mengenbestandteile besitzen. Nur Mengen mit derselben normalisierten Einheit werden automatisch addiert. Die Anwendung vereinheitlicht lediglich Schreibvarianten derselben Einheit, beispielsweise `g`/`Gramm`, `Stk.`/`Stück` oder `EL`/`Esslöffel`.

Es gibt keine Umrechnung zwischen unterschiedlichen Einheiten, Verpackungsarten oder physikalischen Größen. Insbesondere werden `kg` nicht in `g`, Tassen nicht in Milliliter und Kartons nicht in Stück umgerechnet.

Beispiele:

| Vorhanden | Hinzugefügt | Ergebnis |
| --- | --- | --- |
| `1 Flasche` | `2 Flaschen` | `3 Flaschen` |
| `300 g` | `200 g` | `500 g` |
| `300 g` | `2 Tassen` | `300 g + 2 Tassen` |
| keine Menge | `4 Stück` | `4 Stück` |
| keine Menge | keine Menge | unverändert |

Wird ein vorhandenes Item erneut hinzugefügt, aktualisiert die Anwendung dessen Menge nach diesen Regeln und informiert den Benutzer. Bei unterschiedlichen Einheiten weist sie darauf hin, dass eine zusätzliche Mengenangabe ergänzt wurde. Ungewöhnliche Kombinationen kann der Benutzer anschließend bearbeiten.

## Sortierung

Die Anwendung kennt eine zur Entwicklungszeit definierte Reihenfolge typischer Supermarktbereiche, beispielsweise Obst und Gemüse, Milchprodukte, Brot, Fleisch, Grundnahrungsmittel, Konserven, Gewürze, Getränke, Tiernahrung, Haushalt, Tiefkühlkost und Sonstiges.

Beim Hinzufügen werden Items standardmäßig alphabetisch dargestellt. Im Einkaufsmodus werden sie entsprechend der Supermarktreihenfolge gruppiert. Benutzer können zwischen beiden Ansichten wechseln; die Supermarktreihenfolge selbst ist in V1 nicht konfigurierbar.

## Zusammenarbeit und Synchronisation

Änderungen eines Haushalts sollen ohne manuelles Neuladen zeitnah auf allen verbundenen Geräten erscheinen. Schreiboperationen erfolgen über HTTP; der Server verteilt Aktualisierungen per Server-Sent Events. Nach einem Verbindungsabbruch lädt der Client den aktuellen Stand erneut.

Gleichzeitige Änderungen einzelner Textfelder werden nach dem Prinzip „letzte gespeicherte Änderung gewinnt“ behandelt. Das Hinzufügen und Zusammenführen gleicher Items erfolgt atomar auf dem Server, damit parallele Eingaben keine Mengen verlieren.

## Vorrat

Vorratsprodukte werden wie Produktnamen normalisiert und innerhalb eines Haushalts eindeutig gehalten. Bei der AI-gestützten Rezeptanalyse werden erkannte Zutaten, die bereits im Vorrat stehen, standardmäßig nicht zum Hinzufügen vorgeschlagen. Der Benutzer kann sie in der Vorschau bei Bedarf dennoch auswählen.

## AI-gestützte Rezeptanalyse

Ein Benutzer kann ein Rezept fotografieren oder ein vorhandenes Bild auswählen. Der Server sendet das Bild an ein bildfähiges OpenAI-Modell und fordert strukturierte Vorschläge für Produktname, Menge, Einheit und Zusatztext an.

Das Ergebnis ist immer ein unverbindlicher Vorschlag:

1. Die App zeigt alle erkannten Items in einer Vorschau.
2. Der Benutzer kann Items auswählen, abwählen und bearbeiten.
3. Bereits vorhandene Vorräte sind standardmäßig abgewählt.
4. Erst nach ausdrücklicher Bestätigung werden die ausgewählten Items zum aktuellen Zettel hinzugefügt.
5. Bereits vorhandene Items werden nach den definierten Mengenregeln aktualisiert.

Nicht erkennbare Rezepte, ungültige Schlüssel, OpenAI-Kontingentfehler und Netzwerkfehler werden verständlich angezeigt. Ein fehlgeschlagener Aufruf verändert den Zettel nicht.

Ein OpenAI `safety_identifier` wird in V1 nicht verwendet, da in der Produktion jeder Benutzer mit seinem eigenen API Key arbeitet.

## OpenAI API Keys

Benutzer können in den Einstellungen einen persönlichen OpenAI API Key hinterlegen, ersetzen und löschen. Ohne persönlichen Key bleiben alle normalen Einkaufsfunktionen verfügbar; nur AI-Funktionen sind deaktiviert.

Ein AI-Aufruf verwendet immer den Schlüssel des angemeldeten Benutzers, der den Aufruf auslöst. Der Schlüssel eines anderen Haushaltsmitglieds darf niemals verwendet oder geteilt werden.

### Auswahl des Schlüssels

- Ist `APP_ENV=development` gesetzt und `OPENAI_API_KEY` in der lokalen Laufzeitumgebung vorhanden, wird immer dieser Entwicklungsschlüssel verwendet.
- Fehlt der Entwicklungsschlüssel, wird der persönliche Schlüssel des angemeldeten Benutzers verwendet.
- In der Produktionsumgebung wird ausschließlich der persönliche Benutzerschlüssel verwendet. Ein dort versehentlich gesetztes `OPENAI_API_KEY` wird ignoriert.

Standard-API-Keys werden nur auf dem Server verarbeitet und niemals an Browsercode oder andere Benutzer zurückgegeben. Gespeicherte Keys werden mit authentifizierter Verschlüsselung abgelegt und in der Oberfläche nur maskiert angezeigt. Der dafür erforderliche Hauptschlüssel liegt außerhalb der SQLite-Datenbank in der Produktionsumgebung. API Keys dürfen nicht im Klartext in Logs, Fehlermeldungen oder Backups erscheinen.

## Bilder und Datenschutz

Uploads werden hinsichtlich Dateityp und Größe begrenzt. Bildmetadaten, insbesondere Standortinformationen, werden entfernt. Bilder erhalten nicht erratbare interne Kennungen und werden nur nach erfolgreicher Berechtigungsprüfung ausgeliefert; sie liegen nicht unter frei zugänglichen öffentlichen URLs.

Rezeptbilder werden nach der Analyse gelöscht, sofern der Benutzer sie nicht ausdrücklich als Bild eines Zettels oder Items speichert. Die SQLite-Datenbank speichert Bildmetadaten und Referenzen; die eigentlichen Dateien können im geschützten Dateisystem des VPS liegen.

## Architektur

Die Anwendung wird als responsive, browserbasierte TypeScript-Anwendung umgesetzt. Ein Node.js-Server stellt Benutzeroberfläche, HTTP-API und Server-Sent Events bereit. SQLite speichert Benutzer, Haushalte, Zettel, Items, Mengen, Einladungen und Sitzungen.

Die Architektur trennt Browseroberfläche, API, Domänenlogik und Persistenz. Datenbankänderungen erfolgen über versionierte Migrationen. SQLite läuft im WAL-Modus; schreibende Geschäftsoperationen verwenden Transaktionen. V1 ist für eine einzelne Serverinstanz auf einem VPS ausgelegt, nicht für horizontale Skalierung.

Abhängigkeiten werden bewusst gering gehalten, sicherheitskritische Standardlösungen werden jedoch nicht selbst erfunden. Alle Produktionszugriffe erfolgen über HTTPS. Jede Serveroperation prüft die Sitzung und die Haushaltsmitgliedschaft. Eingaben werden validiert, Datenbankabfragen parametrisiert und sensible Endpunkte gegen Missbrauch begrenzt. Datenbank und Bilder werden regelmäßig gesichert; Wiederherstellungen müssen getestet werden.

## Nicht Bestandteil von V1

- Analyse von Kühlschrank- oder Vorratsraumbildern zur automatischen Erkennung fehlender Produkte
- Allgemeines Zusammenführen mehrerer Haushalte
- Mitgliedschaft eines Benutzers in mehreren Haushalten
- Anmeldung über externe Identitätsanbieter
- Benutzerdefinierte Supermarktreihenfolgen
- Automatische Umrechnung zwischen Mengen- oder Verpackungseinheiten
- Ein zentral vom Betreiber finanzierter OpenAI-Zugang
