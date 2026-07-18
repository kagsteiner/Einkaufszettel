## Zweck der App

Lass uns die App erst mal "Zettel" nennen. Zettel ist ein elektronischer Einkaufszettel, ähnlich wie "Bring!", aber konsequent AI-Technologien nutzend. Im Prinzip soll es die App erlauben, dass mehrere Leute zusammen Einkaufszettel bearbeiten und beim Einkaufen abhaken.

## Features

* Die App ist für's Handy optimiert, funktioniert aber auch auf einem PC.
* Authentifizierungssystem - beim ersten Anmelden muss man sich mit User und Passwort anmelden. Anmelden via Google/Apple/Meta soll nicht unterstützt werden. Die Anmeldeinformationen sollen sicher in einer sqlite Datenbank gespeichert werden.
* Die App kennt eine ganze lineare Liste von Zetteln, ohne Unterstruktur, wie "Bring!"
* Anders als bei "Bring!" ist die ganze Liste der Zettel eine Gemeinschaftsarbeit. Man kann weitere e-mail Adressen als gleichberechtigte Owner der Liste hinzufügen. Man kann einen Link auf die URL dieser Liste mit jemandem teilen.
* Was passiert, wenn der jemand schon eine eigene Liste hat? Ich glaube, der 90% Fall ist, dass eine Familie genau einen Zettel braucht. Eine "Liste meiner Listen" ist Komplexität ohne Nutzen. Darum werden die beiden Listen gemergt, wenn der eingeladene annimmt. To be discussed!
* Eine Liste besteht aus einer Anzahl von Zetteln. Jeder Zettel hat einen (eindeutigen) Namen und ein optionales Bild.
* Ein Zettel besteht aus einer Liste von Einkaufs-Items, etwa "Salat". 
* Ein Item besteht aus einem (eindeutigen) Namen, einem optionalen Bild, einer Mengenangabe, und einem Zusatztext.
* Die App kann manuell neue Items hinzufügen. Bilder kann man aus einer vorgegebenen Bibliothek auswählen, oder selbst aufnehmen / aus der Fotomediathek auswählen.
* Man kann ein Rezept fotografieren. Dann wird ein LLM von OpenAI aufgerufen, um das Bild zu analysieren. Das LLM schlägt dann eine Menge neuer Items vor, die das Rezept enthält. Der Benutzer kann Items selektieren / deselektieren, und Informationen der Items nachbearbeiten. Danach klickt er "okay" und die Items werden zur aktuellen Liste hinzugefügt.
* Eine Spezielle Liste "hab ich" enthält Items, die immer zu Hause sind (Gewürze, Olivenöl). Beim automatischen Hinzufügen werden diese Items automatisch nicht genannt.
* Ein späteres Feature soll sein, dass man einige Bilder von Kühlschrank und Vorratsraum machen kann, die App analysiert mit AI, was fehlt, und fügt die Items zum Zettel hinzu (nicht V1.0).
* Die App kennt eine Liste von Dingen, die man in einem Supermarkt findet, und deren Reihenfolge im normalen Durchlauf durch den Supermarkt (also typischerweise Obst, Milchprodukte und Brot, Fleisch, Backwaren/Mehl/Salz, Nudeln, Dosen und Gläser mit Obst/Gemüse/Fisch drin, Gewürze, Knabbereien, Wein, Säfte, Tiernahrung, Haushaltsgegenstände, Kekse, Tiefkühlkost, Sonstiges. Die Sortierreihenfolge der Items ist entsprechend dieser Durchlaufliste. Frage: ist das einstellbar / leicht wechselbar alphabetisch / Reihenfolge? Vermutlich sinnvoll, beim Hinzufügen möchte man alphabetisch, beim Einkaufen möchte man der Reihenfolge nach. Diese Reihenfolge wird einmal zur Entwicklungszeit definiert und ist nicht vom Benutzer änderbar.

## Architektur

Das ist jetzt die Frage: Zugriff auf die Kamera ist wichtig. Die Foto-Mediathek des Handies wäre nett, ist aber nicht so wichtig. 

Am Liebsten wäre mir eine Browserbasierte Anwendung in Typescript + node.js + sqlite mit minimalen Dependencies.

Wichtig ist es, dass die App für viele Benutzer gebaut sein soll, und darum großer Wert auf Sicherheit der Daten gelegt wird.
