# steuernorm

Statische Textausgabe von 14 deutschen Steuergesetzen mit vollautomatisch erzeugten, positionsgebundenen Markierungen für Tatbestand, Rechtsfolge und Ausnahmen.

## Version 3

Die Annotationspipeline verwendet:

- strukturerhaltende Zerlegung in adressierte Rechtssätze,
- deterministische deutsche Satzgliedanalyse,
- harte Validatoren als technisches Veto,
- mehrere unabhängige GitHub-Models-Läufe,
- eine getrennte Gegenprobe,
- gemessene Übereinstimmung statt modellseitiger Selbsteinschätzung,
- Zeichenpositionen statt globaler Phrasensuche.

Die vollständige technische Beschreibung, Messwerte, Datenstruktur und Grenzen des Verfahrens stehen in [`README-v3.md`](README-v3.md).

## Lokal starten

```bash
npm start
```

Danach ist die Anwendung unter `http://localhost:8000` erreichbar.

## Gesetzestexte aktualisieren

```bash
npm run update
```

Der tägliche GitHub-Actions-Lauf vergleicht die amtlichen Gesetzesdaten und schreibt nur tatsächliche Änderungen fest.

## Annotationen

Deterministische Baseline ohne Modellaufrufe:

```bash
npm run annotieren -- --ohne-ki
npm run pruefen -- --streng
```

Mehrfachmodell-Lauf mit Gegenprobe:

```bash
npm run annotieren
npm run pruefen -- --streng
```

Unveränderte Normen werden über ihren Text-Hash übernommen. Geänderte Normen werden automatisch neu verarbeitet; bei erschöpftem Modellkontingent wird ein fortsetzbarer Zwischenstand unter `.fortschritt/` gespeichert.

## Rechtliches

Maßgeblich ist ausschließlich die im Bundesgesetzblatt verkündete Gesetzesfassung. Die Markierungen sind eine automatisierte Strukturierungshilfe, nicht redaktionell geprüft und keine Rechtsberatung.
