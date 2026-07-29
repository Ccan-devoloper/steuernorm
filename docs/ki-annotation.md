# Automatische Tatbestand-/Rechtsfolge-Annotation

Die Annotationen werden vollständig automatisiert erzeugt. Es gibt keine manuelle Freigabe.

## Verfahren

1. Der amtliche Normtext wird in Sätze und regeltypische Klauseln zerlegt.
2. Eine deterministische Regellogik erkennt Konditionen, Adressaten, Ausnahmen und typische Rechtswirkungsprädikate.
3. GitHub Models (`openai/gpt-4.1-mini`) analysiert mehrere Normen in strukturierten Batches.
4. Modellspannen werden nur akzeptiert, wenn sie wörtlich im gespeicherten Normtext vorkommen.
5. KI-Spannen werden mit der Regellogik verglichen. Reine KI-Spannen werden nur bei mindestens 90 Prozent Modellkonfidenz und bestätigtem Quellenkonsens übernommen.
6. Pro Norm muss die KI mindestens vier eindeutige Referenzen ausdrücklich als materiell stützend nennen und `quellen_konsens: true` liefern.
7. Jede Norm erhält eine Klassifikation, einen Text-Hash, eine Konfidenz und die tatsächlich als stützend genannten Quellen.

## Quellenpolitik

Die Konfiguration steht in `config/referenzquellen.json`. Verwendet werden insbesondere:

- amtlicher Gesetzestext aus „Gesetze im Internet“ beziehungsweise dessen täglich gepflegter XML-Spiegel,
- amtliche Handbücher, Richtlinien und BMF-Schreiben,
- Entscheidungen des Bundesfinanzhofs,
- „Rechtsprechung im Internet“ von BMJ/BfJ,
- Open Legal Data als zusätzliche maschinenlesbare Rechtsprechungsquelle.

Doppelte oder nur unterschiedlich benannte URLs zählen nicht mehrfach. Eine Annotation wird nur erzeugt, wenn mindestens vier unterschiedliche Referenz-URLs erreichbar sind und das Modell mindestens vier ihrer IDs ausdrücklich als überschneidend stützend nennt. Die Quellen werden nicht als Ersatz für den Gesetzestext verwendet; Textmarkierungen müssen immer exakte Spannen des amtlichen Normtexts sein.

## Automatische Wiederholung bei Gesetzesänderungen

Jede Norm besitzt `text_hash`. Nach dem täglichen Gesetzesabruf vergleicht die Pipeline den neuen normalisierten Text mit diesem Hash:

- unverändert: vorhandene Annotation bleibt bestehen, sofern ihre vier Referenzen noch erreichbar sind,
- verändert oder neu: KI-/Logikanalyse und Quellenkonsens werden erneut ausgeführt,
- weggefallen: die Annotation verschwindet beim Neuaufbau,
- unvollständiger Quellen-, KI- oder Konsenslauf: der Workflow schlägt fehl und veröffentlicht keinen Teilstand.

## Datenformat

Die Dateien unter `annotations/` bleiben mit der Website kompatibel. Zusätzlich zu `tb`, `rf`, `hinweis` und `schema` enthält jede Norm:

- `klassifikation`
- `status`
- `konfidenz`
- `text_hash`
- `pipeline_version`
- `modell`
- `konsens_methode`
- `quellen_konsens`
- `quellen`
- `quellen_support`
- `ausnahmen`
- `aktualisiert`

## Qualitätskontrolle

`node tools/pruefen-v2.mjs` prüft automatisiert:

- Annotation für jede einzelne Norm,
- mindestens vier ausdrücklich stützende Quellen je Norm,
- mindestens vier eindeutige Quellen-URLs,
- exakte Übereinstimmung aller Markierungen mit dem Normtext,
- aktuellen Text-Hash,
- gültige Klassifikation und Konfidenz,
- vollständiges Tatbestand-/Rechtsfolge-Paar bei normativen Klassen,
- keine verwaisten Annotationen nach Gesetzesänderungen.

Berichte werden nach `reports/annotation-coverage.json` und `reports/annotation-coverage.md` geschrieben.

## Ausführung

Pull Requests führen einen vollständigen Smoke-Test am Solidaritätszuschlaggesetz aus, ohne Daten zurückzuschreiben. Nach dem Merge erzeugt der Push auf `main` einmalig die Vollannotation. Der tägliche Gesetzesworkflow analysiert anschließend nur neue oder textlich geänderte Normen erneut.

## Grenzen

Tatbestand und Rechtsfolge sind juristische Strukturbegriffe. Bei komplexen Verweisungs-, Ausnahme- und Berechnungsvorschriften bleibt eine automatisierte Zuordnung probabilistisch. Die Daten legen deshalb Konfidenz, Quellen und Methode offen. Das Ergebnis ist eine didaktische Strukturierungshilfe und keine Rechtsberatung.
