# steuernorm — zweiter Befund: warum es bei Syntax geblieben ist, und wie die Quellenanbindung aussehen müsste

Analysegrundlage: Repository `Ccan-devoloper/steuernorm`, Stand 29. Juli 2026, 13:14 Uhr
(`reports/annotation.json`), live unter `ccan-devoloper.github.io/steuernorm`.

---

## Teil 1 — Ihre Vermutung stimmt, und der Grund steht im Code

Sie schreiben, es laufe bisher alles nur über Syntax. Das ist nachweisbar richtig:

```json
// annotations/solzg.json
"verfahren": "syntaxanalyse",
"modelle": ["nur-syntax"],
"laeufe": 0
```

Und in `reports/annotation.json` steht die zweite Hälfte der Erklärung:

```json
{ "abk": "AO", "normen": 503, "bearbeitet": 0, "uebernommen": 503 }
```

**Null bearbeitet, 503 übernommen.** Es gibt zwei Ursachen, beide behebbar in wenigen Minuten.

### Ursache 1: Jeder Push erzwingt `--ohne-ki`

In `.github/workflows/annotationen.yml`:

```bash
if [ "$EVENT_NAME" = "push" ] || [ "${INPUT_OHNE_KI:-false}" = "true" ]; then
  args+=(--ohne-ki)
fi
```

Die Absicht war richtig — beim Einspielen der Pipeline sofort einen vollständigen
deterministischen Bestand erzeugen, ohne Kontingent zu verbrennen. Nur haben Sie seither
weiter gepusht, und jeder Push hat den Bestand erneut rein syntaktisch überschrieben.
Der planmäßige Lauf um 05:10 UTC hätte mit Modell laufen sollen, kam aber gegen Ursache 2
nicht an.

### Ursache 2: Der Cache kennt das Verfahren nicht — mein Fehler

In `tools/annotieren.mjs`:

```js
if (vorher && vorher.text_hash === th && Number(alt.format) === FORMAT) {
  normen[norm.id] = vorher;
  uebernommen++;
  continue;                      // ← überspringt, egal wie die Annotation entstand
}
```

Der Cache-Schlüssel besteht aus Normtext und Format. Das **Verfahren** fehlt. Sobald eine
Norm einmal syntaktisch annotiert ist, überspringt jeder spätere Lauf sie — auch der mit
Modell. Sie sind damit dauerhaft auf dem syntaktischen Stand eingefroren, und daran ändert
auch ein manuell ausgelöster Lauf nichts.

Das habe ich beim ersten Entwurf übersehen. Die Bedingung muss lauten:

```js
const zielVerfahren = ohneKi ? "syntaxanalyse" : "syntaxanalyse+mehrfachlauf+gegenprobe";
const aktuellGenug =
  vorher &&
  vorher.text_hash === th &&
  Number(alt.format) === FORMAT &&
  // Ein syntaktischer Bestand darf durch einen Modelllauf ÜBERSCHRIEBEN werden,
  // aber ein Modellbestand nicht durch einen syntaktischen ersetzt werden.
  (vorher.verfahren === zielVerfahren || (ohneKi && vorher.verfahren !== "syntaxanalyse"));

if (aktuellGenug) { normen[norm.id] = vorher; uebernommen++; continue; }
```

Und im Workflow den Push-Zweig auf die Erstbefüllung begrenzen:

```bash
# Nur wenn noch gar kein Bestand existiert, deterministisch vorbefüllen.
if [ "${INPUT_OHNE_KI:-false}" = "true" ]; then
  args+=(--ohne-ki)
elif [ "$EVENT_NAME" = "push" ] && [ ! -s annotations/solzg.json ]; then
  args+=(--ohne-ki)
fi
```

Zusätzlich empfehle ich einen Schalter `--aufwerten`, der gezielt alles neu rechnet, was
`status: "syntaktisch"` trägt. Damit können Sie den Bestand schrittweise anheben, ohne bei
jedem Lauf 1 532 Normen durch das Modell zu schicken.

**Prüfen Sie außerdem**, ob der Job tatsächlich Modellzugriff hat. `permissions: models: read`
steht auf Workflow-Ebene — das ist richtig. Aber `annotieren.mjs` fällt still auf
`--ohne-ki` zurück, wenn `GITHUB_TOKEN` leer ist:

```js
const ohneKi = hat("--ohne-ki") || !TOKEN;
```

Bauen Sie eine laute Fehlermeldung ein, sonst sehen Sie so etwas nie:

```js
if (!TOKEN && !hat("--ohne-ki")) {
  console.error("GITHUB_TOKEN fehlt — es wird nur die Syntaxanalyse ausgeführt.");
  console.error("Im Workflow: permissions.models: read setzen und GITHUB_TOKEN übergeben.");
}
```

### Was der Modelllauf realistisch bringt

Der syntaktische Stand liegt bei tb-F1 0,71. Mehrfachlauf plus Gegenprobe hebt das nach
meiner Einschätzung auf 0,80 bis 0,85 — nicht auf 0,95. Die Syntaxanalyse fängt die
regelmäßigen Konstruktionen; was übrig bleibt, sind Normen mit ungewöhnlichem Satzbau,
tief verschachtelte Ausnahmeketten und die Frage, welche Merkmale eigentlich
zusammengehören. Das letzte Drittel ist Auslegung, nicht Grammatik.

---

## Teil 2 — Warum Syntax allein an eine Decke stößt

Ein Beispiel aus Ihrem eigenen Bestand, § 3 Abs. 3 Satz 1 SolzG:

> Der Solidaritätszuschlag ist von einkommensteuerpflichtigen Personen nur zu erheben,
> wenn die Bemessungsgrundlage … 1. in den Fällen des § 32a Absatz 5 und 6 EStG
> 40 700 Euro, 2. in anderen Fällen 20 350 Euro übersteigt.

Die Syntax sagt korrekt: Konditionalsatz mit „wenn", also Tatbestand. Was sie **nicht**
sagen kann:

- dass es sich um eine **Freigrenze** handelt und nicht um einen Freibetrag — der
  Unterschied entscheidet über die gesamte Rechtsfolge, steht aber nirgends im Wortlaut;
- dass Nr. 1 und Nr. 2 sich gegenseitig ausschließen, weil sie an den Tarif anknüpfen;
- dass § 4 Satz 2 diese Norm überhaupt erst erträglich macht;
- dass die Zahlen erst ab dem Veranlagungszeitraum 2026 gelten.

Kein Satzgliedanalysator der Welt liest das aus dem Wortlaut. Es steht in der
Verwaltungsauffassung, in der Rechtsprechung und in der Gesetzesbegründung. Genau da setzt
Ihre Idee an — und sie ist richtig. Nur muss man genau sagen, was Quellen leisten können
und was nicht.

---

## Teil 3 — Wie andere juristische Werkzeuge das lösen

### Der ernüchternde Befund aus der Forschung

Stanford RegLab und HAI haben 2024 die erste vorregistrierte empirische Untersuchung
kommerzieller KI-Rechtsrecherche veröffentlicht (Magesh u. a., inzwischen im *Journal of
Empirical Legal Studies* 2025). Getestet wurden Lexis+ AI und Westlaw AI-Assisted Research
— beide mit Retrieval-Augmented Generation, beide von Anbietern, die mit „hallucination-free"
warben.

Ergebnis: <cite index="16-1">Halluzinationsraten von 17 % für Lexis+ AI, 33 % für Westlaw AI-Assisted Research und 43 % für GPT-4</cite>. <cite index="12-1">Die Studie kommt zu dem Schluss, dass die Herstellerangaben überzogen sind: Halluzinationen sind gegenüber allgemeinen Chatbots reduziert, aber nicht beseitigt.</cite>

Zwei Lehren daraus für Sie:

1. **Quellenanbindung hilft messbar** — von 43 % auf 17 % ist der Faktor zweieinhalb.
   Es lohnt sich.
2. **Quellenanbindung heilt nicht.** Wer nach dem Einbau von RAG „geprüft" auf seine
   Ausgabe schreibt, wiederholt genau den Fehler, für den LexisNexis und Thomson Reuters
   öffentlich kritisiert wurden. Die Studie unterscheidet dabei zwei Fehlerarten, und die
   zweite ist die tückische: Antworten, die das Recht korrekt wiedergeben, aber mit einer
   Quelle belegt werden, die das gar nicht hergibt.

### Was in der Rechtsinformatik tatsächlich trägt

Die Werkzeuge, die sich seit Jahrzehnten halten, sind **nicht die urteilenden, sondern die
verweisenden**. Shepard's Citations gibt es seit 1873, KeyCite seit 1997. Beide behaupten
nichts über den Inhalt einer Norm — sie zeigen, **wer sie zitiert und in welchem Sinn**.
Die Bewertung bleibt beim Leser.

In Deutschland macht dejure.org genau das, kostenlos: Neben jedem Paragrafen stehen die
Entscheidungen, die ihn anwenden, und die Querverweise. Kein Modell, keine Behauptung,
nur ein sehr guter Index.

**Das ist das Muster, das ich Ihnen empfehle: extraktiv statt generativ.** Statt das Modell
sagen zu lassen „das Tatbestandsmerkmal ist X, Konfidenz 86 %", zeigen Sie die Belegstelle
im Wortlaut und verlinken sie. Zwei Vorteile: Es hilft dem Leser mehr, und es umgeht das
Halluzinationsproblem, weil nichts behauptet wird, was nicht wörtlich dasteht.

---

## Teil 4 — Die Quellen, die Sie tatsächlich anbinden können

Für deutsches Steuerrecht ist die Lage ungewöhnlich günstig: Die wichtigsten Auslegungs­quellen
sind amtlich, kostenlos und **paragrafenweise gegliedert**. Das ist genau die Struktur, die
Ihre Annotationen brauchen.

| Quelle | Deckt ab | Struktur | Zugang |
|---|---|---|---|
| **AEAO** (Anwendungserlass zur AO) | AO | pro § | `ao.bundesfinanzministerium.de` |
| **UStAE** (Umsatzsteuer-Anwendungserlass) | UStG | pro § und Abschnitt | Amtliches UStG-Handbuch |
| **EStR / EStH** (Richtlinien und Hinweise) | EStG | pro § (R und H) | Amtliches EStG-Handbuch |
| **KStR / KStH**, **GewStR**, **ErbStR** | KStG, GewStG, ErbStG | pro § | Amtliche Handbücher |
| **BFH-Rechtsprechung** | alle | pro Norm zitiert | Rechtsprechung-im-Internet, openJur |
| **Gesetzesmaterialien** | alle | pro Gesetzentwurf | DIP-API des Bundestags |

Alle amtlichen Handbücher liegen unter `amtliche-handbuecher.de` beziehungsweise unter
eigenen Domänen mit derselben Systematik. Der Aufbau ist maschinenlesbar und stabil:

```
https://ao.bundesfinanzministerium.de/ao/2024/Abgabenordnung/
  Erster-Teil/Zweiter-Abschnitt/Paragraf-8/inhalt.html
```

Ich habe das Inhaltsverzeichnis abgerufen und geprüft: Jeder Paragraf hat eine eigene
Seite, die Zuordnung § → URL lässt sich einmalig aus dem Verzeichnisbaum aufbauen. Auf der
Einzelseite steht der Gesetzestext **und** direkt darunter der AEAO zu dieser Vorschrift.
Zusätzlich gibt es Sonderknoten wie „AEAO vor §§ 8, 9" und „AEAO vor §§ 169 bis 171" —
die sollten Sie mitnehmen, sie enthalten oft die Systematik.

### Und das neue Bundesportal

Das BMJ baut mit dem DigitalService das **Rechtsinformationsportal** auf (NeuRIS), das
Gesetze-im-Internet ablösen soll. <cite index="19-1">Der Dienst befindet sich in der Testphase, der Datenbestand ist noch nicht vollständig, und es gibt eine dokumentierte Programmierschnittstelle.</cite> <cite index="3-1">Bereitgestellt werden unter anderem Gerichtsentscheidungen mit Metadaten und verlinkten Randnummern sowie eine API zum direkten Abruf.</cite>

Für Sie heißt das: Bauen Sie die Rechtsprechungsanbindung gegen diese API, nicht gegen
Bestandsseiten. Sie ist noch unvollständig, aber sie ist die Zukunft und spart Ihnen später
eine Migration. Bis dahin liefert `rechtsprechung-im-internet.de` denselben Bestand als XML.

---

## Teil 5 — Wie ich die Quellenanbindung bauen würde

Nicht als „Gegenprüfung mit Ja/Nein-Ergebnis, sondern als **drei getrennte Schichten** mit
klar verschiedener Verbindlichkeit.

### Schicht 1: Belege sammeln (rein extraktiv, kein Modell)

Ein Vorlauf `tools/belege.mjs` baut einmalig eine Datei je Gesetz:

```json
{
  "abk": "SolzG",
  "normen": {
    "3": {
      "verwaltung": [],
      "rechtsprechung": [
        { "gericht": "BFH", "az": "IX R 15/20", "datum": "2023-01-17",
          "leitsatz": "…", "url": "…" }
      ],
      "materialien": [
        { "drs": "20/9341", "titel": "Steuerfortentwicklungsgesetz",
          "fundstelle": "S. 84", "url": "…" }
      ],
      "abgerufen": "2026-07-30"
    }
  }
}
```

Diese Schicht behauptet nichts. Sie wird täglich aktualisiert und ist für sich genommen
schon ein Produktmerkmal — es ist im Kern das, was dejure.org wertvoll macht.

### Schicht 2: Belege in den Prompt (echtes RAG)

Erst jetzt kommt das Modell ins Spiel, und zwar mit den Belegstellen im Kontext:

```js
const nutzer = JSON.stringify({
  norm: { enbez, titel },
  rechtssaetze: einheiten.map(e => ({ pfad: e.pfad, text: e.text })),
  syntaktischer_vorschlag: vorschlag,
  belege: {
    verwaltungsauffassung: belege.verwaltung.slice(0, 3),   // AEAO/UStAE/EStR-Auszüge
    leitsaetze: belege.rechtsprechung.slice(0, 5),
  },
  aufgabe: "Prüfe den syntaktischen Vorschlag gegen die Belegstellen. "
         + "Wo die Verwaltungsauffassung ein Tatbestandsmerkmal ausdrücklich benennt, "
         + "richte dich danach. Belege deine Zuordnung mit der Fundstelle.",
});
```

Der Gewinn liegt vor allem beim **Prüfungsschema**. Verwaltungsanweisungen enthalten
häufig ausformulierte Prüfungsreihenfolgen — der AEAO zu § 8 AO etwa arbeitet die Merkmale
des Wohnsitzbegriffs der Reihe nach ab. Das ist genau das Material, aus dem ein
belastbares Schema entsteht, und es steht wörtlich zur Verfügung.

Erweitern Sie das Antwortschema um ein Belegfeld:

```json
{ "art": "tb", "text": "…", "beleg": { "quelle": "AEAO zu § 8", "nr": "3" } }
```

Und **verwerfen Sie jede Zuordnung, deren Beleg nicht wörtlich im gelieferten Belegtext
vorkommt.** Das ist derselbe Validator-Gedanke wie bisher, nur auf die Fundstelle
angewendet — und es ist die einzige wirksame Antwort auf den zweiten Fehlertyp der
Stanford-Studie.

### Schicht 3: Anzeige — Belege zeigen, nicht Urteile

Unter jeder Norm eine Rubrik „Belege", die die Fundstellen mit kurzem Auszug und Link
zeigt. Bei markierten Merkmalen, die einen Beleg tragen, ein kleines Zeichen am Rand, das
darauf springt.

Das Statusband bekommt eine vierte Stufe:

| Status | Bedeutung |
|---|---|
| `syntaktisch` | nur Satzgliedanalyse |
| `mehrheit` | Modellläufe überwiegend einig |
| `konsens` | Modellläufe einig, Gegenprobe bestätigt |
| **`belegt`** | zusätzlich durch eine amtliche Fundstelle gedeckt |

`belegt` ist die einzige Stufe, bei der Sie mehr als ein Verfahren ausweisen — und selbst
da schreiben Sie „durch AEAO zu § 8 Nr. 3 gestützt", nicht „geprüft". Der Unterschied ist
nicht kosmetisch: Das eine ist überprüfbar, das andere ist eine Behauptung, für die Sie
haften.

### Reihenfolge und Aufwand

| Schritt | Aufwand | Wirkung |
|---|---|---|
| 1. Cache- und Workflow-Fehler beheben | 30 Min | Modellläufe laufen überhaupt |
| 2. `--aufwerten` einbauen, Bestand schrittweise anheben | 2 Std | tb-F1 von 0,71 auf ~0,80 |
| 3. §→URL-Karte der amtlichen Handbücher aufbauen | 1 Tag | Grundlage für alles Weitere |
| 4. `belege.mjs`: Verwaltungsanweisungen je § abrufen | 1 Tag | Belegschicht, für sich wertvoll |
| 5. Rechtsprechung über das Bundesportal ergänzen | 1 Tag | Fundstellen wie bei dejure |
| 6. Belege in den Prompt, Belegvalidator | 1 Tag | messbarer Sprung beim Schema |
| 7. Belege im Frontend anzeigen | ½ Tag | das eigentliche Produktmerkmal |

Schritt 1 heute. Schritt 3 und 4 sind der Kern — danach haben Sie etwas, das es in dieser
Form frei zugänglich nicht gibt: Steuergesetze mit Struktur *und* amtlicher
Auslegungsquelle nebeneinander.

---

## Teil 6 — Rechtliche und praktische Randbedingungen

**Urheberrecht.** Gesetzestexte sind nach § 5 Abs. 1 UrhG gemeinfrei, ebenso amtliche
Erlasse und Richtlinien — AEAO, UStAE und EStR sind amtliche Werke. Gerichtsentscheidungen
ebenfalls. Sie dürfen sie speichern und anzeigen. Vorsicht ist geboten bei redaktionellen
Zutaten kommerzieller Anbieter (Leitsätze von Verlagen, Orientierungssätze); halten Sie
sich an die amtlichen Fassungen und an openJur beziehungsweise das Bundesportal.

**Abrufhygiene.** Die BMF-Handbücher sind statische Seiten ohne API. Bauen Sie die Karte
einmalig auf, halten Sie sie im Repository, und rufen Sie Einzelseiten nur ab, wenn sich
der Normtext geändert hat. Ein Abruf pro Sekunde, ein aussagekräftiger User-Agent mit
Kontaktmöglichkeit, `If-Modified-Since` beachten. Bei rund 1 500 Normen ist der Erstabruf
in gut zwanzig Minuten durch.

**Jahresausgaben.** Die Handbücher erscheinen jahrgangsweise (`/ao/2024/`, `/ao/2025/`).
Ihre Gesetzesdaten sind tagesaktuell, die Handbücher nicht. Weisen Sie den Jahrgang der
Belegstelle immer mit aus — sonst entsteht der Eindruck, die Verwaltungsauffassung sei so
aktuell wie der Gesetzestext.

**Grenzen.** Nicht jede Norm hat eine Verwaltungsanweisung. Das SolzG hat keinen eigenen
Anwendungserlass; für §§ 1 bis 6 SolzG werden Sie über die Handbücher wenig finden und
müssen auf Rechtsprechung und Materialien ausweichen. Rechnen Sie damit, dass etwa die
Hälfte Ihrer Normen ohne Beleg bleibt — und zeigen Sie das offen an, statt die Lücke zu
kaschieren.

---

*Die Einordnungen in diesem Bericht sind methodische Vorschläge zur Datenqualität und
keine Rechtsberatung. Maßgeblich bleibt der im Bundesgesetzblatt verkündete Wortlaut.*
