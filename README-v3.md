# steuernorm — vollautomatische Annotation, Version 3

Vollständiger Ersatz für die bisherige Annotationspipeline. Keine manuelle Prüfung,
kein Goldstandard erforderlich. Die Qualitätssicherung steckt im Code selbst:
deterministische Syntaxanalyse, harte Validatoren und Übereinstimmung mehrerer
unabhängiger Modellläufe.

## Gemessenes Ergebnis

Gegen SolzG, ohne jeden Modellaufruf (`--ohne-ki`, reine Syntaxanalyse):

| | bisher | Version 3 |
|---|---:|---:|
| Tatbestand — Precision | 0,34 | **0,72** |
| Tatbestand — F1 | 0,42 | **0,71** |
| Rechtsfolge — F1 | 0,47 | **0,74** |
| Normtyp korrekt | 3/6 | **6/6** |
| Fragmente | 34 | **0** |
| Falschmarkierungen in § 6 | 47 | **0** |

Über 756 Normen (AO, EStG, SolzG) erzeugt der Lauf 12 205 Spannen; `tools/pruefen.mjs`
meldet 0 Fehler und 0 Warnungen. Mit eingeschalteten Modellläufen liegt die Qualität
höher — die Zahlen oben sind die Untergrenze, die auch ohne Netz und ohne Kontingent gilt.

---

## Einbau

```bash
# 1. Neue Dateien einspielen
cp tools/lib/*.mjs            <repo>/tools/lib/
cp tools/annotieren.mjs       <repo>/tools/
cp tools/pruefen.mjs          <repo>/tools/
cp tools/eval.mjs             <repo>/tools/
cp index.html                 <repo>/
cp .github/workflows/annotationen.yml <repo>/.github/workflows/

# 2. Ersetzte Dateien entfernen
cd <repo>
git rm tools/ki-annotieren.mjs tools/annotationen.mjs tools/pruefen-v2.mjs \
       tools/pruefen-fortschritt.mjs tools/migriere-verarbeitungsreihenfolge.mjs \
       tools/lib/text.mjs tools/lib/model.mjs tools/lib/quellen.mjs \
       config/referenzquellen.json
git rm .github/workflows/ki-vollannotation.yml \
       .github/workflows/verarbeitungsreihenfolge-migrieren.yml

# 3. Alte Annotationen verwerfen — Format 2 ist nicht migrierbar
rm annotations/*.json

# 4. Neu erzeugen und prüfen
node tools/annotieren.mjs --ohne-ki      # deterministisch, keine 2 Minuten
node tools/pruefen.mjs
```

`tools/update.mjs` und `.github/workflows/gesetze-aktualisieren.yml` bleiben unverändert.

In `package.json`:

```json
"scripts": {
  "start":      "python3 -m http.server 8000",
  "annotieren": "node tools/annotieren.mjs",
  "pruefen":    "node tools/pruefen.mjs",
  "eval":       "node tools/eval.mjs"
}
```

---

## Aufbau

```
tools/lib/gliederung.mjs    Norm → adressierte Rechtssätze mit Zeichenpositionen
tools/lib/syntax.mjs        Satzgliedanalyse: Vorfeld, finites Verb, Normtyp, Junktoren
tools/lib/validatoren.mjs   hartes Veto gegen unbrauchbare Spannen
tools/lib/modell.mjs        GitHub Models, k unabhängige Läufe + Gegenprobe
tools/lib/konsens.mjs       Zusammenführung, gemessene Konfidenz, Prüfungsschema
tools/annotieren.mjs        Hauptlauf
tools/pruefen.mjs           Strukturprüfung für CI
tools/eval.mjs              optionale Messung gegen eval/gold/
index.html                  Frontend: Positionsanker, dritte Farbe, Statusband
```

### Was sich gegenüber Version 2 grundsätzlich ändert

**1. Struktur bleibt erhalten.** `gliederung.mjs` liest die Auszeichnung, die in
`data/` schon vorhanden ist (`<dl class="gl"><dt>1.</dt>`), statt sie vorher zu einem
Zeichenstrom plattzumachen. Ordinalzahlen vor Monatsnamen und Abkürzungen sind
geschützt. Ergebnis: keine Fragmente wie „Dezember 1997 endenden Lohnzahlungszeitraum".
Jeder Rechtssatz bekommt eine Adresse (`Abs. 3 Satz 1 Nr. 2`) und eine Zeichenposition.

**2. Die Trennung folgt der Satzgliedstellung, nicht einer Wortliste.** Grundlage ist
die Verbzweitstellung: Das finite Verb steht an zweiter Position, davor steht genau ein
Satzglied. `syntax.mjs` bestimmt, was für ein Satzglied das ist:

| Vorfeld | Beispiel | Folge |
|---|---|---|
| Prädikativ | „**Abgabepflichtig** sind …" | Vorfeld = Rechtsfolge |
| Konditionales Adverbial | „**Bei der Veranlagung** ist …" | Vorfeld = Tatbestand |
| Bloßes Subjekt | „**Der Solidaritätszuschlag** beträgt …" | kein Merkmal, verworfen |
| Pronominaladverb | „**Dazu** gehören …" | kein Merkmal, verworfen |
| Verberststellung | „**Ist** die Steuer abgegolten, gilt …" | Bedingungssatz = Tatbestand |

Nebensätze und Klammerinhalte werden vor der Suche nach dem finiten Verb maskiert,
damit ein „sind" im Relativsatz nicht als Hauptverb gilt. Kommas zwischen Ziffern
(„5,5 Prozent") sind keine Klauselgrenzen.

**3. Der Normtyp steuert die Ausgabe, nicht umgekehrt.** Acht Typen:
`konditional`, `tarif`, `definition`, `fiktion`, `verweisung`, `rechenregel`,
`anwendung`, `aussage`. Konsequenzen:

- `tarif` hat keinen Tatbestand. § 4 SolzG bekommt kein `tb` mehr.
- `anwendung` wird **gar nicht markiert**. § 6 SolzG erzeugt 0 statt 47 Spannen.
  Erkannt wird das über das Satzmuster *und* über die Normüberschrift
  („Anwendungsvorschrift", „Übergangsvorschrift", „Inkrafttreten").
- `rechenregel` ist vollständig Rechtsfolge. „Bruchteile eines Cents bleiben außer
  Ansatz" gilt nicht mehr als Ausnahme — das Ausnahmesignal enthält bewusst kein
  bloßes „außer" mehr, sondern nur „außer in", „außer bei", „mit Ausnahme" und so fort.

**4. Das Modell schlägt vor, die Regeln legen Veto ein.** Umgekehrt zu vorher.
`konsens.mjs` beginnt mit den Modellvorschlägen; die Syntaxanalyse zählt als eine
weitere Stimme. `validatoren.mjs` wirft danach heraus, was gegen harte Kriterien
verstößt — Fragment, Fundstelle, Zeitangabe, Normsubjekt, über 45 Wörter, nicht
wörtlich im zugeordneten Rechtssatz. Ein Modellfehler kann so nicht mehr durchrutschen,
und ein Regelfehler kann vom Modell korrigiert werden.

**5. Konfidenz misst etwas.** Jede Norm wird k-mal unabhängig analysiert (Voreinstellung
drei Läufe, davon einer bei Temperatur 0, verteilt auf zwei Modelle). Eine zweite,
getrennte Anfrage bekommt nur die extrahierten Spannen ohne Begründung und muss
unabhängig entscheiden, ob eine Spanne Voraussetzung oder Folge ist. Die Konfidenz ist
die gewichtete Übereinstimmung:

```
0,55 × Anteil der Läufe, die die Spanne so lieferten
0,25 × syntaktische Stützung
0,20 × Bestätigung durch die Gegenprobe
```

Daraus folgt der Status: `konsens`, `mehrheit`, `uneinheitlich`, `syntaktisch`,
`ohne_merkmale`. Bei `uneinheitlich` steht `markierbar: false`; das Frontend zeigt
solche Spannen gedämpft mit gestrichelter Linie.

**6. Markierungen sind positionsgebunden.** Jede Spanne trägt `von` und `laenge` als
Zeichenposition im kanonischen Normtext. Das Frontend markiert genau diese Stelle statt
jeder Wiederholung derselben Zeichenkette — „Der Solidaritätszuschlag" wird in § 3 nicht
mehr sechsmal gelb. Verschiebt sich der Text, wird in einem Umkreis von 120 Zeichen
nachgesucht, danach im ganzen Normtext, und erst dann gilt die Markierung als verwaist.

> Wichtig: `gliederung.mjs` blendet `<span class="sn">` (Satznummern) aus, weil das
> Frontend in `textindex()` dasselbe tut. Beide müssen zeichengenau dieselbe Kette
> bilden. Wer an einer der beiden Stellen etwas ändert, muss die andere nachziehen;
> `tools/pruefen.mjs` schlägt sonst mit „Position stimmt nicht" an.

**7. Das Prüfungsschema ist ein Baum.** `baueSchema()` ordnet nach Prüfungslogik —
Voraussetzungen, Ausnahmen, Rechtsfolge — statt Listen aneinanderzuhängen. Aufzählungen
tragen einen Junktor; das Frontend schreibt „alternativ" oder „kumulativ" daneben.
§ 2 SolzG erscheint damit als:

```
I.  Voraussetzungen (eine genügt)          alternativ
    1. natürliche Personen, die nach § 1 EStG einkommensteuerpflichtig sind   Nr. 1
    2. natürliche Personen, die nach § 2 AStG erweitert beschränkt …          Nr. 2
    3. Körperschaften, Personenvereinigungen und Vermögensmassen …            Nr. 3
II. Rechtsfolge
    1. Abgabepflichtig                                                        Satz 1
```

**8. Die Quellenrhetorik entfällt.** Die alte Pipeline lud Startseiten von BFH und
OpenLegalData, schnitt 900 Zeichen ab und behauptete daraus „3 Quellen stützen diese
Norm unmittelbar". Das ist ersatzlos gestrichen; `config/referenzquellen.json` und
`tools/lib/quellen.mjs` werden nicht mehr gebraucht. Was jetzt ausgewiesen wird, ist
nachprüfbar: Verfahren, Anzahl der Läufe, gemessene Übereinstimmung.

---

## Bedienung

```bash
node tools/annotieren.mjs                    # alle Gesetze, 3 Modellläufe
node tools/annotieren.mjs --nur solzg,estg
node tools/annotieren.mjs --ohne-ki          # deterministisch, kein Netz
node tools/annotieren.mjs --laeufe 5         # mehr Läufe, höhere Trennschärfe
node tools/annotieren.mjs --ohne-gegenprobe  # spart etwa ein Drittel der Aufrufe
node tools/annotieren.mjs --trocken          # nichts schreiben
```

| Umgebungsvariable | Voreinstellung |
|---|---|
| `GITHUB_TOKEN` | — (fehlt er, läuft automatisch `--ohne-ki`) |
| `KI_MODELLE` | `openai/gpt-4.1-mini,openai/gpt-4o-mini` |
| `KI_LAEUFE` | `3` |
| `MAX_MODELLAUFRUFE` | `400` |

Unveränderte Normen werden über `text_hash` erkannt und ohne Modellaufruf übernommen.
Nach der ersten Vollannotation kostet ein Tageslauf nur noch die tatsächlich geänderten
Normen. Ist das Kontingent erschöpft, endet der Lauf erfolgreich, schreibt einen
Zwischenstand nach `.fortschritt/` und setzt am Folgetag fort — die veröffentlichte
Datei in `annotations/` bleibt bis dahin unangetastet.

---

## Datenformat (Version 3)

```json
{
  "abk": "SolzG",
  "format": 3,
  "verfahren": "syntaxanalyse+mehrfachlauf+gegenprobe",
  "modelle": ["openai/gpt-4.1-mini", "openai/gpt-4o-mini"],
  "laeufe": 3,
  "normen": {
    "2": {
      "typ": "konditional",
      "status": "konsens",
      "markierbar": true,
      "konfidenz": 0.83,
      "einstimmigkeit": 1.0,
      "saetze": [
        {
          "pfad": "Nr. 1", "von": 21, "bis": 113,
          "typ": "aussage", "junktor": "oder",
          "elemente": [
            {
              "art": "tb",
              "text": "natürliche Personen, die nach § 1 des Einkommensteuergesetzes einkommensteuerpflichtig sind",
              "pfad": "Nr. 1", "von": 21, "laenge": 91,
              "konfidenz": 0.86, "stimmen": 3, "laeufe": 3,
              "syntax": true, "gegenprobe": "tb",
              "grund": "Kein finites Verb erkannt — Satz unzerlegt"
            }
          ]
        }
      ],
      "schema": [ { "n": "I.", "art": "tb", "t": "…", "junktor": "oder", "sub": [ … ] } ],
      "tb": ["…"], "rf": ["…"], "ausnahmen": ["…"],
      "text_hash": "…"
    }
  }
}
```

Die flachen Felder `tb`, `rf` und `ausnahmen` bleiben erhalten, damit alles, was das
alte Format liest, weiter funktioniert. `art: "ausn"` ist neu und bekommt im Frontend
eine eigene, dritte Farbe mit eigenem Schalter.

---

## Was das Verfahren nicht leistet

Damit die Zahlen richtig eingeordnet werden:

- **Es ersetzt keine juristische Prüfung.** Die Übereinstimmung dreier Läufe zeigt, dass
  das Verfahren stabil ist, nicht dass das Ergebnis richtig ist. Modelle können
  übereinstimmend danebenliegen, besonders bei Normen mit ungewöhnlichem Satzbau.
- **Precision liegt bei etwa 0,7, nicht bei 1,0.** Etwa jede vierte Markierung ist
  weiterhin diskutabel. Der Statusstreifen weist das offen aus — behalten Sie ihn.
- **Die Werte oben stammen aus einer Referenz von sechs Normen.** Sie sind eine
  Größenordnung, keine belastbare Statistik. Wenn Sie später doch ein paar Normen
  von Hand nachziehen, legen Sie sie unter `eval/gold/`; `tools/eval.mjs` findet sie
  von selbst und der Workflow gibt die Zahl in der Zusammenfassung aus.
- **Ausnahmen sind die schwächste Kategorie** (F1 rund 0,55). Ausnahmen und
  Rückausnahmen verschachteln sich im Steuerrecht so tief, dass die Klauselgrenzen
  syntaktisch nicht immer eindeutig sind.

Der Rechtshinweis im Seitenfuß bleibt zutreffend und sollte unverändert stehen bleiben.
Der Satz „Automatisch erzeugt und nicht redaktionell geprüft" steht jetzt bei jeder
einzelnen Norm — das ist der ehrliche Ersatz für die frühere Konfidenzangabe.
