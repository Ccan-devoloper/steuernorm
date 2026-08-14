#!/usr/bin/env node
/**
 * frontend-pruefen.mjs — schnelle Prüfung der Datenanbindung ohne Browser.
 *
 * Das Frontend ist eine einzelne HTML-Datei ohne Bauschritt; ein Tippfehler im
 * Skript fällt sonst erst im Browser auf. Der Lauf lädt index.html in jsdom,
 * bedient `fetch` aus dem Dateisystem und prüft, dass die richtigen Daten an
 * den richtigen Stellen ankommen.
 *
 * Was jsdom NICHT kann: Layout. Maße, Überlauf und Absturzfreiheit prüft
 * `tools/browser-pruefen.mjs` in einem echten Browser.
 *
 *   npm install --no-save jsdom
 *   node tools/frontend-pruefen.mjs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

const WURZEL = path.resolve(import.meta.dirname, "..");
const html = await readFile(path.join(WURZEL, "index.html"), "utf8");
const speicher = new Map();

const dom = new JSDOM(html, {
  url: "https://example.org/#/solzg/3",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  resources: undefined,          // keine externen Schriften laden
  beforeParse(fenster) {
    fenster.fetch = async (pfad) => {
      const datei = String(pfad).replace(/^\.?\//, "");
      try {
        const inhalt = await readFile(path.join(WURZEL, datei), "utf8");
        return { ok: true, status: 200, json: async () => JSON.parse(inhalt) };
      } catch (e) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    };
    fenster.localStorage.__proto__.setItem = function (k, v) { speicher.set(k, String(v)); };
    fenster.localStorage.__proto__.getItem = function (k) { return speicher.has(k) ? speicher.get(k) : null; };
    fenster.scrollTo = () => {};
  },
});

const { window } = dom;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
await warte(2200);
const d = window.document;

const pruef = [];
const ok = (name, bedingung, zusatz = "") => pruef.push({ name, bestanden: Boolean(bedingung), zusatz });

/* `S` und die Funktionen des Frontends sind `const` im Skriptkopf und liegen
   damit im lexikalischen Globalbereich, nicht am `window`. Erreichbar sind sie
   über `eval` im selben Bereich. */
const js = (ausdruck) => window.eval(ausdruck);

/* ── Grundraster ── */
ok("Kein Ladefehler", !d.querySelector(".melder"));
ok("Kopfleiste vorhanden", d.querySelector(".kopf .wortmarke"));
ok("Reiterleiste vorhanden", d.querySelectorAll(".reiter").length >= 1,
  d.querySelectorAll(".reiter").length + " Reiter");
ok("Drei Spalten vorhanden",
  d.querySelector(".navspalte") && d.querySelector(".hauptspalte") && d.querySelector(".apparat"));

/* ── Daten aus data/, nicht aus dem Entwurf ── */
const etikett = (d.querySelector(".navspalte .mono-etikett") || {}).textContent;
ok("Normenzahl aus den Daten", etikett === "SolzG · 6 Normen", etikett);
ok("Sechs Normzeilen", d.querySelectorAll(".normzeile").length === 6);
ok("Überschrift aus den Daten",
  (d.querySelector("h1") || {}).textContent === "§ 3 Bemessungsgrundlage und zeitliche Anwendung",
  (d.querySelector("h1") || {}).textContent);
const rinne = [...d.querySelectorAll(".rinne button")].map((b) => b.textContent).join(" ");
ok("Absatzrinne aus den Daten", rinne === "(1) (2) (2a) (3) (4) (4a) (5)", rinne);

/* Die Fassungsangabe wird aus dem Standtext gelesen, nicht gesetzt. */
const etiketten = [...d.querySelectorAll(".meta .etikett")].map((x) => x.textContent);
ok("Fassung aus dem Standtext", etiketten.some((t) => t === "Fassung 23.12.2024"), etiketten.join(" · "));
ok("Maschinelle Zutat gekennzeichnet",
  (d.querySelector(".meta") || {}).textContent.includes("nicht redaktionell geprüft"));

/* ── Der Wortlaut bleibt unangetastet ──
   Maßgeblich ist der KANONISCHE Volltext, den `textindex` bildet — auf ihm
   rechnen Struktur-Einfärbung, Markierungen und Verwaltungsstellen. Die
   Anzeige darf Adressen tragen (Absatz- und Satznummern), der kanonische Text
   nicht: Jedes zusätzliche Zeichen dort verschöbe die Farben. */
const angezeigt = (d.querySelector(".lesespalte") || {}).textContent || "";
const kanonisch = js("textindex(document.querySelector('.lesespalte')).text");
ok("Keine Kategorienamen im Wortlaut", !/\b(Tatbestand|Rechtsfolge)\b/.test(angezeigt));
ok("Wortlaut beginnt wie im Gesetz",
  kanonisch.trim().startsWith("Der Solidaritätszuschlag bemisst sich vorbehaltlich der Absätze 2 bis 5"),
  kanonisch.trim().slice(0, 50));

/* ── Absatzbezeichnung steht im Text ── */
const absatzmarken = [...d.querySelectorAll(".lesespalte .an")].map((x) => x.textContent);
ok("Jeder Absatz trägt seine Bezeichnung",
  absatzmarken.join(" ") === "(1) (2) (2a) (3) (4) (4a) (5)", absatzmarken.join(" "));
ok("Die Bezeichnung steht vor dem Wortlaut",
  angezeigt.trim().startsWith("(1)"), angezeigt.trim().slice(0, 20));
ok("Die Bezeichnung bleibt aus dem kanonischen Text heraus",
  !kanonisch.includes("(2a)"), kanonisch.slice(0, 0));

/* ── Satznummern ──
   Die amtlichen Daten führen sie nur bei 260 von 1 537 Normen. Wo sie fehlen,
   werden sie aus `struktur/<gesetz>.json` gesetzt — aus derselben Gliederung,
   die auch die Fundstellen bildet. */
const satzmarken = [...d.querySelectorAll(".lesespalte .sn")];
ok("Satznummern stehen im Text", satzmarken.length > 0, satzmarken.length + " Nummern");
ok("Jede Satznummer nennt ihre Fundstelle",
  satzmarken.every((x) => /Satz \d+$/.test(x.title || "")),
  satzmarken.slice(0, 3).map((x) => x.title).join(" | "));
ok("Satznummern bleiben aus dem kanonischen Text heraus",
  kanonisch === js("textindex(document.querySelector('.lesespalte')).text"));
/* Ein Absatz mit nur einem Satz bekommt keine Nummer — die Absatzbezeichnung
   sagt dort schon alles. */
const einzeln = js(`(() => {
  const gruppen = new Map();
  for (const s of saetzeDerNorm()) {
    const k = s.absatz || "";
    gruppen.set(k, (gruppen.get(k) || 0) + 1);
  }
  return [...gruppen.values()].filter(n => n === 1).length;
})()`);
const mehrfach = js(`(() => {
  const gruppen = new Map();
  for (const s of saetzeDerNorm()) {
    const k = s.absatz || "";
    gruppen.set(k, (gruppen.get(k) || 0) + 1);
  }
  return [...gruppen.values()].filter(n => n > 1).reduce((a, b) => a + b, 0);
})()`);
ok("Nur mehrsätzige Absätze werden nummeriert",
  satzmarken.length === mehrfach,
  `${satzmarken.length} Nummern, ${mehrfach} Sätze in mehrsätzigen Absätzen, ${einzeln} einsätzige Absätze`);

/* ── Satzbild ── */
ok("Satzbild-Umschalter vorhanden", Boolean(d.getElementById("satzbild")));
const huellen = d.querySelectorAll(".lesespalte .satz").length;
ok("Sätze tragen eine eigene Hülle", huellen > 0, huellen + " Hüllen");
js('satzbildSetzen("einzeln")');
ok("Satzweise Darstellung setzt die Marke",
  d.body.dataset.satzbild === "einzeln", String(d.body.dataset.satzbild));
ok("Der kanonische Text bleibt beim Umschalten derselbe",
  kanonisch === js("textindex(document.querySelector('.lesespalte')).text"));
js('satzbildSetzen("fortlaufend")');
ok("Zurückschalten entfernt die Marke", !d.body.dataset.satzbild);

/* ── Apparat ── */
const register = [...d.querySelectorAll(".register button")].map((b) => b.textContent);
ok("Fünf Register", register.length === 5, register.join(" · "));
ok("Register in der vorgesehenen Reihenfolge",
  register.join("|") === "Hinweise|Schema|Verwaltung|Zitate|Markierungen");

/* ── Mappe ──
   Geprüft wird die Datenanbindung, nicht das Aussehen: Gibt es beim ersten
   Aufruf eine Mappe, landet eine neue Markierung darin, und sagt der Fuß der
   Markierungskarte, in welcher? */
const knopfMappe = d.getElementById("knopf-mappe");
ok("Mappenknopf ist bedienbar", knopfMappe && !knopfMappe.disabled);

window.mappeOeffnen();
ok("Mappe öffnet", d.getElementById("mappe").classList.contains("offen"));
const mappen = JSON.parse(speicher.get("sn.mappen") || "[]");
ok("Immer mindestens eine Mappe", mappen.length >= 1, mappen.length + " angelegt");
ok("Mappe hat einen Namen", Boolean(mappen[0] && mappen[0].name), mappen[0] && mappen[0].name);
ok("Fuß nennt den Speicherort",
  (d.querySelector(".mappe-fuss") || {}).textContent.includes("nur in diesem Browser"));

/* Eine Markierung anlegen und nachsehen, wo sie liegt. */
const vorher = js("S.markierungen.length");
js('auswahlMarkieren("Der Solidaritätszuschlag")');
const neueId = js("S.markierungen[S.markierungen.length - 1].id");
ok("Markierung wird angelegt", js("S.markierungen.length") === vorher + 1);
ok("Markierung liegt in genau einer Mappe",
  js(`S.mappen.filter(m => m.eintraege.some(e => e.markierungId === "${neueId}")).length`) === 1);
ok("Markierung kennt ihre Mappe",
  js(`S.markierungen.find(m => m.id === "${neueId}").mappe`) === js("S.mappen[0].id"));

js(`popoverOeffnen("${neueId}", document.querySelector(".lesespalte"))`);
const fuss = (d.getElementById("popover-mappe") || {}).textContent || "";
ok("Karte nennt die Mappe", fuss.startsWith("Nur für Sie sichtbar · Mappe "), fuss);

/* Löschen räumt beide Seiten auf. */
js(`markierungLoeschen("${neueId}")`);
ok("Löschen räumt die Mappe mit auf",
  !js(`S.mappen.some(m => m.eintraege.some(e => e.markierungId === "${neueId}"))`));
window.mappeSchliessen();

/* ── Suche: Fundstellen ──
   „§ 5 EStG" ist eine Adresse, keine Zeichenfolge im Wortlaut. Geprüft wird
   gegen das Register — das EStG ist in diesem Lauf NICHT geladen, der Treffer
   muss also aus `data/index.json` kommen. */
const adr = js('adresseLesen("§ 5 EStG")');
ok("Fundstelle wird als Adresse gelesen",
  adr && adr.abk === "EStG" && adr.enbez === "§ 5", JSON.stringify(adr));
ok("Fundstelle führt unmittelbar auf die Norm",
  js('sucheZiel("§ 5 EStG")') === "#/estg/5", js('sucheZiel("§ 5 EStG")'));
const schreibweisen = ["§5 EStG", "EStG § 5", "EStG 5", "§ 5 Abs. 2 EStG", "estg §5"];
ok("Umgestellte Schreibweisen führen ans selbe Ziel",
  schreibweisen.every((s) => js("sucheZiel(" + JSON.stringify(s) + ")") === "#/estg/5"),
  schreibweisen.map((s) => js("sucheZiel(" + JSON.stringify(s) + ")")).join(" · "));
ok("Der ausgeschriebene Name zählt auch",
  js('sucheZiel("§ 370 Abgabenordnung")') === "#/ao/370",
  js('sucheZiel("§ 370 Abgabenordnung")'));
ok("Die Fundstelle steht auch ohne geladenen Volltext in der Liste",
  js('trefferliste("§ 5 EStG").length') >= 1
  && js('trefferliste("§ 5 EStG")[0].abk') === "EStG"
  && js('trefferliste("§ 5 EStG")[0].id') === "5",
  js('JSON.stringify(trefferliste("§ 5 EStG")[0] || null)').slice(0, 90));
ok("Mehr als eine Fundstelle bleibt eine Suche",
  js('sucheZiel("§ 5 EStG Gewinn")').startsWith("#/suche/"), js('sucheZiel("§ 5 EStG Gewinn")'));
ok("Ohne genanntes Gesetz wird nicht gesprungen",
  js('sucheZiel("§ 5")').startsWith("#/suche/"), js('sucheZiel("§ 5")'));
ok("Ohne Gesetz zeigt die Adresse auf alle Gesetze, die die Norm führen",
  js('adressTreffer(adresseLesen("§ 5")).length') === 14,
  js('adressTreffer(adresseLesen("§ 5")).length') + " Gesetze");
ok("Was es nicht gibt, wird nicht erfunden",
  js('adressTreffer(adresseLesen("§ 999 EStG")).length') === 0);

/* ── Suche: Vorschläge während der Eingabe ── */
const v1 = js('vorschlaege("§ 5 EStG")');
ok("Vorschläge kommen bei einer Fundstelle", v1.length >= 2, v1.length + " Vorschläge");
ok("Die Fundstelle steht oben",
  v1[0] && v1[0].ziel === "#/estg/5" && v1[0].marke === "Fundstelle",
  v1[0] && v1[0].kopf + " → " + v1[0].ziel);
ok("Die Volltextsuche bleibt immer erreichbar",
  v1[v1.length - 1].ziel.startsWith("#/suche/"), v1[v1.length - 1].kopf);
ok("Vorschläge zu einem Gesetz",
  js('vorschlaege("GewStG")').some((v) => v.ziel === "#/gewstg"), "");
ok("Vorschläge zu einer Überschrift",
  js('vorschlaege("Gewinnermittlung")').some((v) => v.marke === "Überschrift"), "");
ok("Ein einzelner Buchstabe schlägt nichts vor", js('vorschlaege("a")').length === 0);
ok("Nicht mehr als acht Vorschläge",
  js('vorschlaege("Steuer")').length <= 8, js('vorschlaege("Steuer")').length + " Vorschläge");

/* Die Liste hängt am Feld und erscheint beim Tippen. */
const feld = d.getElementById("suche");
ok("Das Suchfeld trägt eine Vorschlagsliste",
  Boolean(feld.closest(".suchhuelle") && feld.closest(".suchhuelle").querySelector(".vorschlaege")));
const box = feld.closest(".suchhuelle").querySelector(".vorschlaege");
ok("Die Liste bleibt zu, solange nichts getippt ist", box.hidden);

feld.value = "§ 5 EStG";
feld.dispatchEvent(new window.Event("input", { bubbles: true }));
ok("Tippen öffnet die Liste", !box.hidden);
ok("Die Liste zeigt Einträge", box.querySelectorAll(".vorschlag").length >= 2,
  box.querySelectorAll(".vorschlag").length + " Einträge");
ok("Der erste Eintrag nennt die Fundstelle",
  (box.querySelector(".vorschlag .vkopf") || {}).textContent === "§ 5 EStG",
  (box.querySelector(".vorschlag .vkopf") || {}).textContent);
ok("Das Feld meldet die offene Liste",
  feld.getAttribute("aria-expanded") === "true");

feld.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
ok("Pfeiltaste wählt den ersten Eintrag",
  box.querySelectorAll('.vorschlag[aria-selected=true]').length === 1
  && box.querySelector(".vorschlag").getAttribute("aria-selected") === "true");

feld.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
ok("Escape schließt die Liste", box.hidden);
ok("Escape lässt den Text stehen", feld.value === "§ 5 EStG", feld.value);
feld.value = "";

/* ── Spaltenbreiten ──
   jsdom rechnet kein Layout; geprüft wird die Mechanik, nicht das Bild. */
ok("Beide Griffe sind da",
  Boolean(d.getElementById("griff-nav") && d.getElementById("griff-apparat")));
ok("Der Griff ist als Trenner ausgezeichnet",
  d.getElementById("griff-nav").getAttribute("role") === "separator"
  && d.getElementById("griff-nav").getAttribute("aria-orientation") === "vertical");
ok("Der Griff ist mit der Tastatur erreichbar",
  d.getElementById("griff-nav").getAttribute("tabindex") === "0");
js('spalteSetzen("nav", 300, true)');
ok("Eine Breite landet an der Marke",
  d.documentElement.style.getPropertyValue("--nav") === js("S.spalten.nav") + "px",
  d.documentElement.style.getPropertyValue("--nav"));
ok("Die Breite wird gemerkt",
  JSON.parse(speicher.get("sn.spalten") || "{}").nav === js("S.spalten.nav"),
  speicher.get("sn.spalten"));
/* Die Mitte hat Vorrang: Was der Lesespalte ihr Mindestmaß nähme, wird gekappt. */
js('spalteSetzen("nav", 5000)');
ok("Die Lesespalte lässt sich nicht zuziehen",
  js("window.innerWidth - S.spalten.nav - S.spalten.apparat") >= 420,
  `Fenster ${js("window.innerWidth")}, nav ${js("S.spalten.nav")}, Apparat ${js("S.spalten.apparat")}`);
js('spalteSetzen("nav", 0)');
ok("Und nicht unter ihr eigenes Mindestmaß", js("S.spalten.nav") === 180, js("S.spalten.nav"));

/* ── Fassungsblatt ──
   Der Knopf hing am Wortvergleich und war damit bei 1 536 von 1 537 Normen
   grau. Er führt jetzt auf ein Blatt, das auf JEDER Norm etwas zu sagen hat —
   und zwar nur das, was in den Daten steht. */
const knopfFassung = d.getElementById("knopf-vergleichen");
ok("Der Fassungsknopf ist auf einer Norm bedienbar",
  knopfFassung && !knopfFassung.disabled,
  knopfFassung ? "disabled=" + knopfFassung.disabled : "kein Knopf");
ok("Er sagt, wohin er führt",
  /Fassung dieser Norm|Zeitstände/.test(knopfFassung.title), knopfFassung.title);
ok("SolzG § 3 hat weniger als zwei Zeitstände",
  js("fassungenDerNorm().length") < 2, js("fassungenDerNorm().length") + " Zeitstände");

js('vergleichZeichnen()');
const blatt = d.querySelector(".fassungsblatt");
ok("Trotzdem erscheint ein Fassungsblatt", Boolean(blatt));
const ueberschriften = [...d.querySelectorAll(".fassung-abschnitt h2")].map((h) => h.textContent);
ok("Es nennt Stand, Anwendung, Zeitstände und die Lücke",
  ueberschriften.join(" | ") === "Stand des Gesetzes | Anwendungsvorschrift"
    + " | Aufgezeichnete Zeitstände | Änderungsübersicht",
  ueberschriften.join(" | "));

/* Der Stand kommt aus data/, nicht aus dem Entwurf. */
const standWerte = [...d.querySelectorAll(".fassung-liste dd")].map((x) => x.textContent);
ok("Der Stand steht wörtlich so in den Daten",
  standWerte.length > 0 && standWerte.every((t) => js("JSON.stringify(S.gesetz.stand)").includes(t)),
  standWerte.join(" · "));
ok("Die Reichweite des Standes wird gesagt",
  (d.querySelector(".fassung-reichweite") || {}).textContent.includes("insgesamt"),
  (d.querySelector(".fassung-reichweite") || {}).textContent);

/* Was fehlt, wird als Lücke gezeigt — nicht überspielt. */
ok("Die fehlende Änderungsübersicht wird benannt",
  (d.querySelector(".fassung-fehlt") || {}).textContent.includes("steht noch nicht bereit"),
  (d.querySelector(".fassung-fehlt") || {}).textContent.slice(0, 70));
ok("Der Weg zur amtlichen Quelle steht daneben",
  (d.querySelector(".fassung-amtlich") || {}).getAttribute("href")
  === "https://www.gesetze-im-internet.de/solzg_1995/__3.html",
  (d.querySelector(".fassung-amtlich") || {}).getAttribute("href"));
/* Der eigentliche Prüfstein: JEDE Datumsangabe auf dem Blatt muss in den Daten
   stehen. Eine nachgebildete Änderungsgeschichte fiele genau hier auf. */
const datenRoh = js("JSON.stringify(S.gesetz) + JSON.stringify(S.fassungen)");
const datumsangaben = (blatt.textContent.match(/\d{1,2}\.\d{1,2}\.\d{4}|\d{4}-\d{2}-\d{2}/g) || []);
ok("Jede Datumsangabe steht so in den Daten",
  datumsangaben.length > 0 && datumsangaben.every((t) => datenRoh.includes(t)),
  datumsangaben.join(" · ") || "keine");

/* Eine Anlage bekommt keinen geratenen Paragrafenlink. */
ok("Für eine Anlage führt der Weg auf das Gesetz",
  js(`giiAdresse({ quelle: "https://www.gesetze-im-internet.de/estg/", abk: "EStG" }, { id: "anlage-3" })`)
  === "https://www.gesetze-im-internet.de/estg/",
  js(`giiAdresse({ quelle: "https://www.gesetze-im-internet.de/estg/" }, { id: "anlage-3" })`));

/* ── Änderungsübersicht ──
   Der Datensatz wird hier EINGESPIELT, nicht mitgeliefert: Eine erfundene
   Änderungsgeschichte hätte im Bestand nichts verloren, auch nicht als
   Prüfmuster. Geprüft wird die Anzeige, nicht der Inhalt. */
js(`S.aenderungen.SolzG = {
  abk: "SolzG",
  quelle: "https://beispiel.invalid/prüfmuster",
  erzeugt: "2026-08-14T00:00:00Z",
  normen: { "3": [
    { inkrafttreten: "2020-12-29", aenderungsgesetz: "Zweites Gesetz",
      ausfertigung: "2020-12-21", fundstelle: "BGBl. I S. 3096",
      fundstelleUrl: "https://beispiel.invalid/3096" },
    { inkrafttreten: "2025-01-01", aenderungsgesetz: "Erstes Gesetz",
      ausfertigung: "2024-12-02", fundstelle: "BGBl. I Nr. 387" }
  ] }
}`);
js('vergleichZeichnen()');
const tabelle = d.querySelector(".aenderungen");
ok("Mit Daten erscheint die Änderungsübersicht als Tabelle", Boolean(tabelle));
const spalten = [...d.querySelectorAll(".aenderungen th")].map((x) => x.textContent);
ok("Vier Spalten wie im Recht üblich",
  spalten.join(" | ") === "Inkrafttreten | Änderungsgesetz | Ausfertigung | Fundstelle",
  spalten.join(" | "));
const zeilen = [...d.querySelectorAll(".aenderungen tbody tr")]
  .map((tr) => [...tr.children].map((td) => td.textContent).join(" · "));
ok("Zwei Zeilen, jüngste zuerst",
  zeilen.length === 2 && zeilen[0].startsWith("01.01.2025") && zeilen[1].startsWith("29.12.2020"),
  zeilen.join(" || "));
ok("ISO-Datum wird deutsch gezeigt", js('datumDeutsch("2024-12-02")') === "02.12.2024",
  js('datumDeutsch("2024-12-02")'));
ok("Was kein ISO-Datum ist, bleibt unverändert",
  js('datumDeutsch("2. Dezember 2024")') === "2. Dezember 2024");
ok("Die Fundstelle wird verlinkt, wo eine Adresse vorliegt",
  (d.querySelector(".aenderungen a") || {}).getAttribute("href") === "https://beispiel.invalid/3096",
  (d.querySelector(".aenderungen a") || {}).getAttribute("href"));
ok("Ohne Adresse bleibt die Fundstelle Text",
  d.querySelectorAll(".aenderungen a").length === 1,
  d.querySelectorAll(".aenderungen a").length + " Verweise");
ok("Die Herkunft der Übersicht wird genannt",
  [...d.querySelectorAll(".fassung-quelle")].some((x) => x.textContent.includes("beispiel.invalid")));

/* Eine Datei OHNE Eintrag zu dieser Norm sagt etwas anderes als gar keine Datei. */
js('S.aenderungen.SolzG = { abk: "SolzG", normen: {} }');
js('vergleichZeichnen()');
ok("Datei ohne Eintrag wird von fehlender Datei unterschieden",
  (d.querySelector(".fassung-fehlt") || {}).textContent.includes("die Quelle dazu nichts hergibt"),
  (d.querySelector(".fassung-fehlt") || {}).textContent.slice(0, 60));
js('S.aenderungen.SolzG = null');

/* ── Zugänglichkeit ── */
ok("Schalter trägt den vollen Namen",
  (d.getElementById("stufen") || {}).getAttribute
  && d.getElementById("stufen").getAttribute("aria-label") === "Tatbestand und Rechtsfolge einfärben");
ok("Reiter als tablist ausgezeichnet",
  d.getElementById("reiterleiste").getAttribute("role") === "tablist");
ok("Aktive Normzeile mit aria-current",
  Boolean(d.querySelector('.normzeile[aria-current=true]')));

console.log("");
let fehler = 0;
for (const p of pruef) {
  if (!p.bestanden) fehler++;
  console.log(`  ${p.bestanden ? "✓" : "✗"} ${p.name}${p.zusatz ? "  — " + p.zusatz : ""}`);
}
console.log(`\n${pruef.length - fehler}/${pruef.length} bestanden`);
process.exit(fehler ? 1 : 0);
