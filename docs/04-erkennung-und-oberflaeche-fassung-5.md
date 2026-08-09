# Fassung 5 — Erkennung und Oberfläche

Zwei Befunde standen am Anfang: Tatbestand, Rechtsfolge und Ausnahme wurden
nicht gut genug erkannt, und die Oberfläche blieb hinter dem zurück, was
vergleichbare Angebote leisten. Beides ist gemessen worden, bevor etwas geändert
wurde, und danach noch einmal.

---

## 1. Was gemessen wurde

Ein Lauf über den gesamten Bestand (14 Gesetze, 1 537 Normen, 16 709
Rechtssätze) vor und nach dem Umbau. Kein Modellaufruf, reine Syntaxanalyse in
beiden Fällen — die Zahlen sind also unmittelbar vergleichbar.

| Größe | Fassung 4 | Fassung 5 | |
|---|---:|---:|---|
| Spannen insgesamt | 23 570 | 27 267 | **+16 %** |
| davon Tatbestand | 12 296 | 13 903 | +13 % |
| davon Rechtsfolge | 10 183 | 12 585 | +24 % |
| Rechtssätze ohne jede Zerlegung | 2 576 | 402 | **−84 %** |
| Kategorien auf denselben Zeichen | 467 | 7 | **−98 %** |
| Normen ganz ohne Markierung | 123 | 106 | −14 % |

Die Zahl der Ausnahmen ist von 866 auf 568 **gefallen**. Das ist beabsichtigt:
Der alte Bestand bestand zu großen Teilen aus Signalwörtern ohne Inhalt und aus
Vorrangregeln, die keine Ausnahmen sind. Dazu unten mehr.

---

## 2. Der Verbfinder war eine Liste

`syntax.mjs` erkannte finite Verben über eine Aufzählung von rund sechzig
Formen. Das Deutsche bildet finite Formen produktiv; eine Liste kann das nicht
einholen. 2 576 Rechtssätze — 15 % des Bestands — fielen deshalb in die
Auffangregel „Kein finites Verb erkannt", wurden also gar nicht zerlegt, sondern
als ein einziger Block markiert. Darunter Alltagsfälle:

```
Die Finanzbehörde BEDIENT sich der Beweismittel …
Die Buchführungspflicht GEHT auf denjenigen über …
FEHLT eine gemeinsame Aufsichtsbehörde, so TREFFEN die Behörden …
Schuldenverwaltungen … FALLEN nicht unter diese Vorschrift.
```

`tools/lib/verben.mjs` entscheidet stattdessen morphologisch: geschlossene
Klassen für Hilfs-, Modal- und unregelmäßige Verben, dazu Endungsmuster für
Präsens und Präteritum. Die Formprüfung allein genügt nicht, weil attributive
Adjektive dieselben Endungen tragen wie finite Pluralformen. Entschieden wird
deshalb aus der Umgebung:

- **Großschreibung.** Außerhalb des Satzanfangs ist ein großgeschriebenes Wort
  ein Substantiv. Am Satzanfang ist die Regel wertlos, dort gelten nur die
  geschlossenen Klassen — sonst wäre „Vermögen und Einkünfte … werden
  zugerechnet" mit „Vermögen" als Verb gelesen worden.
- **Attributprobe.** „die fachlich ZUSTÄNDIGEN Aufsichtsbehörden" — ein Attribut
  steht in einer Nominalphrase und wird von einem Substantiv gefolgt. „so
  TREFFEN die Aufsichtsbehörden" — auf ein Verb folgt ein Determinierer.
- **Verbklammer statt ge-Präfix.** „genügt", „gewährt", „gestattet" sehen aus
  wie Partizipien. Ein Partizip setzt aber ein voranstehendes Hilfsverb voraus,
  das die Klammer öffnet. Fehlt eines, ist die ge-Form das finite Verb.

Drei Fehler kamen bei der Umstellung ans Licht und sind behoben:

1. **Maskierung erzeugte Klebewörter.** Nebensätze wurden durch Nullbytes
   ersetzt — die sind selbst keine Leerzeichen. „bestimmt, ob …" ergab das
   Einzeltoken `bestimmt\0\0…`, das die Prüfung nie erreichte. Damit war jedes
   finite Verb unmittelbar vor einem Nebensatz unsichtbar.
2. **„zu" sperrte zu viel.** Die Regel gegen Infinitive („zu erheben") traf auch
   die abgetrennte Verbpartikel: In „… Mittel einer Körperschaft ZU, darf sie …"
   wurde „darf" verworfen.
3. **Verberststellung am Satzanfang.** „Wendet eine Körperschaft … zu, darf sie
   …" — bei Verberststellung folgt dem Verb sein Subjekt. Nur dann wird eine
   produktiv gebildete Form an erster Stelle als Verb gelesen.

---

## 3. Ausnahmen: dreimal falsch

`tools/lib/ausnahmen.mjs` ersetzt einen einzelnen regulären Ausdruck mit einem
`exec`-Aufruf.

**Nur die erste Ausnahme je Rechtssatz.** `AUSNAHME.exec(satz)` ohne Schleife.
Ein Satz mit Ausnahme und Rückausnahme lieferte eine.

**Die Grenzen waren falsch.** Die Spanne lief vom letzten Komma vor dem Signal
bis zum nächsten Komma. Bei „es sei denn, dass X" ist das nächste Komma genau
das nach „denn" — übrig blieb das nackte Signalwort. Unter den häufigsten
Ausnahmen des alten Bestands standen deshalb:

```
19×  „ist nicht anzuwenden"
17×  „Abweichend von Satz 1"
 7×  „ausgenommen"
 5×  „entfällt"
```

Keine davon nennt, wovon etwas ausgenommen ist.

**Vorrangregeln galten als Ausnahmen.** „unbeschadet", „vorbehaltlich",
„ungeachtet" ordnen ein Konkurrenzverhältnis zwischen zwei Normen; sie nehmen
nichts aus dem Tatbestand heraus. Sie lagen deshalb regelmäßig mitten in der
Rechtsfolge und erzeugten den Großteil der 467 Überlappungen.

Die neue Fassung unterscheidet drei Bauformen und hält die Vorrangregel davon
getrennt:

| Bauform | Beispiel | Grenze |
|---|---|---|
| **Bedingungsausnahme** | „…, es sei denn, dass der Erwerber die Anzeige erstattet" | bis Satzende oder Semikolon |
| **Bereichsausnahme** | „Für die Umsatzsteuer mit Ausnahme der Einfuhrumsatzsteuer" | Ende der Nominalphrase, spätestens am finiten Verb |
| **Satzausnahme** | „Dies gilt nicht, wenn …", „Satz 1 ist nicht anzuwenden, soweit …" | der ganze Rechtssatz |
| **Rückausnahme** | „…; Satz 1 gilt jedoch, wenn …" | eigene Klausel |

Eine Spanne, die nach Abzug des Signals keinen Inhalt trägt, wird verworfen.
„Abweichend von Absatz 1" erzeugt gar keine Spanne mehr: Die Wendung ist ein
reiner Verweis; dass der Satz eine Sonderregel aufstellt, ist eine Eigenschaft
des Satzes, keine Textstelle.

---

## 4. Entflechtung: eine Kategorie je Zeichen

467 Spannen trugen zwei Kategorien auf denselben Zeichen. Das Frontend verodert
die Klassen zu `mark.tb.rf` und zeichnete einen Farbverlauf, der nichts bedeutet.

Nach der Analyse läuft jetzt ein Entflechtungsschritt. Er verortet jede Spanne im
Rechtssatz und vergibt die Zeichen nach Rangfolge:

```
Ausnahme  >  Begriff  >  Tatbestand  >  Rechtsfolge
```

Eine Ausnahme ist immer aus einer Regel herausgeschnitten und gewinnt gegen
beide Regelkategorien; ein Tatbestand ist enger gefasst als eine Rechtsfolge, die
im Regelfall der gesamte Resttext ab dem finiten Verb ist. Die unterlegene Spanne
behält ihre Reststücke:

```
Für die Umsatzsteuer mit Ausnahme der Einfuhrumsatzsteuer ist das Finanzamt zuständig
└─ tb ─────────────┘└─ ausn ──────────────────────────┘└─ rf ───────────────────────┘
```

Reststücke, die nur noch aus einer Fundstellenangabe bestehen („Satz 1"), fallen
weg; kurze, aber vollständige Anordnungen („ist zulässig", „entsteht nicht")
bleiben.

Übrig sind 7 Überlappungen im gesamten Bestand.

---

## 5. Aufzählungen haben kein Prädikat

1 937 der 2 576 unzerlegten Rechtssätze waren Nummern und Buchstaben einer
Aufzählung. Sie sind elliptisch — ihr Prädikat steht im Einleitungssatz:

```
Steuerliche Nebenleistungen sind:
  1. Verspätungszuschläge nach § 152
  2. Zuschläge nach § 162 Absatz 4
```

Das Glied „Verspätungszuschläge nach § 152" hat kein Verb und kann keines haben.
Die Auffangregel markierte es richtig als Tatbestand, begründete das aber mit
„Kein finites Verb erkannt" — eine Fehlanzeige statt einer Aussage. Aufzählungs­
glieder haben jetzt einen eigenen Zweig: Sie erhalten ihre Rolle aus dem
Einleitungssatz (Anordnung → Rechtsfolgenvariante, sonst Merkmalsvariante) und
eine Begründung, die den Sachverhalt trifft.

Übrig bleiben 402 Rechtssätze ohne Zerlegung. Ein Teil davon sind Bruchstücke
aus der Satztrennung und Einträge wie „(weggefallen)".

---

## 6. Oberfläche

### Behobene Fehler

- **Das Statusband hatte keine einzige CSS-Regel.** Das Skript erzeugte es, die
  Plakette („Nur Syntaxanalyse", „Modellkonsens") erschien als unformatierter
  Fließtext unter der Überschrift. Es qualifiziert alles, was darunter steht.
- **Die Kopfleiste blieb im Dunkelmodus hell.** Ihr Hintergrund war als fester
  Wert `rgba(252,252,250,.96)` notiert. Dasselbe galt für die gedrückten
  Schalter und den Codehintergrund im Fehlerkasten. Alle drei hängen jetzt an
  den Farbtoken `--schleier` und `--erhaben`.
- **Überschrift und Normtext standen versetzt.** Die Lesespalte klebte am linken
  Rand, und die Bausteine wurden auf verschieden breite Kisten zentriert.
  Zentriert wird jetzt einheitlich auf Lesespalte plus Absatzleiste.
- **Die Absatznummer stand doppelt** — einmal in der Absatzleiste, einmal als
  hängender Einzug daneben.
- **Auf schmalen Fenstern liefen beide Schalterreihen aus dem Bild.**

### Neue Funktionen

- **Eigene Markierungen und Notizen.** Textstelle auswählen, markieren oder
  kommentieren. Gespeichert wird nicht die Zeichenposition, sondern der Wortlaut
  mit vierzig Zeichen Umgebung; die Stelle wird beim Anzeigen neu gesucht. Eine
  Gesetzesänderung verschiebt die Notiz deshalb nicht ins Leere — findet sie
  ihre Stelle nicht mehr, erscheint sie in der Notizenliste mit Hinweis.
  Alles bleibt im Browser; Sicherung und Rückspielung als Datei.
- **Gesetzesübergreifende Suche.** Bisher durchsuchte die Suche nur das geladene
  Gesetz. Wer „Vorsteuer" sucht, weiß in aller Regel nicht, in welchem der
  vierzehn Gesetze die Stelle steht.
- **„Zitiert von".** Verweise gingen nur vorwärts. `tools/verweise.mjs` berechnet
  die Gegenrichtung — 8 161 Verweise auf 1 189 Normen, aufgelöst einschließlich
  Spannen wie „§§ 82 bis 84".
- **Zitat und Permalink kopieren.** Fundstelle mit Fassungsangabe und Link.
- **Druckansicht.** Ohne Navigation, Markierungen als Kanten statt Flächen
  (Flächen verschwimmen im Graustufendruck), Verweise mit ausgeschriebenem Ziel.

---

## 7. Was weiterhin gilt

Nichts davon sichert die juristische Richtigkeit. Die Erkennung ist genauer und
in sich widerspruchsfreier geworden, sie bleibt ein automatisches Verfahren ohne
redaktionelle Durchsicht. Es gibt weiterhin keine unabhängige Messung gegen
einen von Menschen erstellten Maßstab; die Zahlen oben messen Vollständigkeit und
Widerspruchsfreiheit, nicht Wahrheit. Der Weg zu einer echten Messung steht
unverändert in `03-richtigkeit-und-grenzen.md`, Abschnitt 6.4.

Maßgeblich ist allein der im Bundesgesetzblatt verkündete Wortlaut.
