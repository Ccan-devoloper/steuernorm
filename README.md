# steuernorm — Fassung 7

Die deutschen Steuergesetze im Volltext, als **Arbeitsplatz**: mehrere Normen
gleichzeitig geöffnet, links das Gesetz, in der Mitte der Lesetext, rechts ein
Apparat in Registern.

Drei Auszeichnungsebenen im Normtext, gleichzeitig lesbar:

| Ebene | Kodierung |
|---|---|
| **Maschinelle Struktur** — Tatbestand · Rechtsfolge · Ausnahme/Vorbehalt | Fläche, in drei Stufen (aus · dezent · voll) |
| **Eigene Markierung** — freie Farbe, Notiz | Fläche 45 % mit farbiger Unterkante |
| **Verwaltungsstelle** — Richtlinie, BMF-Schreiben | Punktlinie mit Fundstellen-Chip |

Der Normtext bleibt dabei unangetastet. Was die Farben bedeuten, sagt allein
die Legende darüber — im Wortlaut steht kein Wort dazu.

**Neu in Fassung 7:** Dunkelmodus mit Umschalter hell · dunkel · System ·
**Sammelmappe** für Normen und markierte Stellen · **Fassungsvergleich** zweier
Zeitstände derselben Norm, wortweise · drittes Datenformat `fassungen/`.

**Neu in Fassung 6:** Oberfläche nach dem Übergabepaket neu gebaut · zwei neue
Datenformate `struktur/` und `verwaltung/` · Startseite, Gesetzesübersicht und
Trefferliste · Apparat als Blatt auf Mobil · Druckfassung · Schriften lokal.

Die vollständige Herleitung steht in
[`docs/06-mappe-und-fassungsvergleich.md`](docs/06-mappe-und-fassungsvergleich.md)
und [`docs/05-oberflaeche-arbeitsplatz.md`](docs/05-oberflaeche-arbeitsplatz.md),
die der Erkennung in
[`docs/04-erkennung-und-oberflaeche-fassung-5.md`](docs/04-erkennung-und-oberflaeche-fassung-5.md).

**Geprüft:** `node tools/pruefen.mjs` über alle 14 Gesetze — 1 537 Normen,
25 236 Spannen, 0 Fehler, 0 Warnungen. `node tools/frontend-pruefen.mjs`
(jsdom, 27 Prüfungen) und `node tools/browser-pruefen.mjs` (Chromium, 130
Prüfungen: Spaltenmaße, Absturzfreiheit, vier Fensterbreiten, Zuordnung der
Einfärbung, Farbwahl, Blatt, Mappe, Fassungsvergleich, Dunkelmodus,
Druckfassung, Betrieb ohne Netz).

```bash
python3 -m http.server 8000     # dann http://localhost:8000
```

---

## Inhalt

```
index.html                        Frontend, vollständig überarbeitet
package.json                      neue Skripte
config/handbuecher.json           Zuordnung Gesetz → amtliches Handbuch

tools/annotieren.mjs              Hauptlauf (geändert: Belegprobe, --aufwerten)
tools/belege.mjs                  NEU  Belegschicht
tools/konsistenz.mjs              NEU  findet widersprüchliche Zuordnungen
tools/pruefen.mjs                 Strukturprüfung
tools/eval.mjs                    Messung gegen eval/gold (falls vorhanden)

tools/lib/gliederung.mjs          Norm → adressierte Rechtssätze mit Positionen
tools/lib/syntax.mjs              Satzgliedanalyse, Vorfeld, Normtyp, Junktoren
tools/lib/verben.mjs              NEU  morphologische Erkennung finiter Verben
tools/lib/ausnahmen.mjs           NEU  Ausnahme, Rückausnahme, Vorrangregel
tools/verweise.mjs                NEU  Rückverweisindex („Zitiert von")
tools/frontend-pruefen.mjs        NEU  Frontendprüfung mit jsdom
tools/browser-pruefen.mjs         NEU  Layout- und Offlineprüfung in Chromium
tools/struktur.mjs                NEU  erzeugt struktur/<gesetz>.json
tools/fassungen.mjs               NEU  erzeugt fassungen/<gesetz>.json aus dem
                                       Git-Verlauf von data/
tools/schriften-holen.mjs         NEU  legt die Schriften ins Repository
sw.js                             NEU  Offlinezugriff
tools/lib/validatoren.mjs         hartes Veto gegen unbrauchbare Spannen
tools/lib/konsens.mjs             Zusammenführung, Konfidenz, Schema, Belegvalidator
tools/lib/modell.mjs              GitHub Models, Mehrfachlauf, Gegenprobe
tools/lib/model.mjs               Weiterleitung auf modell.mjs (Altname)
tools/lib/handbuch.mjs            NEU  Amtliche Handbücher des BMF
tools/lib/rechtsprechung.mjs      NEU  Rechtsinformationsportal des Bundes
tools/lib/belegprobe.mjs          NEU  prüft, ob ein Beleg die Zuordnung trägt

.github/workflows/annotationen.yml  geändert: Push erzwingt nicht mehr --ohne-ki
.github/workflows/belege.yml        NEU

struktur/<gesetz>.json            NEU  Zeichenpositionen der Kategorien
verwaltung/<gesetz>.json          NEU  Richtlinien und BMF-Schreiben je Stelle
fassungen/<gesetz>.json           NEU  Zeitstände für den Fassungsvergleich

docs/01-befund-und-quellenanbindung.md
docs/02-ui-ux-analyse.md
docs/03-richtigkeit-und-grenzen.md
docs/04-erkennung-und-oberflaeche-fassung-5.md
docs/05-oberflaeche-arbeitsplatz.md
docs/06-mappe-und-fassungsvergleich.md            NEU
```

---

## Einbau

```bash
cd <ihr-repo>

# 1. Dateien einspielen (überschreibt gleichnamige)
cp -r index.html package.json config tools .github docs .

# 2. Verzeichnis für die Belegschicht
mkdir -p belege

# 3. Ohne Netz prüfen, dass alles läuft
node tools/annotieren.mjs --nur solzg --ohne-ki
node tools/pruefen.mjs --nur solzg
node tools/konsistenz.mjs

git add -A && git commit -m "Umbau v4: Belegschicht, Belegprobe, neues Frontend"
```

Nichts muss gelöscht werden. `tools/lib/model.mjs` bleibt als Weiterleitung erhalten,
damit bestehende Importpfade weiter funktionieren.

---

## Erste Schritte nach dem Einbau

### Schritt 1 — Modelllauf scharf schalten

Das ist das Dringendste. Bisher lief bei Ihnen ausschließlich die Syntaxanalyse
(`"verfahren": "syntaxanalyse"`, `"laeufe": 0`), weil jeder Push `--ohne-ki` erzwang.
Der neue Workflow tut das nur noch bei der Erstbefüllung.

```bash
export GITHUB_TOKEN=<Token mit models:read>
node tools/annotieren.mjs --nur solzg --laeufe 3
```

Danach in `annotations/solzg.json` prüfen:

```json
"verfahren": "syntaxanalyse+mehrfachlauf+gegenprobe",
"laeufe": 3
```

Steht dort weiterhin `nur-syntax`, fehlt der Modellzugang. Die Warnung nennt Ihnen die
Stelle; im Workflow gibt es dafür jetzt einen eigenen Prüfschritt, dessen HTTP-Status in
der Zusammenfassung erscheint.

### Schritt 2 — Belegschicht aufbauen

```bash
node tools/belege.mjs --karte          # einmalig, dauert (ein Abruf je Sekunde)
node tools/belege.mjs --max 400        # unterbrechbar, nimmt beim nächsten Lauf auf
```

Der erste Befehl legt `config/handbuch-karte-<gesetz>.json` an. Prüfen Sie die Ausgabe:
Findet er null Paragrafen, stimmt die Startadresse in `config/handbuecher.json` nicht —
die BMF-Handbücher wechseln jahrgangsweise die Pfade. In dem Fall die aktuelle
Inhaltsverzeichnis-URL eintragen und erneut laufen lassen.

### Schritt 3 — Mit Belegen annotieren

```bash
node tools/annotieren.mjs --aufwerten
node tools/pruefen.mjs
node tools/konsistenz.mjs --schreiben
```

`--aufwerten` rechnet gezielt neu, was noch syntaktisch ist, was `uneinheitlich` blieb
oder was trotz vorliegender Belege keinen trägt.

---

## Was neu ist

### Belegschicht — extraktiv, nicht generativ

`belege.mjs` läuft die amtlichen Handbücher des BMF ab (AEAO, EStR/EStH, UStAE, KStR,
GewStR, ErbStR, GrStR) und legt je Paragraf die Verwaltungsabschnitte und bis zu fünf
Entscheidungen ab. Diese gehen in den Prompt und werden unter der Norm angezeigt.

Amtliche Werke, nach § 5 Abs. 1 UrhG gemeinfrei. Das BMF weist auf das Änderungsverbot
(§ 14 UrhG) und das Quellenangabegebot hin — Auszüge werden deshalb unverändert
übernommen, auf Satzgrenze gekürzt und stets mit Fundstelle, Jahrgang und Link gezeigt.
Ein Abruf je Sekunde, sprechender User-Agent, `If-Modified-Since`.

Rechnen Sie damit, dass etwa die Hälfte der Normen ohne Verwaltungsbeleg bleibt. Das
SolzG hat keinen eigenen Anwendungserlass; `config/handbuecher.json` führt solche Fälle
unter `ohne_handbuch` ausdrücklich auf.

### Zwei Belegprüfungen statt einer

| Prüfung | Ort | Fängt ab |
|---|---|---|
| **Existenz** | `konsens.mjs`, `pruefeBeleg()` | erfundene Fundstellen |
| **Tragfähigkeit** | `belegprobe.mjs` | echte Fundstellen, die die Zuordnung nicht hergeben |

Die zweite ist neu. Ein getrennter Aufruf sieht **nur** Belegtext und Behauptung — ohne
Normtext, ohne die Begründung des ersten Laufs — und urteilt `stuetzt`, `neutral` oder
`widerspricht`. Bei `neutral` wird der Belegbonus zurückgenommen und der Beleg entfernt;
bei `widerspricht` sinkt die Konfidenz um 0,35 und die Spanne wird als strittig geführt.
Die zitierte Stelle muss zusätzlich wörtlich im Belegtext stehen.

Damit ist der zweite Fehlertyp der Stanford-Untersuchung adressiert, so weit das ohne
Menschen geht. Abschalten mit `--ohne-belegprobe`, wenn das Kontingent knapp wird.

### Konsistenzprüfung

`konsistenz.mjs` sucht Wendungen, die im Bestand widersprüchlich eingeordnet sind. Rein
rechnerisch, kein Modell, kein Netz, Sekunden. Im Testlauf über AO, EStG, UStG, KStG und
SolzG:

```
  „gilt entsprechend"
    tb 6× · rf 135×   →   Mehrheit: Rechtsfolge, 6 Ausreißer
      AO § 292 Abs. 2 Satz 1 — als Tatbestand (k=0.45, syntaktisch)
      …
  „gilt sinngemäß"
    tb 2× · rf 18×    →   Mehrheit: Rechtsfolge, 2 Ausreißer
```

Alle Ausreißer haben Konfidenz 0,45 — das Verfahren markiert also genau die Stellen, an
denen es selbst unsicher war. Das ist die billigste Fehlerquelle im ganzen Bestand.

### Frontend

Alle acht Punkte der UI-Analyse. Die wichtigsten:

- **Schema und Text sind gekoppelt.** Überfahren eines Schemaschritts hebt die
  Textstelle hervor, Klick springt hin und setzt einen Permalink `#/solzg/3/abs-3-satz-1`.
  Getestet an § 15 EStG: 46 Markierungen, alle mit Adresse, 45 gekoppelte Schemapunkte.
- **Lesespalte 34 rem** statt 44 (rund 68 statt 95 Zeichen je Zeile).
- **Markierung: Kante statt Fläche**, Regler mit drei Stufen (aus · dezent · voll).
- **Absatzleiste** am linken Rand mit mitlaufender Hervorhebung.
- **Statusband oben** statt nach dem Text.
- **Suche** versteht `15 estg`, `§ 15 EStG`, `estg 15` und Volltext mit Kontextausschnitt;
  `/` fokussiert, Pfeiltasten wählen, Enter öffnet.
- **Dunkelmodus** mit neu gewählten, nicht abgedunkelten Markierungsfarben; drei
  Schriftgrößen.
- **Mobil:** Gesetzeswahl als Liste, Schema über dem Text, feste Fußleiste mit den
  Markierungsschaltern.
- **Belege-Rubrik** unter jeder Norm; belegte Markierungen tragen ein `※`.

---

## Neue Befehle

```json
"annotieren":   "node tools/annotieren.mjs",
"aufwerten":    "node tools/annotieren.mjs --aufwerten",
"belege":       "node tools/belege.mjs",
"belege:karte": "node tools/belege.mjs --karte",
"konsistenz":   "node tools/konsistenz.mjs --schreiben",
"pruefen":      "node tools/pruefen.mjs",
"verweise":     "node tools/verweise.mjs",
"struktur":     "node tools/struktur.mjs",
"fassungen":    "node tools/fassungen.mjs",
"frontend":     "node tools/frontend-pruefen.mjs",
"browser":      "node tools/browser-pruefen.mjs",
"eval":         "node tools/eval.mjs"
```

Zusätzliche Schalter für `annotieren.mjs`: `--aufwerten`, `--ohne-belegprobe`,
`--ohne-gegenprobe`, `--ohne-ki`, `--laeufe N`, `--nur <gesetze>`, `--trocken`.

---

## Was das Verfahren nicht leistet

Steht ausführlich in `docs/03-richtigkeit-und-grenzen.md`. Das Wesentliche:

- **Nichts sichert die Richtigkeit.** Es gibt harte Garantien über die *Form* einer
  Markierung (Position, Rechtssatzzugehörigkeit, keine Fragmente — alles von
  `pruefen.mjs` überprüfbar) und starke Wahrscheinlichkeitsaussagen über die *Kategorie*.
  Juristische Richtigkeit ist davon keines.
- **Einstimmigkeit misst Stabilität, nicht Wahrheit.** Zwei Modelle mit überlappenden
  Trainingsdaten irren bei ungewöhnlichen Konstruktionen gleich.
- **Das Prüfungsschema ist eine strukturierte Wiedergabe des Normaufbaus**, kein Schema
  im juristischen Sinn. Es endet an der Normgrenze; die Reihenfolge ist gesetzt, nicht
  abgeleitet.
- **Es gibt weiterhin keine unabhängige Messung.** Der Weg dorthin ohne Handarbeit steht
  in Abschnitt 6.4 von `docs/03`: Testbeispiele aus den Verwaltungsanweisungen ernten
  („Voraussetzung ist, dass …").
- **Quellenanbindung halbiert Fehler, sie beseitigt sie nicht.** Stanford RegLab hat für
  Lexis+ AI 17 % und Westlaw AI-Assisted Research 33 % gemessen, beide mit RAG, beide mit
  „hallucination-free" beworben. Übernehmen Sie diese Formulierung nicht.

Behalten Sie den Statusstreifen und den Rechtshinweis im Fuß. Die ehrliche Formulierung
lautet: automatisch erzeugt, Verfahren benannt, nicht redaktionell geprüft, maßgeblich
ist der im Bundesgesetzblatt verkündete Wortlaut.

---

*Die Vorschläge betreffen Datenqualität und Gestaltung. Keine Rechtsberatung.*
