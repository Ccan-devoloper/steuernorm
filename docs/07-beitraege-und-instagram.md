# 07 — Der Beitrag des Tages und der Weg auf Instagram

Fassung 8 · September 2026

---

## 1. Wozu

Der Bestand dieser Seite beantwortet für 1 537 Normen dieselben vier Fragen:
Was ordnet die Norm an, woran knüpft sie es, was sagt die Verwaltung dazu, wer
verweist darauf. Wer die Seite nicht kennt, stellt diese Fragen hier nie. Ein
Beitrag am Tag trägt jeweils eine Norm nach draußen — auf die Seite selbst
(`#/beitraege`) und in ein Netz, in dem Steuerrecht sonst als Meinung vorkommt
und nicht als Wortlaut.

Das ist die ganze Absicht. Es ist ausdrücklich **kein** Blog: Niemand
formuliert hier etwas, und ein Modell erst recht nicht.

---

## 2. Die eine Regel

> **Kein Satz eines Beitrags ist formuliert. Jeder steht wörtlich im Normtext
> oder in einer amtlichen Verwaltungsanweisung.**

Das ist keine Sparsamkeit, sondern die einzige Fassung, die zur Haltung dieses
Projekts passt. `docs/03-richtigkeit-und-grenzen.md` baut das ganze Verfahren
gegen plausible Falschaussagen auf: Belegprobe, Gegenprobe, Konsistenzlauf,
hartes Veto gegen unbrauchbare Spannen. Ein Modell, das über eine Norm frei
formuliert, erzeugt genau diese Falschaussagen wieder — nur diesmal ohne
Prüfer, mit Reichweite und unter dem Namen dieser Seite.

Deshalb ist `beitrag.mjs` ein **Zusammensteller**, kein Schreiber. Er kennt
kein Modell und braucht kein Netz. Er nimmt:

| Bestandteil | Herkunft |
|---|---|
| Wortlaut des Auszugs | `data/<gesetz>.json`, unverändert |
| Einfärbung des Auszugs | `struktur/<gesetz>.json` — Zeichenpositionen |
| Tatbestand · Rechtsfolge · Ausnahme | dieselben Spannen, mit Adresse |
| Verwaltungsanweisung | `belege/<gesetz>.json`, wörtlich, mit Fundstelle |
| „Wer darauf verweist" | `data/verweise.json` |
| Stand des Gesetzes | `data/index.json` |

Und `beitraege-pruefen.mjs` prüft die Regel nach, bevor irgendetwas hinausgeht:
Er baut den Normtext aus `data/` neu auf und sucht jeden Auszug darin, Zeichen
für Zeichen. Ein hinzugefügtes Wort — ein „zwingend" vor „aufzuheben" — lässt
den Lauf fehlschlagen.

---

## 3. Auswahl der Norm

Der Tag ist der Keim; gezogen wird berechenbar, nicht zufällig. Zwei Läufe am
selben Tag wählen dieselbe Norm, ein doppelter Lauf schreibt keinen zweiten
Beitrag.

Kandidat ist eine Norm nur, wenn sie

- zwischen 320 und 4 200 Zeichen lang ist (kürzer trägt keine Aussage, länger
  passt in kein Bild),
- mindestens zwei erkannte Spannen hat und
- darunter **eine Rechtsfolge** — ohne sie sagt der Beitrag nicht, was die Norm
  anordnet.

Das sind 957 der 1 537 Normen. Gewichtet wird nach Belegen (eine Norm mit
Verwaltungsanweisung zuerst) und nach Regel-Ausnahme-Bau. Dazu zwei
Ausgleiche:

- **Wurzelgewicht je Gesetz.** Die AO stellt 367 Kandidaten, das SolzG drei.
  Ohne Dämpfung wäre fast jeder fünfte Beitrag aus der AO.
- **Schonfrist.** Ein Gesetz, das in den letzten vier Beiträgen vorkam, wird
  zurückgestellt.

Eine Norm, die einmal erschienen ist, kommt nicht wieder — der Index führt
Buch.

---

## 4. Das Bild

Instagram nimmt keinen Text ohne Bild an. Das Bild ist deshalb kein Schmuck,
sondern die Trägerfläche des Zitats: 1 080 × 1 350 (4:5), gerendert in
Chromium mit den Schriften aus `schriften/`, mit derselben Einfärbung und
derselben Legende wie der Arbeitsplatz — und mit dem Hinweis im Fuß, dass die
Einfärbung maschinell ist.

Passt der Auszug nicht auf die Fläche, wird **satzweise** gekürzt, gemessen im
Browser, nie mitten im Satz. Zuerst geht der Verwaltungsauszug, dann der
Wortlaut.

JPEG, nicht PNG: Die Graph-Schnittstelle lehnt PNG mit „media type not
supported" ab.

---

## 5. Der Weg auf Instagram

Instagram hat keine Schnittstelle zum Hochladen einer Datei. Der einzige Weg
für ein Programm führt über die Graph-Schnittstelle von Meta und besteht aus
zwei Schritten:

```
1. POST /<konto>/media           image_url=… caption=…   →  creation_id
2. POST /<konto>/media_publish   creation_id=…           →  Beitrag
```

Dazwischen lädt **Meta** das Bild von der angegebenen Adresse — es wird nicht
mitgeschickt. Daraus folgt die Reihenfolge im Arbeitsablauf:

```
Beitrag schreiben → Bild rendern → prüfen → festschreiben und schieben
                                          → dann erst veröffentlichen
```

Übergeben wird die **Rohadresse genau dieses Commits**:

```
https://raw.githubusercontent.com/<nutzer>/<repo>/<sha>/beitraege/bilder/<id>.jpg
```

Sie antwortet sofort nach dem Push, liefert JPEG als JPEG aus und ändert sich
nie. Die Adresse auf GitHub Pages täte es auch — aber erst nach der nächsten
Veröffentlichung, und darauf zu warten hieße, den Lauf an einen zweiten
Arbeitsablauf zu hängen.

Der Container ist nicht sofort fertig; Meta lädt das Bild im Hintergrund.
`instagram.mjs` fragt `status_code` ab, bis `FINISHED` dasteht, und
veröffentlicht erst dann. Ein `media_publish` davor scheitert mit einer
Meldung, die etwas anderes behauptet.

**Ist das Repositorium privat**, ist die Rohadresse nicht öffentlich. Dann
trägt die Repositoriumsvariable `BILDBASIS` eine eigene öffentliche
Grundadresse (etwa die von GitHub Pages), und der Lauf nimmt diese.

---

## 6. Einrichtung, einmalig

Ohne diese fünf Schritte veröffentlicht der Lauf nichts. Er schreibt den
Beitrag trotzdem auf die Website und sagt in der Zusammenfassung, was fehlt.

1. **Instagram-Konto umstellen** auf *Unternehmen* oder *Creator*
   (App → Einstellungen → Konto → Kontotyp). Ein privates Konto kann nicht
   über die Schnittstelle veröffentlichen, egal welches Token vorliegt.
2. **Facebook-Seite anlegen und verbinden** (Instagram-App → Einstellungen →
   Verknüpfte Konten). Meta führt jedes Unternehmenskonto über eine Seite;
   ohne sie gibt es keinen Zugriff.
3. **Meta-App anlegen** unter <https://developers.facebook.com>, Typ
   *Business*, Produkt *Instagram Graph API* hinzufügen. Berechtigungen:
   `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`,
   `pages_show_list`.
4. **Langlebiges Token holen.** Das Token aus dem Graph-API-Explorer hält eine
   Stunde. Der Tausch in ein langlebiges (rund 60 Tage):

   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
       ?grant_type=fb_exchange_token
       &client_id=<app-id>
       &client_secret=<app-geheimnis>
       &fb_exchange_token=<kurzes-token>
   ```

5. **Kennnummer des Kontos** ermitteln — nicht der Benutzername:

   ```
   GET https://graph.facebook.com/v21.0/me/accounts?access_token=<token>
   GET https://graph.facebook.com/v21.0/<seiten-id>?fields=instagram_business_account&access_token=<token>
   ```

Dann in den Einstellungen des Repositoriums unter *Secrets and variables →
Actions*:

| Name | Art | Inhalt |
|---|---|---|
| `IG_TOKEN` | Secret | langlebiges Zugriffstoken |
| `IG_KONTO` | Secret | Kennnummer des Instagram-Kontos |
| `BILDBASIS` | Variable | nur nötig, wenn das Repositorium privat ist |

Probe, ohne etwas zu veröffentlichen:

```bash
IG_TOKEN=… IG_KONTO=… node tools/instagram.mjs --pruefen
IG_TOKEN=… IG_KONTO=… node tools/instagram.mjs --trocken
```

**Das Token läuft ab.** Rund 60 Tage nach Ausstellung, und dann bricht der
Lauf mit `Graph 190` ab. `--pruefen` nennt das Ablaufdatum. Wer den Termin
nicht im Kalender haben will, erneuert das Token vierteljährlich.

---

## 7. Der tägliche Lauf

`.github/workflows/beitraege.yml`, 06:10 UTC (08:10 MESZ, 07:10 MEZ).

```
Chromium bereitstellen
Beitrag zusammenstellen      tools/beitrag.mjs
Bild rendern                 tools/beitrag-bild.mjs
Beitrag prüfen               tools/beitraege-pruefen.mjs   ← bricht ab, wenn etwas nicht stimmt
Festschreiben und schieben   Commit auf main
Auf Instagram veröffentlichen tools/instagram.mjs
Veröffentlichungsstand festschreiben
```

Von Hand, mit Feldern für Datum, Norm, Ersetzen und „nur Website":
*Actions → Beitrag des Tages → Run workflow*.

Die Gruppe bricht **nicht** ab (`cancel-in-progress: false`): Ein Lauf, der
zwischen „Bild geschoben" und „veröffentlicht" abgeräumt wird, hinterlässt
einen Beitrag ohne Bild.

Der Beitrag geht anschließend über den bestehenden Pages-Lauf online; die
Änderung an `beitraege/**` löst ihn aus.

---

## 8. Von Hand

```bash
node tools/beitrag.mjs                     # Beitrag für heute
node tools/beitrag.mjs --datum 2026-09-06
node tools/beitrag.mjs --norm estg/15      # bestimmte Norm
node tools/beitrag.mjs --nachholen 7       # die letzten sieben Tage füllen
node tools/beitrag.mjs --neu               # heutigen Beitrag ersetzen
node tools/beitrag.mjs --trocken           # nichts schreiben, alles zeigen

npm install --no-save playwright
node tools/beitrag-bild.mjs                # alle Beiträge ohne Bild
node tools/beitrag-bild.mjs --alle         # auch vorhandene neu rendern

node tools/beitraege-pruefen.mjs
node tools/beitraege-pruefen.mjs --ohne-bilder

IG_TOKEN=… IG_KONTO=… IG_BILDBASIS=https://… node tools/instagram.mjs
```

---

## 9. Was das nicht leistet

- **Es ersetzt keine Redaktion.** Die Auswahl der Norm ist berechnet, der
  Zuschnitt der Auszüge maschinell. Ein Auszug kann an einer Stelle enden, an
  der ein Mensch weitergelesen hätte.
- **Die Einfärbung im Bild ist die Erkennung, nicht die Wahrheit.** Sie steht
  unter demselben Vorbehalt wie im Arbeitsplatz, und der Vorbehalt steht auf
  jedem Bild.
- **Ein Anfang eines Satzes bleibt ein Anfang.** Bauteile sind Spannen im
  Satz; unter der Überschrift „Rechtsfolge" steht deshalb manchmal ein
  Halbsatz, der erst mit dem Wortlaut darüber vollständig wird. Die Untergrenze
  von 45 Zeichen hält die Splitter draußen, macht aus Spannen aber keine Sätze.
- **Reichweite ist keine Zustimmung.** Ein Beitrag, der oft gesehen wird, ist
  deshalb nicht richtiger. Der Rechtshinweis bleibt unter jedem Beitrag und in
  jeder Bildunterschrift.

---

*Automatisch erzeugt, Verfahren benannt, nicht redaktionell geprüft.
Maßgeblich ist der im Bundesgesetzblatt verkündete Wortlaut. Keine
Rechtsberatung.*
