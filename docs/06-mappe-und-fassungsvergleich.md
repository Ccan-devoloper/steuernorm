# Fassung 7 — Dunkelmodus, Sammelmappe, Fassungsvergleich

Fortsetzung des Übergabepakets. Fassung 6 hat die Oberfläche neu gebaut und
drei Dinge offen gelassen: den Dunkelmodus und die beiden Knöpfe „Mappe" und
„Vergleichen", die in der Kopfleiste standen, ohne etwas zu tun. Alle drei sind
jetzt angebunden, und dahinter liegt ein drittes Datenformat.

---

## 1. Kein Knopf ohne Funktion

Die Vorgabe war eindeutig: Was noch keine Daten hat, wird ausgegraut mit
erklärendem `title`, nicht klickbar ins Leere. Das gilt weiterhin — aber es
gilt jetzt pro Norm statt pauschal.

„Vergleichen" ist bedienbar, wenn `fassungen/<gesetz>.json` für die geöffnete
Norm mehr als einen Zeitstand kennt. Sonst nennt der Titel die Datei, in der
der zweite stünde: *„Von dieser Norm liegt nur ein Zeitstand vor
(fassungen/solzg.json)."* Auf dem Telefon erscheint der Schalter gar nicht,
wo er nichts kann — ein gesperrter Knopf kostet auf 390 px Platz, den er nicht
wert ist.

---

## 2. Die Mappe

Eine Sammelmappe für Normen und markierte Stellen, 392 px, hängt unter ihrem
Knopf; auf dem Telefon ein Blatt von unten.

Drei Regeln bestimmen alles Weitere:

**Es gibt immer mindestens eine Mappe.** Beim ersten Öffnen entsteht „Ohne
Titel". Wer die letzte löscht, bekommt sofort eine neue.

**Eine Markierung gehört genau einer Mappe.** Eine neu angelegte Markierung
landet von selbst in der zuletzt benutzten; der Fuß der Markierungskarte sagt,
in welcher — *„Nur für Sie sichtbar · Mappe ‚Ohne Titel'"*. Wer eine Mappe
löscht, wird gefragt und verliert die enthaltenen Markierungen mit.

**Löschen räumt beide Seiten auf.** Wird eine Markierung entfernt, verschwindet
ihr Mappeneintrag mit. Sonst bliebe ein Eintrag stehen, der auf nichts mehr
zeigt — die Anzeige käme damit zurecht, aber „Markierung nicht mehr im
Bestand" ist die Anzeige für verlorene Datensätze, nicht für gelöschte.

Markierungen aus der Zeit vor den Mappen werden beim ersten Start einsortiert.
Ohne das gäbe es Markierungen im Text, die in keiner Mappe auftauchen — die
Mappe sähe leer aus, obwohl markiert wurde.

Einträge degradieren wie überall sonst: Eine unbekannte Norm erscheint als
„Datensatz *Gesetz* ausstehend", eine verlorene Stelle als „Markierung nicht
mehr im Bestand". Übersprungen wird nichts.

Der Fuß sagt, was Sache ist: **Mappen liegen nur in diesem Browser.** Es gibt
kein Konto und keine Übertragung.

---

## 3. `fassungen/<gesetz>.json` — und woher die Fassungen kommen

Das dritte Datenformat war das eigentliche Problem. Ein Fassungsvergleich
braucht zwei Zeitstände derselben Norm; das Repository hatte keinen zweiten.
gesetze-im-internet.de liefert ausschließlich den geltenden Wortlaut. Eine
frühere Fassung abzutippen wäre erfundene Datenlage gewesen.

**Beschafft war sie längst.** Der Git-Verlauf von `data/<gesetz>.json` hält
jeden Stand fest, mit dem das Repository je gearbeitet hat. Jeder tägliche
Abruf ist ein datierter Zeitschnitt. Ändert sich der Wortlaut einer Norm
zwischen zwei Abrufen, sind das zwei Fassungen — beide echt, beide datiert,
beide im Repository nachweisbar. `tools/fassungen.mjs` liest genau das.

```
{ abk, erzeugt, quelle, hinweis,
  normen: { <normId>: { fassungen: [ { id, abgerufen, stand,
                                       aktuell?, enbez?, titel?,
                                       abs?, fussnote? } ] } } }
```

Jüngste zuerst. Die jüngste trägt `aktuell: true` und **keinen** Wortlaut — der
steht in `data/` und würde hier nur verdoppelt. Aufgenommen werden nur Normen
mit mehr als einer Fassung; alles andere wäre eine Kopie von `data/` unter
anderem Namen.

**Was das Datum bedeutet.** `abgerufen` ist der Tag, an dem der Text ins
Repository kam, **nicht** der Tag des Inkrafttretens. Wer zwischen zwei
Abrufen ändert, dessen Änderung erscheint am Tag des nächsten Abrufs. Die
amtliche Angabe steht daneben in `stand`; sie, nicht das Datum, sagt, welche
Fassung das ist. Die Ansicht zeigt beides, und der Fuß wiederholt es.

### Der Befund

Über alle 14 Gesetze und zwölf Abrufe hinweg gibt es **eine** Norm mit zwei
Zeitständen: **§ 16 GewStG (Hebesatz)**. Am 05.08.2026 wechselte die
Standangabe von „Art. 4 G v. 28.2.2025 I Nr. 69" auf „Art. 8 G v. 29.6.2026 I
Nr. 197"; hinzugekommen ist die Fußnote *(+++ § 16: Zur Anwendung vgl. § 36
+++)*.

Das ist kein gewählter Vorführfall, sondern der Bestand. Bei allen anderen
Normen bleibt der Knopf gesperrt — und wird es bleiben, bis sich etwas ändert.
Der Bestand wächst von selbst: `tools/fassungen.mjs` läuft im täglichen
Aktualisierungslauf mit, nach dem Commit der neuen Gesetzestexte.

Dafür musste der Lauf ein zweites Mal angefasst werden: `actions/checkout@v5`
holt voreingestellt einen einzigen Commit. Mit `fetch-depth: 0` sieht das
Werkzeug den ganzen Verlauf — ohne das fände es nie eine zweite Fassung.

---

## 4. Der Vergleich

Zwei Spalten, links immer die ältere. Die Spaltenköpfe kleben, damit auch weit
unten klar ist, welche Spalte welche Fassung zeigt.

Verglichen wird **wortweise**, über die längste gemeinsame Teilfolge. Vorher
werden gleiche Ränder abgeschnitten — geändert wird selten der ganze Absatz,
und das drückt die Tabelle auf einen Bruchteil. Über 1 200 Wörtern je Absatz
wird der Wortvergleich nicht mehr gerechnet, sondern der Absatz als Ganzes
ausgewiesen.

Absätze werden über die **Absatznummer** geordnet, nicht über die Reihenfolge.
Fällt einer weg oder kommt einer hinzu, verschöbe sich sonst alles danach und
der Vergleich zeigte lauter Änderungen, wo keine sind.

Entfallenes und Neues tragen Fläche **und** Kante **und** Strich beziehungsweise
Unterstreichung. Farbe allein trägt die Auskunft nicht, wenn sie nicht
unterschieden wird — und auf Papier bleiben im Graustufendruck nur Strich und
Fettung übrig.

**Struktur-Einfärbung und eigene Markierungen sind hier ausgeblendet.** Im
Vergleich zählt der Unterschied zwischen den Fassungen; drei weitere Farbebenen
darüber machen ihn unlesbar. Der Apparat entfällt ebenfalls: Er zeigt Hinweise
zur geltenden Fassung, und neben zwei Zeitständen ist nicht zu sagen, zu
welchem. Das Normenverzeichnis bleibt — man springt von hier zur nächsten Norm.

Der Wortvergleich ist maschinell und sagt es: *„Wortvergleich maschinell
erzeugt, nicht redaktionell geprüft."* Die Bilanz darunter nennt den Vorbehalt.

Die Ansicht steckt im Verweis (`#/gewstg/16/fassungen`) und lässt sich damit
verschicken.

---

## 5. Zwei Fallen im Text, dieselbe Ursache

Beim Vergleich muss aus dem amtlichen HTML reiner Text werden. Zweimal wäre
dabei beinahe eine Änderung gemeldet worden, die es nicht gibt.

**Benachbarte Elemente.** In den amtlichen Daten liegen Bedingung und Anordnung
als zwei benachbarte `<span>` vor; zwischen zwei Elementen setzt der Browser
kein Leerzeichen. Ohne eingefügte Trennung klebt „vorzunehmen ist:nach der"
zusammen, der Vergleich sieht ein Wort, wo zwei stehen — und jede Aufzählung
gälte als geändert. Dieselbe Stelle war in Fassung 6 schon in der Anzeige
aufgefallen.

**Satznummern.** `<span class="sn">2</span>Nach diesem Zeitpunkt` steht im
Quelltext ohne Abstand; in der Lesespalte trennt eine Marge, hier ein
Leerzeichen. Maßgeblich ist dabei `nextSibling`, nicht `nextElementSibling`:
Letzteres überspringt Text und träfe auch dort zu, wo die Nummer schon durch
den Satz davor getrennt ist — mit dem Ergebnis „1 Der Beschluss … 2Nach diesem",
also einmal richtig und einmal falsch.

---

## 6. Dunkelmodus

Beide Paletten liegen als Marken vor; umgeschaltet wird zwischen hell, dunkel
und System, voreingestellt ist `prefers-color-scheme`. Die Druckfassung bleibt
immer hell.

Der Anlass für die Strenge steht im Bestand: In der vorigen Fassung blieb die
Kopfleiste weiß, weil dort ein fester Hellwert stand, den der Moduswechsel
nicht erreichte. Eine Prüfung im Browser geht deshalb den Baum ab und meldet
jede helle Fläche, die den Dunkelmodus überstanden hat. Die Farben des
Vergleichs kommen aus denselben Marken wie die Struktur-Einfärbung und folgen
dem Modus damit von selbst.

---

## 7. Geprüft

`tools/frontend-pruefen.mjs` (jsdom, 27 Prüfungen) prüft die Datenanbindung,
`tools/browser-pruefen.mjs` (Chromium, 130 Prüfungen) alles, was Layout
braucht.

Neu darunter: Maß und Lage der Mappe, Schließen per Esc und Klick daneben, der
Neustart mit gefüllter Mappe, das Blatt auf 390 px; für den Vergleich der
Wortvergleich an Fällen mit bekannter Antwort (ein geändertes Wort, Einfügung,
Streichung), die beiden Textfallen aus Abschnitt 5, die Standangaben aus den
Daten, die Abwesenheit von Struktur und Markierungen, der gesperrte Knopf samt
Begründung, die Druckfassung und die gestapelte Ansicht auf dem Telefon.

Ein Fehler wurde im Bauen gefunden und ist behoben: `mappeZeichnen` deklarierte
`zahl` zweimal im selben Bereich — die ganze Datei lief nicht mehr. jsdom hat
es in einem Lauf gemeldet, ein Blick in den Browser hätte eine weiße Seite
gezeigt.

---

## 8. Was offen bleibt

- **Redaktionelle Anmerkungen je Absatz.** Kein Datensatz, keine Anzeige.
- **Fußnoten im Lesetext.** `data/` führt sie, die Lesespalte zeigt sie nicht.
  Im Fassungsvergleich erscheinen sie — dort war der einzige Unterschied im
  ganzen Bestand eine Fußnote, und ihn zu verschweigen wäre falsch gewesen.
- **Der Bestand ist weiterhin rein syntaktisch erzeugt.** `GEMINI_API_KEY` ist
  nicht gesetzt, `laeufe: 0`.
- **Frühere Fassungen als der erste Abruf** sind nicht erfasst und werden es
  nicht. Wer sie will, braucht eine Sammlung historischer Gesetzestexte; im
  Repository steht sie nicht.

Maßgeblich ist allein der im Bundesgesetzblatt verkündete Wortlaut.
