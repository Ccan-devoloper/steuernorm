# steuernorm — Layout, UI und UX

Analysegrundlage: `index.html` im Stand vom 29. Juli 2026, betrachtet an
`#/solzg/1` und `#/estg/15` (lange, tief gegliederte Norm).

---

## Vorweg: was gut ist

Damit die Kritik nicht falsch gewichtet wird — die Grundlagen stimmen, und einige
Entscheidungen sind besser als bei kommerziellen Angeboten:

- **Die Farbwelt.** Papierton `#FCFCFA`, Tinte `#17181A`, gedeckte Linien. Kein reines
  Weiß, kein reines Schwarz. Das ist eine bewusste Lesetypografie-Entscheidung und trägt.
- **Der Schriftmix.** Serife für den Normtext, Monospace für Metadaten und Kapitälchen-
  Zeilen, serifenlos für die Bedienung. Sauber getrennt und konsequent durchgehalten.
- **Kein Framework.** Eine Datei, schnell, wartbar, läuft in fünf Jahren noch.
- **`prefers-reduced-motion`** wird respektiert, `:focus-visible` ist gesetzt.
- **Der Rechtshinweis im Fuß** ist korrekt und an der richtigen Stelle.

Was folgt, sind keine Grundsatzfragen, sondern acht konkrete Stellen.

---

## Befund 1 — Die Lesespalte ist zu breit, und sie wird eingequetscht

```css
.huelle { max-width: 1500px; display: flex }
nav.register { width: 270px }
main { flex: 1; padding: 34px 32px 90px }
aside.schema { width: 350px }
.text { max-width: 44rem; font-size: 17px; line-height: 1.78 }
```

44 rem bei 17 px sind rund 700 px, also **etwa 90 bis 100 Zeichen je Zeile**. Für
Lesetypografie gilt 60 bis 75 Zeichen als Optimum; bei juristischem Text mit langen
Komposita und Klammerzusätzen eher das untere Ende. Bei 90 Zeichen verliert das Auge beim
Zeilenrücksprung die Spur — und zwar genau bei Schachtelsätzen, also überall im Steuerrecht.

Gleichzeitig bleiben bei 1 500 px Gesamtbreite abzüglich 270 + 350 + Ränder nur noch rund
780 px für `main`. Die Spalte ist also gleichzeitig zu breit zum Lesen und zu schmal für
das Layout, das um sie herum steht.

**Empfehlung:** `.text` auf `max-width: 34rem` bei 17 px (rund 68 Zeichen), Zeilenhöhe auf
1,72. Die Hülle darf breiter werden — 1 600 px —, weil die Lesespalte nicht mehr mitwächst.
Der gewonnene Platz geht an den Rand für Randnotizen (siehe Befund 2).

---

## Befund 2 — Schema und Text wissen nichts voneinander

Das ist die größte verschenkte Gelegenheit, und die Daten dafür liegen bereits vor.

Seit Format 3 trägt jeder Schemapunkt ein `pfad`-Feld, und jede Markierung trägt `von` und
`laenge`. Trotzdem stehen Schema und Text als zwei getrennte Spalten nebeneinander, ohne
jede Verbindung. Der Leser muss selbst herausfinden, welcher Schemaschritt zu welcher
Textstelle gehört — bei § 3 SolzG mit vier Stufen und zwölf Unterpunkten ist das mühsam.

### Referenz: Randnotizen statt Seitenspalte

Das etablierte Muster für „Kommentar neben Text" sind **Sidenotes** — Randnotizen, die auf
Höhe der Stelle stehen, auf die sie sich beziehen. Edward Tufte hat das in seinen Büchern
kanonisiert, Tufte CSS hat es fürs Web übersetzt, und gwern.net führt eine ausführliche
Untersuchung der Varianten. Der entscheidende Vorteil gegenüber einer Sidebar: **vertikale
Kopplung**. Die Notiz steht dort, wo der Blick ohnehin ist.

Für Sie heißt das nicht zwingend, das Schema komplett an den Rand zu verlagern. Der kleine
Eingriff mit der größten Wirkung ist:

**Beim Überfahren eines Schemaschritts leuchtet die zugehörige Textstelle auf — und
umgekehrt.**

```js
// Beim Aufbau des Schemas
li.dataset.pfad = x.pfad;
li.onmouseenter = () => hervorheben(x.pfad);
li.onmouseleave = () => hervorheben(null);
li.onclick = () => document.querySelector(`mark[data-pfad="${CSS.escape(x.pfad)}"]`)
                          ?.scrollIntoView({ block: "center", behavior: "smooth" });

// Beim Anlegen der Markierungen: mark.dataset.pfad = sp.pfad;

function hervorheben(pfad){
  document.body.classList.toggle("fokus", Boolean(pfad));
  for (const m of document.querySelectorAll("mark")) {
    m.classList.toggle("hell", Boolean(pfad) && m.dataset.pfad === pfad);
  }
}
```

```css
body.fokus mark { opacity: .35; transition: opacity .12s }
body.fokus mark.hell { opacity: 1; box-shadow: 0 0 0 3px var(--tb) }
```

Fünfzehn Zeilen, und aus zwei nebeneinanderstehenden Listen wird ein zusammenhängendes
Werkzeug. Zusätzlich sollte der `pfad` im Schema klickbar sein und im Text den Absatz
ansteuern — Sie haben mit `Abs. 3 Satz 1 Nr. 2` bereits zitierfähige Adressen, nutzen sie
aber nur als graue Beschriftung.

---

## Befund 3 — Drei Markierungsfarben sind auf dichtem Normtext zu viel

Mit Tatbestand (gelb), Rechtsfolge (grün), Ausnahme (rot) und dem gestrichelten
`unsicher`-Zustand kann eine Norm wie § 15 EStG zu einem Flickenteppich werden. Bei
1 000 Wörtern und 30 Spannen ist praktisch jeder Satz eingefärbt — und eine Markierung,
die überall ist, markiert nichts mehr.

Drei Möglichkeiten, aufsteigend nach Aufwand:

**a) Flächen durch Kanten ersetzen.** Statt Hintergrundfarbe eine 2 px starke Unterlinie in
der Kantenfarbe. Der Text bleibt auf Papier, die Struktur wird trotzdem sichtbar. Für
Ausnahmen eine gepunktete Linie.

```css
mark.tb { background: transparent; border-bottom: 2px solid var(--tb-kante) }
mark.rf { background: transparent; border-bottom: 2px solid var(--rf-kante) }
mark.ausn { background: transparent; border-bottom: 2px dotted var(--ausn-kante) }
body[data-intensitaet=flaeche] mark.tb { background: var(--tb) }
```

**b) Ein Intensitätsregler** statt drei Ein/Aus-Schaltern: *aus · dezent · voll*. Ein
Bedienelement statt drei, und der Normalzustand ist ruhig.

**c) Standardmäßig aus.** Die Seite heißt „Textausgabe der Steuergesetze". Der erste
Eindruck sollte der Gesetzestext sein, sauber gesetzt. Die Markierung ist die Zutat und
darf einen Klick kosten. Das ist zugleich die ehrlichste Voreinstellung, solange die
Precision bei 0,7 liegt.

Ich würde a) und b) kombinieren und c) zumindest ausprobieren.

---

## Befund 4 — Lange Normen haben keine Binnennavigation

§ 3 SolzG hat sieben Absätze, § 15 EStG deren neun mit tiefer Untergliederung, § 4 UStG
einen Katalog mit 29 Nummern. Es gibt keinen Weg, innerhalb einer Norm zu springen, und
keinen Hinweis darauf, wie lang sie ist.

### Referenz: legislation.gov.uk

Der britische Gesetzesdienst ist in dieser Hinsicht der Maßstab. Jede Section hat einen
eigenen Anker und einen Permalink, es gibt eine ausklappbare Gliederung, und — das ist die
eigentliche Stärke — einen Zeitschieber „Changes over time", mit dem man jede Fassung
seit 1991 aufrufen kann. Beides zusammen macht ein Gesetz navigierbar statt nur lesbar.

**Empfehlung:** eine schmale Absatzleiste am linken Rand der Lesespalte, aus den
`saetze[].pfad`-Werten erzeugt, die beim Scrollen mitläuft:

```
(1) ────
(2) ────
(3) ████     ← aktuell im Blick
(4) ────
(4a)────
(5) ────
```

Klein, unaufdringlich, klickbar. Sie haben die Daten dafür bereits im Annotationsformat.

Und den Permalink: `#/solzg/3/abs-3-satz-1` sollte funktionieren und beim Aufruf die
Stelle ansteuern. Für ein Werkzeug, mit dem man arbeitet, ist Zitierfähigkeit kein Extra.

---

## Befund 5 — Das Statusband steht an der falschen Stelle

Aktuell erscheint es **nach** dem Normtext, zwischen Fußnote und Schema. Es qualifiziert
aber alles, was darüber steht. Wer nur den oberen Teil einer langen Norm liest, sieht nie,
dass die Markierungen automatisch erzeugt und ungeprüft sind.

**Empfehlung:** direkt unter den Normkopf, als schmale Zeile in der Höhe der
Standangabe — nicht als Kasten, sondern als weitere Metadatenzeile:

```
§ 2  Abgabepflicht
Stand: zuletzt geändert durch Art. 4 G v. 23.12.2024 · amtliche Fassung ↗
Markierung: nur Syntaxanalyse · automatisch, nicht redaktionell geprüft
```

Damit steht die Einschränkung dort, wo sie gelesen wird, und sie wirkt nicht wie eine
Warnung, sondern wie eine Herkunftsangabe — was sie ja auch ist.

---

## Befund 6 — Die Suche wird der Datenmenge nicht gerecht

Ein einzelnes Feld für 1 532 Normen in 14 Gesetzen, ohne Eingrenzung und ohne Vorschau des
Fundstellenkontexts. Für „§ 15" bekommt man Treffer in EStG, KStG, UStG, AO — ohne zu
sehen, welcher gemeint sein könnte.

**Empfehlung, gestaffelt:**

- Eingabe erkennen: `15 estg`, `§ 15 EStG`, `estg 15` und `Wohnsitz` sollten alle
  funktionieren. Ein kurzer Parser für „Zahl + Gesetzeskürzel" fängt achtzig Prozent ab.
- Bei Volltexttreffern **den Fundstellenkontext zeigen** — die zwei Zeilen um den Treffer,
  Suchwort hervorgehoben. Ohne das ist eine Trefferliste aus Paragrafennummern wertlos.
- Treffer nach Gesetz gruppieren, mit Zähler.
- Tastatur: `/` fokussiert die Suche, Pfeiltasten wählen, Enter springt. Für ein Werkzeug,
  das man täglich benutzt, spart das mehr Zeit als jede andere Maßnahme hier.

### Referenz: das neue Bundesportal

Das Rechtsinformationsportal des Bundes (NeuRIS, in der Testphase) ist die Messlatte, an
der Sie in zwei Jahren gemessen werden. <cite index="3-1">Es führt Gesetze, Verordnungen, Gerichtsentscheidungen und Verwaltungsvorschriften zusammen und bietet eine Suche, die sowohl für gezielte Anfragen als auch für die Volltextsuche geeignet ist, dazu XML-Ansichten und eine API.</cite> Schauen Sie sich an, wie dort
Trefferlisten aufgebaut sind — und differenzieren Sie sich dort, wo Sie stark sind: bei
der Struktur innerhalb der Norm, die das Portal nicht bietet.

---

## Befund 7 — Kein Dunkelmodus, keine Schriftgrößensteuerung

Für ein Werkzeug, das für lange Lesesitzungen gedacht ist, fehlen zwei Selbstverständ­lich­keiten.

Der Dunkelmodus ist bei Ihrer Struktur beinahe geschenkt, weil alles über Variablen läuft:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-thema=hell]) {
    --papier:#15161A; --tinte:#E8E6E1; --gedeckt:#A8ABA4; --leise:#75786F;
    --linie:#2A2C31; --linie-stark:#3D4046; --feld:#1E2025;
    --tb:#4A3F14; --tb-kante:#C7A93A; --rf:#1E3A28; --rf-kante:#5FA97A;
    --ausn:#3D2620; --ausn-kante:#C07A62;
  }
}
```

Wichtig dabei: Markierungsfarben nicht einfach abdunkeln, sondern neu wählen — gelbe
Flächen auf dunklem Grund blenden. Testen Sie den Kontrast des Normtexts auf mindestens
7:1 (WCAG AAA), das ist bei einem Lesewerkzeug angemessen.

Dazu drei Schriftgrößen (klein/mittel/groß) über `--basis`, im Browser gespeichert.
Sie haben mit `gemerkt()` bereits einen Mechanismus dafür.

---

## Befund 8 — Mobil verschwindet die halbe Funktion

```css
@media (max-width:1180px){ aside.schema { display:none } }
@media (max-width:860px) { nav.register { position:fixed; … } }
```

Zwischen 860 und 1 180 px ist das Schema weg und das Register da; darunter ist das Register
hinter dem Burger. Es gibt zwar `schema-unten` als Ersatz, aber die Gesetzesleiste mit
14 waagerecht scrollenden Reitern bleibt auf dem Telefon eine Zumutung.

**Empfehlung:**

- Gesetzesleiste unter 860 px durch ein Auswahlfeld ersetzen. Vierzehn Einträge sind eine
  klassische Liste, kein Scrollband.
- Das Schema mobil als aufklappbaren Abschnitt **über** dem Normtext, nicht darunter —
  wer ein Prüfungsschema sucht, sucht es zuerst.
- Eine untere Leiste mit den drei Markierungsschaltern, damit man beim Lesen umschalten
  kann, ohne nach oben zu scrollen.
- Die 44 rem Lesespalte greift mobil ohnehin nicht; prüfen Sie den Seitenrand von 18 px —
  bei 17 px Serifenschrift wirken 20 bis 24 px ruhiger.

---

## Zusammengefasst, nach Wirkung geordnet

| # | Maßnahme | Aufwand | Wirkung |
|---|---|---|---|
| 1 | Schema ↔ Text koppeln (Hover, Klick, Sprung) | 1 Std | größter Einzelgewinn, Daten liegen vor |
| 2 | Lesespalte auf 34 rem | 5 Min | Lesbarkeit |
| 3 | Statusband unter den Normkopf | 15 Min | Ehrlichkeit an der richtigen Stelle |
| 4 | Markierung: Kanten statt Flächen, Intensitätsregler | 2 Std | Normtext bleibt lesbar |
| 5 | Absatzleiste und Anker-Permalinks | ½ Tag | Navigierbarkeit langer Normen |
| 6 | Suche: Parser, Kontext, Tastatur | 1 Tag | tägliche Nutzung |
| 7 | Dunkelmodus und Schriftgröße | 2 Std | Lesesitzungen |
| 8 | Mobiles Layout überarbeiten | ½ Tag | halbe Nutzerschaft |

Punkt 1 zuerst. Er kostet eine Stunde, braucht keine neuen Daten und verwandelt zwei
nebeneinanderstehende Listen in ein Werkzeug.

---

## Referenzen zum Ansehen

- **legislation.gov.uk** — Maßstab für Gliederung, Section-Permalinks und den Zeitschieber
  „Changes over time". Ansehen: eine beliebige Section eines längeren Gesetzes.
- **dejure.org** — das Fundstellenmodell: Rechtsprechung und Querverweise neben dem
  Paragrafen, ohne jede Behauptung über den Inhalt. Genau das, was Ihre Belegschicht
  werden sollte.
- **testphase.rechtsinformationen.bund.de** — das kommende Bundesportal, Ihre künftige
  Vergleichsgröße.
- **Tufte CSS** und die Untersuchung zu Sidenotes auf **gwern.net** — das Muster für
  Randnotizen mit vertikaler Kopplung.
- **Hypothes.is** — wie Textanker über Änderungen hinweg stabil gehalten werden; Ihr
  `von`/`laenge`-Modell mit Textrückfall folgt bereits demselben Gedanken.

---

*Die Gestaltungsvorschläge sind Empfehlungen, keine Regeln. Prüfen Sie insbesondere die
Kontrastwerte des Dunkelmodus mit einem Werkzeug, statt sie zu schätzen.*
