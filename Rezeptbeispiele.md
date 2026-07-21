## Warum?

Um herauszufinden, was für Mengeneinheiten verwendet werden

## Bestandsaufnahme der Mengenangaben

Die Beispiele enthalten nicht nur Einheiten. Sie vermischen physikalische Maße, zählbare Gebinde, Stückbezeichnungen, Größenangaben und unbestimmte Mengen. Für eine spätere Normalisierung müssen diese Gruppen getrennt werden.

### Tatsächlich gefundene Einheiten und Schreibweisen

| Rohformen in den Beispielen | Gemeintes Konzept | Gruppe | Hinweise |
| --- | --- | --- | --- |
| `g`, angehängt als `400g` | Gramm | Masse | Leerzeichen darf optional sein. |
| `ml`, angehängt als `180ml` | Milliliter | Volumen | Leerzeichen darf optional sein. |
| `Liter` | Liter | Volumen | Ausgeschriebene Form; `l` kommt in den Beispielen nicht vor. |
| `EL` | Esslöffel | Küchenvolumen | Abkürzung bleibt im Singular und Plural gleich. |
| `TL` | Teelöffel | Küchenvolumen | Abkürzung bleibt im Singular und Plural gleich. |
| `tbsp` | tablespoon | Küchenvolumen | Englische Quelle; soll bereits vom LLM als `EL` geliefert werden. |
| `tsp` | teaspoon | Küchenvolumen | Englische Quelle; soll bereits vom LLM als `TL` geliefert werden. |
| `Tasse`, `Tasse/n` | Tasse | Küchenvolumen oder Gefäß | `Tasse/n` ist redaktionelle Singular/Plural-Schreibweise. Ohne definierte Tassengröße nicht sicher in ml umrechenbar. |
| keine Einheit, z. B. `4 Bananen` | Stück | Zählung | Die Einheit ist implizit und steckt teilweise im Produktwort. |
| `Zehe/n`, `Zehe(n)`, `Knoblauchzehe(n)` | Zehe | produktspezifische Zählung | Slash und Klammern markieren alternative Flexionen. `Knoblauchzehe` steht teilweise komplett im Produktfeld. |
| `Bund`, `bunch` | Bund | Gebinde | Englisches `bunch` soll das LLM übersetzen. Die reale Größe ist nicht standardisiert. |
| `Prise`, `Prisen`, `Prise(n)`, `pinch`, `generous pinch` | Prise | ungenaues Küchenmaß | Normalisierbar, aber nicht seriös in g oder ml umrechenbar. |
| `Dose`, `Dose(n)` | Dose | Gebinde | `Dose(n)` bedeutet je nach Zahl `Dose` oder `Dosen`; das Nettogewicht ist ohne Zusatz unbekannt. |
| `Glas` | Glas | Gebinde | Im Beispiel ist die Füllmenge separat als `(500 g)` angegeben. |
| `Pck.` | Packung | Gebinde | Abkürzung für Packung; Inhalt und Nettomenge sind produktspezifisch. |
| `Zweig(e)` | Zweig | produktspezifische Zählung | Klammern markieren den optionalen Pluralsuffix. |
| `Msp` | Messerspitze | ungenaues Küchenmaß | Wie Prise nicht belastbar in Masse oder Volumen umrechenbar. |
| `Stange` | Stange | produktspezifische Zählung | Im Beispiel für Lauch. Nicht mit `Stück` gleichsetzen. |
| `handful` | Handvoll | ungenaues Küchenmaß | Soll das LLM übersetzen; keine feste physikalische Größe. |

In den Beispielen nicht enthalten sind `kg`, `l`, `oz`, `lb`, `fl oz`, `cup`, `pint`, `quart` und `gallon`. Sie bleiben trotzdem für importierte Rezepte relevant. Unter der hier gesetzten Annahme übersetzt und konvertiert das LLM die englischen Formen bereits; der nachgelagerte Algorithmus muss sie daher nicht als primäre Eingabesprache behandeln, sollte sie aber als defensive Aliase kennen.

### Keine Einheiten, obwohl sie im Mengenfeld stehen

| Rohformen | Bedeutung | Gewünschte Behandlung |
| --- | --- | --- |
| `kleine`, `m.-große`, `small`, `medium`, `large` | Größenqualifizierer | Als Qualifier erhalten, nicht als Einheit rechnen. Die eigentliche Einheit ist meist `Stück`. |
| `generous` | Verstärkung eines ungenauen Maßes | Als Qualifier zu `Prise` erhalten. |
| `etwas`, `evtl.`, `nach Belieben` | unbestimmte oder optionale Menge | Nicht in eine Zahl erfinden; als qualitative Menge oder Hinweis erhalten. |
| leeres Mengenfeld, z. B. bei Salz oder Pfeffer | keine festgelegte Menge | Menge und Einheit bleiben leer. |
| `3-4`, `1/2`, `½` | Bereich oder Bruch | Vor der Einheitenlogik als Zahlstruktur behandeln. Ein Bereich darf nicht stillschweigend zu einem Einzelwert werden. |

### Zusammengesetzte Mengenangaben

Einige Zeilen enthalten mehr als eine Mengeninformation:

- `4 Schweinenackensteaks à 80 g`
- `4 Lachsfilets (à 150 g)`
- `1 Glas Schattenmorellen (500 g)`
- `2 Möhren – ca. 150 g`
- `1 Fenchelknolle (ca. 250 g)`

Hier dürfen `4 Stück` und `320 g` beziehungsweise `1 Glas` und `500 g` nicht als konkurrierende Einheiten missverstanden werden. Es sind eine Anzahl und eine Stück- oder Packungsgröße. Diese Beziehung geht im aktuellen Modell aus unabhängigen Mengenbestandteilen verloren.

## Entwurf für algorithmische Einheitenumrechnung

### 1. Erkennen, Normalisieren und Umrechnen trennen

Die Verarbeitung sollte aus drei getrennten Schritten bestehen:

1. **Erkennen:** Das LLM liest Rezept, Sprache, Produkt, Zahl, Einheit und Qualifier. Englische Begriffe werden bereits hier ins Deutsche beziehungsweise in metrische Einheiten übertragen.
2. **Normalisieren:** Deterministischer Anwendungscode ordnet Schreibvarianten einer kanonischen Einheit zu. Dabei findet noch keine physikalische Umrechnung statt.
3. **Umrechnen und Zusammenführen:** Nur kompatible, mathematisch definierte Einheiten werden in eine gemeinsame Basiseinheit gebracht und addiert.

Ein unbekannter Wert darf nicht verworfen werden. Er bleibt als bereinigte Rohform sichtbar und wird nicht automatisch mit anderen Mengen vereinigt.

### 2. Einheitenregister statt allgemeiner Wortstammerkennung

Deutsche Singular- und Pluralformen sollten nicht mit allgemeinen Regeln geraten werden. Ein explizites Register ist klein, nachvollziehbar und sicherer:

| ID | Dimension | Basiseinheit/Faktor | Eingabe-Aliase | Anzeige Singular | Anzeige Plural |
| --- | --- | --- | --- | --- | --- |
| `mass:g` | Masse | `g`, Faktor 1 | `g`, `gramm` | `g` | `g` |
| `mass:kg` | Masse | `g`, Faktor 1000 | `kg`, `kilogramm` | `kg` | `kg` |
| `volume:ml` | Volumen | `ml`, Faktor 1 | `ml`, `milliliter` | `ml` | `ml` |
| `volume:l` | Volumen | `ml`, Faktor 1000 | `l`, `liter` | `l` | `l` |
| `volume:tl` | Küchenvolumen | `ml`, Faktor 5 | `tl`, `teelöffel`, defensiv `tsp` | `TL` | `TL` |
| `volume:el` | Küchenvolumen | `ml`, Faktor 15 | `el`, `esslöffel`, defensiv `tbsp` | `EL` | `EL` |
| `count:piece` | Zählung | keine physikalische Basis | leer, `stück`, `stk.` | `Stück` | `Stück` |
| `count:can` | Gebinde | nur mit gleicher ID addierbar | `dose`, `dosen`, `dose(n)` | `Dose` | `Dosen` |
| `count:jar` | Gebinde | nur mit gleicher ID addierbar | `glas`, `gläser` | `Glas` | `Gläser` |
| `count:package` | Gebinde | nur mit gleicher ID addierbar | `pck.`, `pkg.`, `packung`, `packungen` | `Packung` | `Packungen` |
| `count:clove` | produktspezifische Zählung | nur mit gleicher ID addierbar | `zehe`, `zehen`, `zehe/n`, `zehe(n)` | `Zehe` | `Zehen` |
| `count:sprig` | produktspezifische Zählung | nur mit gleicher ID addierbar | `zweig`, `zweige`, `zweig(e)` | `Zweig` | `Zweige` |
| `count:bunch` | Gebinde | nur mit gleicher ID addierbar | `bund`, defensiv `bunch` | `Bund` | `Bund` |
| `approx:pinch` | ungenau | nicht umrechenbar | `prise`, `prisen`, `prise(n)`, defensiv `pinch` | `Prise` | `Prisen` |
| `approx:knife-tip` | ungenau | nicht umrechenbar | `msp`, `messerspitze` | `Msp` | `Msp` |

Das Register darf weitere Einheiten aufnehmen, ohne die Umrechnungslogik zu verändern. Wichtig ist die Trennung von kanonischer ID, physikalischer Dimension und sprachlicher Anzeige.

### 3. Redaktionelle Singular/Plural-Formen vor dem Aliasvergleich entfalten

Formen wie `Dose(n)`, `Zweig(e)`, `Tasse/n` und `Zehe/n` sollten nur im Einheitenfeld und nur registergestützt behandelt werden:

1. Unicode normalisieren, trimmen, Kleinschreibung und wiederholte Leerzeichen bereinigen.
2. Direkten Aliasvergleich versuchen.
3. Falls unbekannt, bekannte redaktionelle Endungen entfernen: `(n)`, `(e)`, `/n`.
4. Den dadurch entstandenen Stamm erneut ausschließlich im Einheitenregister suchen.
5. Bei weiterhin unbekannter Form die Rohform erhalten.

Es darf keine allgemeine Klammer- oder Slash-Bereinigung über Produktnamen laufen. `Tomate(n)` oder `Ei(er)` sind ein separates Problem der Produktnormalisierung.

Die Anzeige wird anschließend aus der kanonischen Einheit erzeugt. Bei exakt `1` wird die Singularform verwendet, sonst die im Register hinterlegte Pluralform:

- `1` + `count:can` → `1 Dose`
- `2` + `count:can` → `2 Dosen`
- `1` + `count:sprig` → `1 Zweig`
- `2` + `count:sprig` → `2 Zweige`
- `2` + `count:bunch` → `2 Bund`

Damit ist `Dose(n)` niemals die gespeicherte oder angezeigte Einheit.

### 4. Zahlen verlustfrei repräsentieren

Für automatische Rechnung sollten keine binären Fließkommazahlen verwendet werden. Dezimalzahlen und Umrechnungsfaktoren lassen sich als skalierte Ganzzahlen oder rationale Zahlen `(Zähler, Nenner)` abbilden. Das passt zur bereits vorhandenen Addition mit `BigInt`.

Zusätzlich braucht die Erkennung unterschiedliche Mengenarten:

- exakter Einzelwert, z. B. `1.5`
- Bruch, z. B. `1/2`, intern exakt `1/2`
- Bereich, z. B. `3-4`, intern `{ min: 3, max: 4 }`
- ungefährer Wert, z. B. `ca. 150 g`
- qualitative Menge, z. B. `etwas`

Nur exakte Einzelwerte dürfen ohne weitere Produktentscheidung automatisch addiert werden. Ein Bereich darf beispielsweise nicht ungefragt auf seinen Mittelwert reduziert werden.

### 5. Nur innerhalb kompatibler Dimensionen umrechnen

Automatisch sicher sind zunächst:

- `kg` ↔ `g`
- `l` ↔ `ml`
- `EL` ↔ `TL` ↔ `ml` mit den festgelegten Küchenkonventionen `1 EL = 15 ml` und `1 TL = 5 ml`

Der Algorithmus rechnet beide Operanden in die Basiseinheit der Dimension um, addiert dort exakt und wählt erst für die Anzeige wieder eine gut lesbare Einheit. Beispiel: `1 kg + 250 g` wird intern `1250 g` und kann als `1,25 kg` angezeigt werden.

Nicht automatisch umgerechnet werden:

- Masse ↔ Volumen ohne verlässliche, produktspezifische Dichte
- `Dose`, `Glas`, `Packung`, `Bund`, `Stange`, `Zehe` oder `Zweig` ↔ g/ml/Stück
- `Prise`, `Msp`, `Handvoll` ↔ physikalische Einheiten
- Gebinde untereinander, beispielsweise Dose ↔ Glas

Die bereits vom LLM vorgenommene Cup-zu-Gramm-Umrechnung für eine konkrete Zutat wird als metrischer Messwert übernommen. Der allgemeine Algorithmus versucht diese dichteabhängige Rechnung nicht ein zweites Mal.

### 6. Gebinde und Nettomenge als Beziehung modellieren

Für `1 Dose Tomaten (400 g)` reicht ein Paar aus Zahl und Einheit langfristig nicht aus. Sinnvoll wäre eine Struktur wie:

```ts
type Quantity = {
  amount: ExactAmount | RangeAmount | ApproximateAmount;
  unitId: string;
  qualifier?: string;
  packageContent?: {
    amount: ExactAmount;
    unitId: "mass:g" | "volume:ml";
  };
};
```

So kann die App `1 Dose (400 g)` anzeigen, ohne zu behaupten, jede Dose habe 400 g. Zwei identische `400-g`-Dosen könnten zu `2 Dosen (je 400 g)` zusammengefasst werden. Eine unbekannte Dose und eine `400-g`-Dose bleiben dagegen getrennt.

### 7. Empfohlene Einführungsreihenfolge

1. **Alias- und Flexionsnormalisierung:** Bestehende Schreibweisen wie `Dose(n)`, `Dosen`, `Pck.` oder `Zweig(e)` auf kanonische IDs bringen. Noch keine neue Umrechnung.
2. **Metrische Skalierung:** `kg/g` und `l/ml` beim Zusammenführen exakt umrechnen.
3. **Küchenvolumen:** `EL/TL/ml` nach festgelegter Konvention zusammenführen.
4. **Anzeigegrammatik:** Singular und Plural ausschließlich aus dem Register ableiten.
5. **Zusammengesetzte Mengen:** Stück- und Packungsgrößen im Datenmodell verknüpfen.
6. **Bereiche und ungefähre Mengen:** Erst danach Rechen- und Merge-Regeln für `3-4`, `ca.` und qualitative Angaben definieren.

Diese Reihenfolge liefert früh Nutzen, ohne unsichere Umrechnungen oder einen großen einmaligen Schemaumbau zu erzwingen.

### Chefkoch

|            |                                           |
| ---------- | ----------------------------------------- |
| 250 g      | Tomate(n)                                 |
| 1 m.-große | Zwiebel(n)                                |
| 1 Zehe/n   | Knoblauch                                 |
| 4 EL       | Olivenöl                                  |
| 100 g      | Erbsen, TK                                |
| 2 Prisen   | Salz und Pfeffer                          |
| 0.5 TL     | Kreuzkümmelpulver                         |
| 1 EL       | Minzegehackte                             |
| 1 EL       | Chilisauce                                |
| 0.5 TL     | Limettenschaleabgeriebene                 |
| 1 TL       | Limettensaft                              |
| 4 m.-große | Schweinenackensteak(s)à 80 g              |
|            |                                           |
| 4 m.-große | Ei(er)                                    |
| 4 m.-große | Kartoffel(n)                              |
| 1          | Gurke(n)                                  |
| 1 Bund     | Radieschen                                |
| 1 Bund     | Dill                                      |
| 3          | Frühlingszwiebel(n)                       |
| 150 g      | saure Sahne                               |
| 500 ml     | Buttermilch                               |
| 500 ml     | Mineralwassergekühlt                      |
| 1 TL       | Senf                                      |
| 1 TL       | Essig                                     |
| etwas      | Salz und Pfeffer                          |
|            |                                           |
| 1 m.-große | Zwiebel(n)                                |
| 1 TL       | Olivenöl                                  |
| 1 Tasse    | Naturreisoder Duftreis                    |
| 2 Tasse/n  | Gemüsebrüheoder Wasser                    |
| 1 Zehe/n   | Knoblauch                                 |
| 2 m.-große | Tomate(n)                                 |
| 2          | Lauchzwiebel(n)                           |
| 10         | Oliven, schwarzeentsteint                 |
| etwas      | Basilikumfrisches                         |
| evtl.      | Meersalz                                  |
|            |                                           |
| 400 g      | Paprikaschote(n), rote                    |
| 1 Bund     | Dill                                      |
| 200 g      | Bandnudeln                                |
|            | Salz und Pfeffer                          |
| 750 g      | Seelachsfilet(s)                          |
| 1 EL       | Mehl                                      |
| 2 EL       | Öl                                        |
| 1 EL       | Butter oder Margarine                     |
| 25 g       | Schmandoder saure Sahne                   |
| 100 ml     | Gemüsebrühe                               |
| 1 TL       | Zitronensaft                              |
|            |                                           |
| 4          | Putenschnitzel                            |
| 1          | Gemüsezwiebel(n)                          |
| 1          | Knoblauchzehe(n)                          |
| 1 kleine   | Zucchiniklein geschnittene                |
| 1 kleine   | Aubergine(n)klein geschnittene            |
| 1          | Paprikaschote(n)grüne, klein geschnittene |
| 1 Dose     | Tomate(n)gewürfelt                        |
| 250 ml     | Gemüsebrühe                               |
| 1 Prise(n) | Zuckergewürfelt                           |
|            | Rosmarin                                  |
|            | Oreganofrischer                           |
|            | Thymianfrischer                           |
|            | Salz und Pfefferfrischer                  |
|            | Currypulver                               |
|            | Öl                                        |
|            | Feta-Käsegewürfelter                      |



- 200 g frische Pfifferlinge
- 1 kleine Schalotte
- 1 Knoblauchzehe
- 0.5 Bund frische glatte Petersilie
- 250 g Spaghetti
- 3 EL Butter
- 50 ml trockener Weißwein
- 50 ml Gemüsebrühe
- 50 g Parmesan
- 1 Prise Salz
- 1 Prise frisch gemahlener schwarzer Pfeffer


### Guardian Feast

**400g day-old white bread** – sourdough, ciabatta or pane pugliese  
**4 tbsp olive oil  
Flaky sea salt and freshly ground black pepper  
2 garlic cloves**, peeled and finely sliced  
**500g ripe tomatoes**, sliced  
**1 small cucumber**, deseeded and chopped  
**2 tbsp sherry vinegar  
4 tbsp extra-virgin olive oil  
150g boquerones

**2 large courgettes  
3****-4 spring onions  
400g ripe** **tomatoes  
7 tbsp** **olive oil  
****1 small handful** **basil leaves**, ripped, plus extra for serving**1 pinch** **dried oregano****1/2 small** **garlic clove**, peeled and finely minced **Salt  
450g** **linguine, spaghetti, pici, farfalle or radiatori**

For the salad  
**200g waxy potatoes** (ie, about 4 small ones)  
**100g carrots** (ie, 1 medium one)  
**100g turnip** (about ½ medium one, or 2 extra potatoes, if you prefer)  
**Salt**  
**50g green beans  
2 eggs** (optional)  
**75g frozen peas  
2 large gherkins**, plus 2 tbsp of their pickling liquid  
**1 tbsp capers**, rinsed if necessary  
**50g ham**, or pressed tongue or cooked chicken (optional, see step 9)  
**1 small bunch dill**, or chives, finely chopped

For the homemade mayonnaise (alternatively, use 3 tbsp ready-made)  
**1 egg  
2 tsp dijon mustard  
1 generous pinch salt  
1 tbsp white-wine vinegar**, or lemon juice  
**180ml groundnut oil**, or light olive or sunflower oil  
**25ml extra-virgin olive oil** (optional)

### Rewe

|            |                                    |
| ---------- | ---------------------------------- |
| 4          | Lachsfilets (à 150 g) tiefgefroren |
| 250 ml     | Sahne                              |
| 250 ml     | Milch                              |
|            | Salz                               |
|            | Pfeffer                            |
| 1 Prise(n) | Muskatnuss                         |
| 2 Zweig(e) | Rosmarin                           |
| 2 Zweig(e) | Thymian                            |
| 2 Zehe(n)  | Knoblauch                          |
| 400 g      | Kartoffeln                         |
| 2 Zweig(e) | Petersilie                         |
| 2 Zweig(e) | Dill                               |
| 3 EL       | Olivenöl                           |
| 1          | Bio-Zitrone                        |
| 75 g       | Berkäse (gerieben)                 |
|            |                                    |
| 1          | rote Paprika                       |
| 2          | Schalotten                         |
| 1 Zehe(n)  | Knoblauch                          |
| 1          | Kartoffel                          |
| 100 g      | Chorizo                            |
| 1 EL       | Olivenöl                           |
| 2 EL       | Tomatenmark                        |
| 1 Dose(n)  | Kichererbsen                       |
| 1 Dose(n)  | geschälte Tomaten                  |
| 500 ml     | Gemüsebrühe                        |
| 30 g       | Basilikum                          |
|            | Salz                               |
|            | Pfeffer                            |
|            | Safran                             |
| 1 Prise(n) | Zucker                             |
|            |                                    |
| 4          | Bananen                            |
| 1 Glas     | Schattenmorellen (500 g)           |
| 3 TL       | Maisstärke                         |
| 1 Pck.     | Vanillinzucker                     |
| 1          | REWE Bio Zitrone                   |
| 1 Prise(n) | Zimt                               |
| 200 g      | REWE Bio + vegan Kokos Natur       |
| 2 EL       | Ahornsirup                         |
| 50 g       | Kokosraspeln                       |

### Emmi kocht einfach

- 800 g Kohlrabi mit Grün
- ▢ 600 g Kartoffeln - vorwiegend festkochend
- ▢ 1 kleine Zwiebeln - ca. 50 g
- ▢ 1 Knoblauchzehe
- ▢ 15 g glatte Petersilie

#### FÜR DIE SOßE

- ▢ 200 g Kräuterfrischkäse
- ▢ 150 g Sahne
- ▢ 150 ml Milch
- ▢ 1 EL Zitronensaft
- ▢ 1 TL Salz
- ▢ 1/2 TL Speisestärke
- ▢ 1 Msp Zucker
- ▢ 1 Msp Muskatnuss
- ▢ schwarzer Pfeffer aus der Mühle

#### AUßERDEM

- ▢ 150 g Emmentaler
- ▢ etwas Butter oder neutrales Pflanzenöl - für die Auflaufform


- 1 Liter Fischfond aus dem Glas
- ▢ 400 g Kartoffeln
- ▢ 400 g Rotbarschfilet, frisch - alternativ TK, aber aufgetaut
- ▢ 350 g Kabeljaufilet, frisch - alternativ TK, aber aufgetaut
- ▢ 300 g TK-Meeresfrüchte - aufgetaut
- ▢ 250 ml trockener Weißwein
- ▢ 3 frische Tomaten
- ▢ 3 Knoblauchzehen
- ▢ 2 Möhren - ca. 150 g
- ▢ 1 Fenchelknolle (ca. 250 g) - alternativ 1 EL Fenchelsamen
- ▢ 1 Stange Lauch
- ▢ 1 Zwiebel
- ▢ 2 EL Olivenöl
- ▢ 2 EL Tomatenmark
- ▢ 8 Safranfäden
- ▢ 2 Lorbeerblätter
- ▢ 1 Sternanis
- ▢ 1 TL Salz
- ▢ 1 TL Paprika, edelsüß
- ▢ 1 Prise Cayennepfeffer
- ▢ 1 Prise schwarzer Pfeffer aus der Mühle
- ▢ 1 Prise Zucker
- ▢ 1 Orange, unbehandelt

#### AUSSERDEM

- ▢ 1 Bund glatte Petersilie
- ▢ Meersalz
- ▢ Baguette und etwas Rouille oder Mayonnaise - nach Belieben
