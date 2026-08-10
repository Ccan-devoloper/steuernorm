# Fassung 6 — Oberfläche „Arbeitsplatz"

Umsetzung des Übergabepakets `design_handoff_arbeitsplatz`. Die Oberfläche ist
neu gebaut; die Datenschicht bleibt, wo sie war, und wächst um zwei Formate.

Leitbild ist der Arbeitsplatz: mehrere Normen gleichzeitig geöffnet, links das
Gesetz, in der Mitte der Lesetext, rechts ein Apparat in Registern. Alles, was
nicht Normtext ist, sitzt im Apparat, damit der Lesetext Luft behält.

---

## 1. Die vier Regeln, an denen alles gemessen wurde

**Der Normtext bleibt unangetastet.** Es wird ausschließlich umschlossen — nie
ergänzt, gekürzt oder umgestellt. Eine Prüfung im Browser hält fest, dass die
Wörter „Tatbestand" und „Rechtsfolge" im Wortlaut nicht vorkommen und dass § 3
SolzG mit „Der Solidaritätszuschlag bemisst sich" beginnt.

**Keine erfundenen Daten.** Normenzahlen, Titel, Absatznummern und Wortlaute
kommen aus `data/`. Die Fassungsangabe wird aus dem Standtext gelesen, nicht
gesetzt. Was fehlt, wird als fehlend ausgewiesen.

**Drei Auszeichnungsebenen bleiben unterscheidbar.**

| Ebene | Kodierung | Warum diese |
|---|---|---|
| Maschinelle Struktur | Fläche + `box-shadow` gleicher Farbe | Die Tönung muss über die Zeilenhöhe hinausgehen, sonst wirken die Zeilen zerschnitten |
| Eigene Markierung | Fläche 45 % + farbige Unterkante | Bleibt über der Struktur erkennbar |
| Verwaltungsstelle | Punktlinie + Mono-Chip | Keine Fläche — bleibt unter beiden anderen sichtbar |

Sie liegen übereinander, ohne sich zu löschen: Die Spannenmaschinerie führt je
Zeichen eine Liste, nicht eine einzelne Spanne.

**Alles Maschinelle ist gekennzeichnet**, und der Haftungssatz steht in jedem
Register mit Hinweisen sowie in der Druckfassung.

---

## 2. Zwei neue Datenformate

### `struktur/<gesetz>.json`

Erzeugt von `tools/struktur.mjs` aus `annotations/`:

```
{ normId: { segmente: [ { typ, von, bis, pfad, konfidenz } ] } }
```

Die Zeichenpositionen beziehen sich auf den kanonischen Volltext der Norm, wie
`gliederung.mjs` ihn bildet. Das Frontend baut dieselbe Zeichenkette aus dem
DOM auf und führt eine Karte Zeichen → Textknoten mit. **Nur wenn beide Seiten
identisch rechnen, sitzen die Farben richtig** — weicht eine ab, verschiebt
sich alles ab der ersten Abweichung.

Für alle 14 Gesetze: 1 412 Normen, 27 133 Segmente, 2,3 MB — gegenüber 30 MB
Annotationen. Übernommen werden nur die drei Kategorien der Legende; das
Definiendum bleibt draußen, weil die Legende keine Marke dafür hat.

### `verwaltung/<gesetz>.json`

Zuordnung von Richtlinien und BMF-Schreiben zu Textstellen. Verankert wird über
den Wortlaut samt Umgebung, nicht über Zeichenpositionen.

Die Datei für SolzG ist ein **Beispieldatensatz** und sagt das von sich aus:
`beispiel: true` und ein Hinweis, den das Register an die erste Stelle stellt.
Die beiden Einträge stammen aus dem Gestaltungsentwurf und sind nicht gegen die
amtlichen Fundstellen geprüft.

---

## 3. Wo der Entwurf nicht auf die Daten passte

Drei Stellen, an denen Entwurf und Bestand auseinandergingen. In allen dreien
haben die Daten recht behalten.

**„vorbehaltlich der Absätze 2 bis 5" war nicht markiert.** Der Entwurf ordnet
es der Ausnahme zu, die Legende heißt „Ausnahme / Vorbehalt". Die Erkennung sah
das seit Fassung 5 anders: Der Vorbehalt galt als bloße Konkurrenzregel.

Der Grund war technisch, nicht juristisch — ohne Entflechtung lag der Vorbehalt
mitten in der Rechtsfolge und erzeugte zwei Kategorien auf denselben Zeichen.
Diese Entflechtung gibt es inzwischen. Der Vorbehalt ist als eigene Bauform
wieder aufgenommen, begrenzt auf seine Nominalphrase. § 3 Abs. 1 SolzG liest
sich damit wie im Entwurf.

**Der Anker der LStR-Stelle gibt es nicht.** Der Entwurf verankert an
„Lohnsteuer für laufenden Arbeitslohn". In der geltenden Fassung steht dort
„berechneten Lohnsteuer für a) laufenden Arbeitslohn, …" — der Entwurf zeigt
eine Fassung ohne die Unterliste. Verankert ist am tatsächlichen Wortlaut.

**Die Anmerkungen je Absatz gibt es nicht.** Der Entwurf zeigt Sätze wie „Zu
Absatz 1: Sechs Anknüpfungen, jeweils Voraussetzung → Bemessungsgröße." Das ist
Entwurfstext; im Repository steht er nirgends. Er ist nicht abgetippt, sondern
als fehlender Datensatz ausgewiesen — mit der Datei, in der er stünde.

---

## 4. Befunde aus dem Bestand

**72 % der Verwaltungsauszüge beginnen mit Bedienelementen.** 728 von 1 005
Auszügen in `belege/` fangen mit „aufklappen Zuklappen" an — den Schaltflächen
der BMF-Handbuchseite, die beim Abruf mitgelesen wurden. Sie lassen jeden
Auszug so aussehen, als begänne die Richtlinie damit. Die Anzeige entfernt
diese Seitenmöblierung; `belege/` bleibt unverändert. **Die Ursache sitzt im
Abrufwerkzeug und gehört dort behoben.**

**Verweise auf ausgeschriebene Gesetzesnamen zeigten ins Leere.** Die bisherige
Erkennung kannte nur Kürzel („§ 32d EStG"). Im Gesetzestext ist das die
Ausnahme: Das SolzG verweist auf „§ 43b des Einkommensteuergesetzes". Solche
Verweise galten als Verweise auf das eigene Gesetz und führten auf § 43b SolzG
— eine Norm, die es nicht gibt. Erkannt wird jetzt auch der ausgeschriebene
Name, und vor dem Verlinken wird geprüft, ob es die Zielnorm gibt.

**Aufzählungsglieder wurden ohne Leerzeichen angezeigt.** In den amtlichen
Daten liegen Bedingung und Anordnung als zwei benachbarte `<span>` vor;
zwischen zwei Elementen setzt der Browser kein Leerzeichen. Angezeigt wurde
„vorzunehmen ist:nach der". Das Leerzeichen der verkündeten Fassung ist als
Elementtrennung wiederhergestellt.

---

## 5. Was nur ein Browser beantwortet

`tools/browser-pruefen.mjs` (65 Prüfungen) ergänzt `frontend-pruefen.mjs`
(17 Prüfungen in jsdom). Der Anlass steht in Fassung 5: `text-wrap:pretty`
brachte den Renderer zum Absturz, und jsdom sah davon nichts, weil es kein
Layout berechnet.

Geprüft werden Spaltenmaße (216 / flexibel / 340, Lesespalte 576 px),
Absturzfreiheit über elf Normen und drei Ansichten, waagerechter Überlauf bei
1440, 1200, 1024 und 390 px, die Zuordnung der Einfärbung an § 3 SolzG, das
Verhalten der Farbwahl, Blatt und Werkzeugleiste auf Mobil, die Druckfassung
und der Betrieb ohne Netz.

Zwei Fehler hat sie im Bauen gefunden: Die Kopfleiste lief bei 1024 px über den
Rand (Flexkind ohne `min-width:0`), und das Blatt spannte sich von oben nach
unten, weil `top:0` aus der Grundregel der klebenden Spalte stehen blieb.

---

## 6. Schriften und Offlinebetrieb

Die Schriften liegen im Repository (`schriften/`, 348 KB, nur latin und
latin-ext), nicht bei Google. Zwei Gründe: Die Seite arbeitet ohne Netz — von
dort kämen sie dann nicht, und der Normtext fiele auf eine Systemschrift
zurück, womit Zeilenfall und Spaltenbreite nicht mehr stimmen. Und es geht bei
jedem Aufruf eine Anfrage weniger an einen Dritten.

Erneuern mit `node tools/schriften-holen.mjs`. Lizenz: SIL OFL 1.1, siehe
`schriften/LIZENZ.txt`.

Der Service Worker hält Schriften, Gesetze, Annotationen, Belege, Struktur und
Verwaltung offline vor — jeweils beim ersten Lesen, nicht vorab.

---

## 7. Was offen ist

- **Dunkelmodus.** Die Spezifikation nennt eine Palette, keine zweite. Die
  bisherige Fassung hatte einen; er ist entfallen, weil es keine abgestimmten
  Dunkelwerte für die drei Struktur-Töne gibt. Eine Farbe zu erfinden, die über
  Lesetext liegt und 7:1 halten muss, wäre geraten.
- **Mappe und Vergleichen.** Die beiden Knöpfe stehen im Entwurf und in der
  Kopfleiste; hinter ihnen liegt noch nichts.
- **Redaktionelle Anmerkungen je Absatz.** Kein Datensatz, keine Anzeige.
- **Der Bestand ist weiterhin rein syntaktisch erzeugt.** `GEMINI_API_KEY` ist
  nicht gesetzt, `laeufe: 0`. Die Struktur-Einfärbung zeigt damit, was die
  Syntaxanalyse allein hergibt.

Maßgeblich ist allein der im Bundesgesetzblatt verkündete Wortlaut.
