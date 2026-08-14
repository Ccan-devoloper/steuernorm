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
