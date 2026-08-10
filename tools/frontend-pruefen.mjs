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

/* ── Der Wortlaut bleibt unangetastet ── */
const wortlaut = (d.querySelector(".lesespalte") || {}).textContent || "";
ok("Keine Kategorienamen im Wortlaut", !/\b(Tatbestand|Rechtsfolge)\b/.test(wortlaut));
ok("Wortlaut beginnt wie im Gesetz",
  wortlaut.trim().startsWith("Der Solidaritätszuschlag bemisst sich vorbehaltlich der Absätze 2 bis 5"),
  wortlaut.trim().slice(0, 50));

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

/* Eine Markierung anlegen und nachsehen, wo sie liegt.
   `S` ist eine `const` im Skriptkopf und liegt damit im lexikalischen
   Globalbereich, nicht am `window`. Erreichbar ist sie über `eval` im selben
   Bereich — deshalb hier `js()` statt `window.S`. */
const js = (ausdruck) => window.eval(ausdruck);

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
