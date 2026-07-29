# steuernorm

Textausgabe der vierzehn Steuergesetze aus dem Screenshot, im Volltext, mit
zuschaltbaren Markierungen (Tatbestandsmerkmale gelb, Rechtsfolgen grün) und
Prüfungsschemata. Statisches HTML, kein Framework, kein Build.

**1.532 Normen** in AO, BewG, EStG, KStG, UStG, GewStG, ErbStG, GrStG, FGO,
GrEStG, UmwStG, AStG, SolzG und InvStG.

## Starten

Ein Browser darf über `file://` keine Daten nachladen. Also über einen Server:

```
python3 -m http.server 8000      # oder: npm start
```

Dann `http://localhost:8000`. Zum Veröffentlichen genügt jeder Statik-Hoster;
GitHub Pages, Netlify und Cloudflare Pages funktionieren ohne Konfiguration.

## Wie sich die Texte aktualisieren

Quelle ist **Gesetze im Internet** (Bundesministerium der Justiz und Bundesamt
für Justiz). Das Portal stellt unter `gii-toc.xml` ein tagesaktuelles
Inhaltsverzeichnis und je Gesetz ein `xml.zip` bereit — dieselbe Grundlage, aus
der auch dejure seine Texte zieht.

```
node tools/update.mjs              # alle Gesetze
node tools/update.mjs --nur estg,ustg
```

Das Skript lädt die XML-Dateien, wandelt sie in schlankes JSON unter `data/`
und schreibt ein Register `data/index.json`. Braucht `unzip` im Pfad.

`.github/workflows/gesetze-aktualisieren.yml` erledigt das täglich um 4:17 UTC
und schreibt Änderungen als Commit fest. Jede Gesetzesänderung wird damit zu
einem sichtbaren Diff — der Verlauf einer Norm lässt sich über `git log`
nachvollziehen.

> **Die mitgelieferten Daten sind ein Startbestand vom Winter 2024/2025.**
> Vor dem ersten Einsatz einmal `node tools/update.mjs` laufen lassen. Die
> Seite zeigt bei jeder Norm den Datenstand an und warnt sichtbar, sobald er
> älter als 90 Tage ist.

## Markierungen und Schemata

Getrennt vom Gesetzestext in `annotations/<gesetz>.json`, damit eine
Aktualisierung sie nicht überschreibt:

```json
{
  "abk": "EStG",
  "normen": {
    "15": {
      "tb": ["selbständige nachhaltige Betätigung"],
      "rf": ["ist Gewerbebetrieb"],
      "hinweis": "Ungeschriebenes negatives Merkmal: …",
      "schema": [
        { "n": "I.", "t": "Selbständigkeit", "art": "tb",
          "sub": ["Unternehmerrisiko und Unternehmerinitiative"] }
      ]
    }
  }
}
```

* `tb` und `rf` sind **wörtliche Auszüge aus dem amtlichen Text**. Die Seite
  sucht sie zur Laufzeit und legt die Markierung darüber.
* `art` färbt den Schemaschritt mit — so ist auf einen Blick zu sehen, welcher
  Prüfungspunkt welches Merkmal abarbeitet.
* Ändert der Gesetzgeber den Wortlaut, findet die Phrase ihre Stelle nicht
  mehr. Die Seite meldet das dann offen als verwaiste Markierung, statt still
  nichts anzuzeigen. `node tools/pruefen.mjs` meldet dasselbe im Terminal, der
  Workflow setzt daraus eine Warnung.

Derzeit annotiert: 25 Normen, 65 geprüfte Markierungen. Der Punkt im Register
zeigt, welche Normen schon Markierungen haben.

Nach dem Bearbeiten von `tools/annotationen.mjs`:

```
node tools/annotationen.mjs && node tools/pruefen.mjs
```

## Bedienung

| | |
|---|---|
| `/` | Suche fokussieren |
| `Esc` | Register schließen |
| Klick auf `§ 15 Abs. 2 EStG` im Text | springt zur Norm |
| `#/ustg/15` | Direktlink auf jede Norm |

Die Schalter für Tatbestand und Rechtsfolge lassen sich einzeln umlegen und
bleiben gespeichert.

## Aufbau

```
index.html                     die ganze Anwendung
data/                          erzeugt, nicht von Hand bearbeiten
annotations/                   kuratiert, von Hand gepflegt
tools/update.mjs               Gesetzestexte holen und wandeln
tools/annotationen.mjs         Annotationen erzeugen
tools/pruefen.mjs              Markierungen gegen den Text prüfen
```

Gesetze aufnehmen oder entfernen: die Liste `GESETZE` am Anfang von
`tools/update.mjs` bearbeiten. Der `slug` ist das Kürzel aus der URL bei
gesetze-im-internet.de, das Muster `ABK_MUSTER` in `index.html` steuert, welche
Abkürzungen im Text verlinkt werden.

## Rechtliches

Gesetzestexte sind amtliche Werke und nach § 5 Abs. 1 UrhG gemeinfrei. Die
Deep-Link-Verlinkung auf Gesetze im Internet ist ausdrücklich gestattet.
Maßgeblich ist allein die im Bundesgesetzblatt verkündete Fassung; diese Seite
ist eine Lesehilfe und keine Rechtsberatung. Markierungen, Hinweise und
Prüfungsschemata sind eine eigene didaktische Zutat und geben eine vertretbare,
nicht die einzige mögliche Auffassung wieder.
