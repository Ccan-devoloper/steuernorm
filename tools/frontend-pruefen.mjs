#!/usr/bin/env node
/**
 * frontend-pruefen.mjs — prüft das Frontend gegen die echten Daten.
 *
 * Das Frontend ist eine einzelne HTML-Datei ohne Bauschritt; ein Tippfehler im
 * Skript fällt sonst erst im Browser auf. Der Lauf lädt index.html in jsdom,
 * bedient `fetch` aus dem Dateisystem und prüft, dass die Norm erscheint, die
 * Markierungen sitzen, Schema, Rück- und Vorwärtsverweise gebaut werden und die
 * eigenen Notizen ihre Textstelle wiederfinden.
 *
 *   npm install --no-save jsdom
 *   node tools/frontend-pruefen.mjs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

import path2 from "node:path";
const WURZEL = path2.resolve(import.meta.dirname, "..");
const html = await readFile(path.join(WURZEL, "index.html"), "utf8");

const speicher = new Map();
const dom = new JSDOM(html, {
  url: "https://example.org/#/estg/15",
  runScripts: "dangerously",
  pretendToBeVisual: true,
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
    fenster.print = () => {};
    Object.defineProperty(fenster.navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
  },
});
const { window } = dom;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
await warte(2500);
const d = window.document;

const pruef = [];
const ok = (name, bedingung, zusatz = "") => pruef.push({ name, bestanden: Boolean(bedingung), zusatz });

// ── Grundgerüst
ok("Norm geladen", d.querySelector("h1") && d.querySelector("h1").textContent.includes("§ 15"),
   d.querySelector("h1")?.textContent.trim().slice(0, 50));
ok("Kein Ladefehler", !d.querySelector(".melder"));
const marken = [...d.querySelectorAll("#haupt mark")];
ok("Markierungen erzeugt", marken.length > 20, marken.length + " Marken");
const arten = new Set(marken.flatMap((m) => [...m.classList]));
ok("Kategorien vorhanden", arten.has("tb") && arten.has("rf"), [...arten].join(","));

// ── Der Fehler, der die Kategorien verschmierte: tb und rf auf denselben Zeichen
const gemischt = marken.filter((m) => m.classList.contains("tb") && m.classList.contains("rf"));
ok("Keine tb+rf-Mischmarken", gemischt.length === 0, gemischt.length + " gemischt");

// ── Statusband: erzeugt UND formatiert
const band = d.querySelector(".statusband");
ok("Statusband vorhanden", band, band ? band.textContent.slice(0, 60) : "fehlt");
ok("Plakette vorhanden", d.querySelector(".plakette"));

// ── Schema
ok("Prüfungsschema", d.querySelectorAll("#schema-rechts ol.leiter li").length > 0,
   d.querySelectorAll("#schema-rechts ol.leiter li").length + " Schritte");

// ── Querverweise vorwärts
const verweise = d.querySelectorAll("#haupt a.verweis");
ok("Verweise verlinkt", verweise.length > 0, verweise.length + " Verweise");
ok("Verweis trägt Druckziel", verweise[0] && verweise[0].dataset.ziel, verweise[0]?.dataset.ziel);

// ── Rückverweise
const zitiert = d.querySelector(".zitiert");
ok("Zitiert-von vorhanden", zitiert, zitiert ? zitiert.querySelector(".schema-kappe").textContent : "fehlt");
ok("Zitiert-von verlinkt", zitiert && zitiert.querySelectorAll(".wolke button").length > 0,
   zitiert ? zitiert.querySelectorAll(".wolke button").length + " Ziele" : "");

// ── Werkzeuge
const werkzeuge = [...d.querySelectorAll(".werkzeuge button")].map((b) => b.textContent);
ok("Werkzeugleiste", werkzeuge.length >= 5, werkzeuge.join(" · "));

// ── Eigene Markierungen: anlegen und wiederfinden
const text = d.querySelector("#haupt .text").textContent.replace(/\s+/g, " ").trim();
const probe = text.slice(200, 250);
speicher.set("eigene-markierungen-v1", JSON.stringify([{
  id: "t1", gesetz: "EStG", norm: "15", text: probe,
  praefix: "", suffix: "", notiz: "Meine Anmerkung", angelegt: new Date().toISOString(),
}]));
window.location.hash = "#/estg/15";
window.dispatchEvent(new window.HashChangeEvent("hashchange"));
await warte(700);
const eigene = [...d.querySelectorAll("#haupt mark.eigen")];
ok("Eigene Markierung im Text", eigene.length > 0, eigene.length + " Stellen");
ok("Notizzeichen gesetzt", eigene.some((m) => m.dataset.notiz === "1"));
const liste = d.querySelector(".eigene");
ok("Notizenliste", liste && liste.textContent.includes("Meine Anmerkung"));

// ── Gesetzesübergreifende Suche
d.getElementById("suche").value = "Vorsteuer";
d.getElementById("suche").dispatchEvent(new window.Event("input"));
await warte(400);
ok("Suchkopf für andere Gesetze", d.querySelector(".such-kopf"),
   d.querySelector(".such-kopf")?.textContent.trim());

console.log("");
let fehler = 0;
for (const p of pruef) {
  if (!p.bestanden) fehler++;
  console.log(`  ${p.bestanden ? "✓" : "✗"} ${p.name}${p.zusatz ? "  — " + p.zusatz : ""}`);
}
console.log(`\n${pruef.length - fehler}/${pruef.length} bestanden`);
process.exit(fehler ? 1 : 0);
