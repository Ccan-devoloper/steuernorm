# Was die Richtigkeit tatsächlich sichert — und was nicht

Kurzantwort vorweg, weil sie unbequem ist:

> **Nichts im System stellt sicher, dass Tatbestand, Rechtsfolge und Ausnahme richtig
> erkannt sind.** Was es gibt, sind harte Garantien über die *Form* einer Markierung,
> starke Wahrscheinlichkeitsaussagen über ihre *Kategorie* und — für etwa die Hälfte der
> Normen — eine Anbindung an eine amtliche Quelle. Richtigkeit im juristischen Sinn ist
> davon keines.

Das ist keine Schwäche der Umsetzung, sondern eine Folge der Ausgangslage: Sie wollten
ohne eigene Prüfung auskommen. Dann kann kein Verfahren mehr behaupten, richtig zu sein —
es kann nur noch angeben, wie es zu seinem Ergebnis gekommen ist. Genau das tut das
System, und genau das steht im Statusband.

Im Folgenden zerlege ich, was jede Ebene leistet, wo die Löcher sind, und was sich noch
schließen lässt, ohne dass Sie eine Norm von Hand lesen.

---

## 1. Der tatsächliche Weg einer Spanne

Nehmen wir § 2 SolzG, „Abgabepflichtig sind 1. natürliche Personen …". So sieht die
Spanne heute nach dem Durchlauf aus:

```
§2  status: syntaktisch | konfidenz: 0.547 | belegquote: 0 | markierbar: true
   rf   k=0.45  stimmen=0/0  syntax=true  gegenprobe=null  beleg=nein
   tb   k=0.60  stimmen=0/0  syntax=true  gegenprobe=null  beleg=nein
   tb   k=0.60  stimmen=0/0  syntax=true  gegenprobe=null  beleg=nein
   tb   k=0.54  stimmen=0/0  syntax=true  gegenprobe=null  beleg=nein
```

Lesen Sie die Zeile genau: `stimmen=0/0`, `gegenprobe=null`, `beleg=nein`. **Von den drei
Mechanismen, die Richtigkeit stützen sollen, ist derzeit keiner aktiv.** Übrig bleiben
Syntaxanalyse und Validatoren. Das Ergebnis ist zufällig richtig — § 2 ist inzwischen
korrekt zerlegt —, aber es ist nicht *abgesichert*, sondern nur *plausibel erzeugt*.

Sobald der Modelllauf greift, füllen sich die Felder. Was sie dann aussagen, steht unten.

---

## 2. Die fünf Ebenen und was sie je garantieren

| Ebene | Garantiert | Garantiert **nicht** | Automatisch prüfbar? |
|---|---|---|---|
| **Gliederung** | Spanne liegt in genau einem Rechtssatz; Adresse `Abs. 3 Satz 1 Nr. 2` stimmt; keine Fragmente aus Datums- oder Aufzählungstrennung | nichts über die Kategorie | **ja**, `pruefen.mjs` |
| **Syntax** | reproduzierbare Zerlegung nach Satzgliedstellung | nichts über die Kategorie | nein |
| **Validatoren** | keine Fundstelle, keine reine Zeitangabe, kein Normsubjekt, kein Fragment, ≤ 45 Wörter, wörtlich im Text | dass die Kategorie stimmt | **ja**, `pruefen.mjs` |
| **Mehrfachlauf** | Stabilität über drei Läufe und zwei Modelle | Richtigkeit — Modelle irren übereinstimmend | nur relativ |
| **Beleg** | die genannte Fundstelle existierte im vorgelegten Material | dass sie die Zuordnung trägt | teilweise |

Die ersten drei Ebenen sind **harte, überprüfbare Garantien** — aber ausschließlich über
die Form. Der aktuelle Lauf lehnt bei SolzG 15 Spannen ab:

```
  4  Fragment: beginnt mit Konjunktion oder finitem Verb
  4  Fragment: endet auf Artikel oder Präposition
  3  deckt praktisch den ganzen Rechtssatz ab
  2  Tarifnorm ohne konditionales Vorfeld — kein Tatbestandsmerkmal
  1  zu grob (71 Wörter)
  1  zu lang (>600 Zeichen)
```

Jede dieser Ablehnungen ist begründbar und wiederholbar. Keine sagt etwas darüber, ob die
verbleibenden Spannen der richtigen Kategorie zugeordnet sind.

---

## 3. Wo es weiterhin bricht

Drei Fehlerklassen kommen durch alle Ebenen hindurch.

### a) Übereinstimmender Irrtum

Drei Läufe über zwei Modelle sind keine drei unabhängigen Urteile. Beide Modelle sind auf
überlappenden Daten trainiert und teilen dieselben Vorlieben. Bei einer ungewöhnlichen
Konstruktion irren sie mit hoher Wahrscheinlichkeit *gleich*. Die Konfidenz steigt dann
auf 0,9 — und ist falsch. Einstimmigkeit misst Stabilität, nicht Wahrheit.

Das ist der Grund, warum die Syntaxanalyse als eigene Stimme zählt: Sie ist der einzige
Beteiligte mit einem *anderen* Fehlerprofil. Wo Syntax und Modell auseinandergehen, ist
das Signal wertvoller als jede Übereinstimmung — dazu unten mehr.

### b) Der Beleg trägt nicht

Der Validator in `konsens.mjs` prüft, ob die genannte Fundstelle **vorlag**:

```js
for (const b of belege.verwaltung || []) {
  const fund = normText(b.fundstelle).toLowerCase();
  if (fund === gesucht || fund.includes(gesucht)) return { … };
}
return null;   // erfundene Fundstelle
```

Erfundene Fundstellen sind damit ausgeschlossen. **Falsch zugeordnete nicht.** Das Modell
kann „AEAO zu § 8 Nr. 3" anführen für eine Spanne, zu der Nr. 3 nichts sagt. Die
Stanford-Untersuchung nennt genau das den zweiten Fehlertyp und hat ihn bei den
kommerziellen Werkzeugen häufiger gefunden als frei erfundene Zitate. Ich hatte das in
Version 4 offen gelassen; siehe Abschnitt 6.

### c) Die Grenze zwischen den Merkmalen

Die Syntax entscheidet, *wo* geschnitten wird, aber nicht, *was zusammengehört*.
§ 3 Abs. 3 SolzG nennt eine Freigrenze; dass es eine Freigrenze und kein Freibetrag ist,
steht nirgends im Wortlaut. Kein Satzgliedanalysator und kein Validator kann das
herausfinden. Nur die Verwaltungsanweisung oder die Rechtsprechung kann es — und für das
SolzG gibt es keine.

---

## 4. Das Prüfungsschema — was es wirklich ist

Hier muss ich am deutlichsten werden, weil der Name mehr verspricht als das Verfahren hält.

`baueSchema()` ist eine **Umsortierung der Elemente nach einer festen Regel**:

```
alle tb   → I.   Voraussetzungen   (mit Junktor „alternativ" oder „kumulativ")
alle ausn → II.  Ausnahmen
alle rf   → III. Rechtsfolge
```

Für § 2 SolzG ergibt das:

```
I.  Voraussetzungen (eine genügt)   alternativ
    1. natürliche Personen, die nach § 1 EStG einkommensteuerpflichtig sind   Nr. 1
    2. natürliche Personen, die nach § 2 AStG erweitert beschränkt …          Nr. 2
    3. Körperschaften, Personenvereinigungen und Vermögensmassen …            Nr. 3
II. Rechtsfolge
    1. Abgabepflichtig                                                        Satz 1
```

Das ist brauchbar. Es ist aber **kein Prüfungsschema im juristischen Sinn**, sondern eine
strukturierte Wiedergabe des Normaufbaus. Drei Unterschiede:

1. **Es endet an der Normgrenze.** Die Frage „Ist Solidaritätszuschlag festzusetzen und in
   welcher Höhe?" läuft §§ 2 → 3 → 4 → 1 Abs. 3. Ein Schema, das an einem § hängt, kann
   das nicht abbilden. Das bleibt der Vorschlag aus dem ersten Bericht: ein Verzeichnis
   `schemata/`, prüfungsfragenorientiert, von Hand oder aus den Verwaltungsanweisungen
   gewonnen.
2. **Die Reihenfolge ist gesetzt, nicht abgeleitet.** Voraussetzungen vor Ausnahmen vor
   Rechtsfolge ist eine vernünftige Voreinstellung, aber sie folgt nicht aus der Norm.
   Wo die Prüfungsreihenfolge doktrinär anders ist, ist das Schema schlicht falsch geordnet.
3. **Die Qualität ist vollständig nachgelagert.** Ein Schema kann nie besser sein als die
   Elemente, aus denen es besteht. Bei tb-Precision 0,72 ist jede vierte Zeile diskutabel.

**Der einzige Hebel, der das grundsätzlich verbessert, sind die Verwaltungsanweisungen.**
Der AEAO arbeitet die Merkmale vieler Vorschriften ausdrücklich der Reihe nach ab — beim
Wohnsitzbegriff des § 8 AO etwa Merkmal für Merkmal. Das ist wörtlich vorhandenes
Schemamaterial, und es kommt aus einer Quelle, die weder halluziniert noch rät. Deshalb
ist die Belegschicht für das Schema wichtiger als für die Markierung.

---

## 5. Was die Zahlen bedeuten — und was nicht

| Anzeige | Was sie misst | Was sie **nicht** misst |
|---|---|---|
| `konfidenz` | gewichtete Übereinstimmung der Läufe, syntaktische Stützung, Gegenprobe | Wahrscheinlichkeit, richtig zu sein |
| `einstimmigkeit` | Anteil der Spannen, die alle Läufe gleich lieferten | Wahrheit |
| `belegquote` | Anteil der Spannen mit existierender Fundstelle | dass die Fundstelle trägt |
| `status: belegt` | ≥ 40 % Belegquote bei Konfidenz ≥ 0,7 | juristische Geprüftheit |
| `0 Fehler` in `pruefen.mjs` | Form ist in Ordnung | Inhalt ist in Ordnung |

Das ist der Grund, warum das Statusband „automatisch erzeugt, nicht redaktionell geprüft"
schreibt und nicht „86 % Konfidenz". Behalten Sie diese Formulierung. Sie ist die
einzige Stelle im System, an der etwas nachweislich Wahres steht.

---

## 6. Was sich noch schließen lässt — ohne Handarbeit

Vier Verfahren, alle automatisch, aufsteigend nach Aufwand.

### 6.1 Belegprobe: prüfen, ob die Fundstelle trägt

Beiliegend als `tools/lib/belegprobe.mjs`. Ein getrennter Aufruf bekommt **nur** den
Belegtext und die Behauptung — ohne Normtext, ohne die Begründung des ersten Laufs — und
entscheidet: `stuetzt`, `neutral` oder `widerspricht`.

```js
// in annotieren.mjs, nach fuehreZusammen()
if (!ohneKi && normBelege) {
  for (const satz of erg.saetze) {
    const urteile = await belegProbe({
      spannen: satz.elemente, belege: normBelege,
      aufrufen: einAufruf, modell: MODELLE[0], token: TOKEN, budget,
    });
    const bilanz = probeAnwenden(satz.elemente, urteile);
    geprueft += bilanz.gestuetzt; verworfen += bilanz.entfernt;
  }
}
```

Wirkung: `neutral` nimmt den Belegbonus zurück und entfernt den Beleg — eine Fundstelle,
die nichts hergibt, wird nicht mehr angezeigt. `widerspricht` senkt die Konfidenz um 0,35
und setzt `strittig: true`. Zusätzlich muss die zitierte Stelle wörtlich im Belegtext
stehen, sonst wird sie verworfen. Kosten: etwa ein zusätzlicher Aufruf je Norm mit Beleg.

Das schließt Fehlertyp b) so weit, wie es ohne Menschen geht. Rest bleibt: Der Prüfer ist
wieder ein Modell.

### 6.2 Widerspruchsernte statt Übereinstimmungslob

Heute belohnt die Konfidenz Übereinstimmung. Interessanter ist das Gegenteil. Wo
**Syntaxanalyse und Modell auseinandergehen**, liegt mit hoher Wahrscheinlichkeit einer
von beiden falsch — und das sind die einzigen Fälle, die sich lohnen anzusehen.

```js
// zusätzlich in konsens.mjs speichern
uneinig: syntaxSagt !== modellSagt ? { syntax: syntaxSagt, modell: modellSagt } : null
```

Daraus erzeugen Sie automatisch `reports/strittig.json`, sortiert nach Häufigkeit des
Musters. Erfahrungsgemäß sind das keine 1 500 Einzelfälle, sondern zwanzig bis dreißig
wiederkehrende Konstruktionen. Jede davon lässt sich einmal in `syntax.mjs` regeln — und
dann ist sie für alle Gesetze gelöst. Das ist der wirksamste Weg, die Syntaxebene
weiterzuentwickeln, ohne einen Goldstandard zu pflegen.

### 6.3 Querkonsistenz zwischen Gesetzen

Dieselbe Wendung sollte im ganzen Bestand gleich eingeordnet werden. „soweit … zu erheben
ist" ist in § 3 SolzG ein Tatbestandsmerkmal; wenn dieselbe Wendung im UStG als
Rechtsfolge markiert ist, ist eine der beiden Markierungen falsch — welche, sagt das
Verfahren nicht, aber es zeigt die Stelle.

```bash
node tools/konsistenz.mjs
  „soweit … zu erheben ist"   tb 14× · rf 3×   → 3 Ausreißer
  „gilt entsprechend"         rf 41× · tb 6×   → 6 Ausreißer
```

Rein rechnerisch, kein Modell, kein Netz. Findet echte Fehler und kostet Sekunden.

### 6.4 Ein Goldstandard, der sich selbst schreibt

Sie wollen nicht von Hand annotieren — das müssen Sie auch nicht. Die
Verwaltungsanweisungen enthalten Formulierungen wie „Voraussetzung für … ist, dass …",
„… setzt voraus, dass …", „Die Vorschrift greift nur ein, wenn …". Wo eine solche
Wendung im AEAO steht und die genannte Voraussetzung wörtlich im Normtext vorkommt,
haben Sie ein **extern gewonnenes, nicht selbst erzeugtes Testbeispiel**:

```
AEAO zu § 8, Nr. 1: „Voraussetzung ist, dass der Steuerpflichtige die Wohnung innehat"
  → im Normtext: „eine Wohnung unter Umständen innehat"
  → Sollzuordnung: tb
```

Ein Skript, das diese Muster erntet, liefert über AO, EStG und UStG erfahrungsgemäß
mehrere hundert solcher Paare. Das ist kein vollwertiger Goldstandard — es deckt nur
Tatbestandsmerkmale ab, nur wo die Verwaltung sie ausdrücklich benennt, und es erbt die
Fehler der Mustererkennung. Aber es ist eine **von Ihrem eigenen Verfahren unabhängige
Messgröße**, und damit unendlich viel mehr als gar keine.

Ohne diesen Schritt bleibt Ihre einzige belastbare Zahl die aus meiner Sechs-Normen-
Referenz — und die habe ich selbst geschrieben, was sie als Maßstab entwertet.

---

## 7. Was ich an Ihrer Stelle täte

| Reihenfolge | Maßnahme | Aufwand | Was es schließt |
|---|---|---|---|
| 1 | Modelllauf endlich scharf schalten und nachsehen, ob `verfahren` umspringt | 10 Min | derzeit läuft *keiner* der drei Mechanismen |
| 2 | `belegprobe.mjs` einhängen | 1 Std | falsch zugeordnete Fundstellen |
| 3 | Widerspruchsernte + `konsistenz.mjs` | ½ Tag | wiederkehrende Syntaxfehler, systematisch |
| 4 | Goldstandard aus Verwaltungsanweisungen ernten | 1 Tag | erste unabhängige Messung |
| 5 | `schemata/` als eigene Ebene | laufend | echte, normübergreifende Prüfungsschemata |

Schritt 1 zuerst, und zwar heute — solange `stimmen=0/0` in den Daten steht, diskutieren
wir über Mechanismen, die gar nicht laufen.

---

## 8. Die Formulierung, die trägt

Wenn Sie eines aus diesem Papier übernehmen, dann das: Sagen Sie nicht, die Markierungen
seien geprüft, und sagen Sie auch nicht, sie seien zu 86 % sicher. Sagen Sie, wie sie
entstanden sind:

> Diese Markierung wurde automatisch erzeugt: syntaktische Satzgliedanalyse, drei
> unabhängige Modellläufe, unabhängige Gegenprobe, gestützt auf AEAO zu § 8 Nr. 3.
> Nicht redaktionell geprüft. Maßgeblich ist der im Bundesgesetzblatt verkündete Wortlaut.

Das ist überprüfbar, es ist vollständig, und es hält, was es verspricht. Alles darüber
hinaus wäre eine Behauptung, für die Sie einstehen müssten — und genau die wollten Sie
sich mit einem vollautomatischen Verfahren ja gerade ersparen.

---

*Dieses Dokument bewertet ein Datenverarbeitungsverfahren und ist keine Rechtsberatung.*
