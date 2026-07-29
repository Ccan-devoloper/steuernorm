# Automatische Tatbestand-/Rechtsfolge-Annotation

Die Annotationen werden vollständig automatisiert erzeugt. Es gibt keine manuelle Freigabe.

## Verfahren

1. Der amtliche Normtext wird in Sätze und regeltypische Klauseln zerlegt.
2. Eine deterministische Regellogik erkennt Konditionen, Adressaten, Ausnahmen und typische Rechtswirkungsprädikate.
3. GitHub Models (`openai/gpt-4.1-mini`) analysiert mehrere Normen in strukturierten Batches.
4. Modellspannen werden nur akzeptiert, wenn sie wörtlich im gespeicherten Normtext vorkommen.
5. KI-Ergebnis und Regellogik werden vereinigt; Übereinstimmungen erhöhen die Konfidenz.
6. Pro Gesetz müssen mindestens vier unabhängige Quellenklassen erreichbar sein.
7. Jede Norm erhält eine Klassifikation, einen Text-Hash, eine Konfidenz und die verwendeten Quellen.

## Quellenpolitik

Die Konfiguration steht in `config/referenzquellen.json`. Verwendet werden insbesondere:

- amtlicher Gesetzestext aus „Gesetze im Internet“ beziehungsweise dessen täglich gepflegter XML-Spiegel,
- amtliche Handbücher, Richtlinien und BMF-Schreiben,
- Entscheidungen des Bundesfinanzhofs,
- „Rechtsprechung im Internet“ von BMJ/BfJ,
- Open Legal Data als zusätzliche maschinenlesbare Rechtsprechungsquelle.

Eine Annotation wird nur erzeugt, wenn mindestens vier Referenzen für das jeweilige Gesetz erreichbar sind. Die Quellen werden nicht als Ersatz für den Gesetzestext verwendet; Textmarkierungen müssen immer exakte Spannen des amtlichen Normtexts sein.

## Automatische Wiederholung bei Gesetzesänderungen

Jede Norm besitzt `text_hash`. Nach dem täglichen Gesetzesabruf vergleicht die Pipeline den neuen normalisierten Text mit diesem Hash:

- unverändert: vorhandene Annotation bleibt bestehen,
- verändert oder neu: KI-/Logikanalyse wird erneut ausgeführt,
- weggefallen: die Annotation verschwindet beim Neuaufbau,
- unvollständiger Quellen- oder KI-Lauf: der Workflow schlägt fehl und veröffentlicht keinen Teilstand.

## Datenformat

Die Dateien unter `annotations/` bleiben mit der Website kompatibel. Zusätzlich zu `tb`, `rf`, `hinweis` und `schema` enthält jede Norm:

- `klassifikation`
- `status`
- `konfidenz`
- `text_hash`
- `pipeline_version`
- `modell`
- `quellen`
- `quellen_support`
- `ausnahmen`
- `aktualisiert`

## Qualitätskontrolle

`node tools/pruefen-v2.mjs` prüft automatisiert:

- Annotation für jede einzelne Norm,
- mindestens vier Quellen je Norm,
- exakte Übereinstimmung aller Markierungen mit dem Normtext,
- aktuellen Text-Hash,
- gültige Klassifikation und Konfidenz,
- vollständiges Tatbestand-/Rechtsfolge-Paar bei normativen Klassen.

Berichte werden nach `reports/annotation-coverage.json` und `reports/annotation-coverage.md` geschrieben.

## Grenzen

Tatbestand und Rechtsfolge sind juristische Strukturbegriffe. Bei komplexen Verweisungs-, Ausnahme- und Berechnungsvorschriften bleibt eine automatisierte Zuordnung probabilistisch. Die Website weist deshalb Konfidenz, Quellen und Methode aus. Sie ist eine didaktische Strukturierungshilfe und keine Rechtsberatung.
