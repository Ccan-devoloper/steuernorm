# Automatische Tatbestand-/Rechtsfolge-Annotation

Die Annotationen werden vollständig automatisiert erzeugt. Es gibt keine manuelle Freigabe.

## Verfahren

1. Der amtliche Normtext wird in Sätze und regeltypische Klauseln zerlegt.
2. Eine deterministische Regellogik erkennt Konditionen, Adressaten, Ausnahmen und typische Rechtswirkungsprädikate.
3. GitHub Models (`openai/gpt-4.1-mini`) analysiert die Normen in strukturierten, größenbegrenzten Batches.
4. Sehr lange Normen werden in zusammenhängende Textteile zerlegt und anschließend wieder zu genau einer Normannotation vereinigt.
5. Modellspannen werden nur akzeptiert, wenn sie wörtlich im gespeicherten Normtext vorkommen.
6. KI-Spannen werden mit der Regellogik verglichen. Reine KI-Spannen werden nur bei mindestens 90 Prozent Modellkonfidenz und einem unmittelbaren Quellenbeleg übernommen.
7. Jede Norm erhält eine Klassifikation, einen Text-Hash, eine Konfidenz und transparente Quellenangaben.

## Quellenpolitik

Die Konfiguration steht in `config/referenzquellen.json`. Verwendet werden insbesondere:

- amtlicher Gesetzestext aus „Gesetze im Internet“ beziehungsweise dessen täglich gepflegter XML-Spiegel,
- amtliche Handbücher, Richtlinien und BMF-Schreiben,
- Entscheidungen des Bundesfinanzhofs,
- „Rechtsprechung im Internet“ von BMJ/BfJ,
- Open Legal Data als zusätzliche maschinenlesbare Rechtsprechungsquelle.

Doppelte oder nur unterschiedlich benannte URLs zählen nicht mehrfach. Für jedes Gesetz müssen mindestens vier unterschiedliche Referenzen erreichbar und inhaltlich relevant sein. Davon getrennt speichert jede Norm in `quellen_support` nur diejenigen Referenzen, die das Modell als unmittelbare Stütze der konkreten Normzuordnung nennt. Damit wird nicht fälschlich behauptet, jede einzelne Spezialvorschrift werde in vier Sekundärquellen wörtlich behandelt.

Die Quellen ersetzen den amtlichen Gesetzestext nicht. Tatbestand, Rechtsfolge und Ausnahmen müssen immer exakte Spannen dieses Textes sein.

## Automatische Wiederholung bei Gesetzesänderungen

Jede Norm besitzt `text_hash`. Nach dem täglichen Gesetzesabruf vergleicht die Pipeline den neuen normalisierten Text mit diesem Hash:

- unverändert: eine aktuelle v2-Annotation bleibt bestehen,
- verändert oder neu: KI-/Logikanalyse und Quellenprüfung werden erneut ausgeführt,
- weggefallen: verwaiste Annotationen werden nicht in die neue finale Datei übernommen,
- unvollständiger Quellen- oder Modelllauf: die bisherige veröffentlichte Annotation bleibt bestehen; die neue Arbeit verbleibt im Zwischenstand.

Der Gesetzesworkflow aktualisiert die Texte täglich um 04:17 Uhr UTC. Der getrennte KI-Workflow beginnt um 05:10 Uhr UTC und erkennt geänderte Normen über ihre Hashes.

## Kosten- und Kontingentschutz

Der produktive Lauf ist auf höchstens 40 Modellanforderungen pro Tagesetappe begrenzt. Nach jedem vollständig bearbeiteten Normblock wird ein Zwischenstand unter `.ki-fortschritt/` gespeichert. Wird das Tagesbudget oder ein GitHub-Models-Kontingent erreicht, endet der Workflow erfolgreich, veröffentlicht den geprüften Zwischenstand und setzt am Folgetag automatisch fort.

Erst wenn alle Normen eines Gesetzes bearbeitet wurden, wird dessen Datei atomar nach `annotations/` übernommen. So erscheinen niemals halb erzeugte v2-Dateien als vollständig.

## Datenformat

Die Dateien unter `annotations/` bleiben mit der Website kompatibel. Zusätzlich zu `tb`, `rf`, `hinweis` und `schema` enthält jede Norm:

- `klassifikation`
- `status`
- `konfidenz`
- `text_hash`
- `pipeline_version`
- `modell`
- `konsens_methode`
- `gesetz_quellen_konsens`
- `gesetz_quellen`
- `quellen_konsens`
- `quellen`
- `quellen_support`
- `ausnahmen`
- `aktualisiert`

## Qualitätskontrolle

`node tools/pruefen-v2.mjs` prüft eine vollständig erzeugte Gesetzesdatei:

- Annotation für jede einzelne Norm,
- mindestens vier eindeutige Referenzen je Gesetz,
- Übereinstimmung von Referenz-IDs und Quelldatensätzen,
- exakte Übereinstimmung aller Markierungen mit dem Normtext,
- aktuellen Text-Hash,
- gültige Klassifikation und Konfidenz,
- vollständiges Tatbestand-/Rechtsfolge-Paar bei normativen Klassen,
- keine verwaisten Annotationen.

`node tools/pruefen-fortschritt.mjs` wendet dieselben inhaltlichen Prüfungen auf abgeschlossene v2-Dateien und noch unvollständige Tagesetappen an, ohne bei einem ordnungsgemäß gekennzeichneten Zwischenstand bereits Vollständigkeit zu verlangen.

## Test und Ausführung

Pull Requests führen einen vollständigen Smoke-Test am Solidaritätszuschlaggesetz aus, ohne Daten zurückzuschreiben. Der erfolgreiche Test umfasst derzeit sechs Normen, davon fünf mit klassischer Tatbestand-/Rechtsfolge-Struktur, 115 exakte Textmarkierungen sowie null Prüfungsfehler.

Nach dem Merge startet der Aufbau automatisch und wird täglich fortgesetzt. Gesetzesänderungen werden durch denselben Mechanismus inkrementell nachgezogen.

## Grenzen

Tatbestand und Rechtsfolge sind juristische Strukturbegriffe. Bei komplexen Verweisungs-, Ausnahme- und Berechnungsvorschriften bleibt eine automatisierte Zuordnung probabilistisch. Die Daten legen deshalb Konfidenz, Quellen und Methode offen. Das Ergebnis ist eine didaktische Strukturierungshilfe und keine Rechtsberatung.
