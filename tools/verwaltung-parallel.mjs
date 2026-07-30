#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { abschnitteAus } from "./lib/handbuch.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const gesetzRoh = process.argv[2];
if (!gesetzRoh) throw new Error("Gesetz als erstes Argument erforderlich.");

const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");
const register = JSON.parse(await readFile(path.join(WURZEL, "data/index.json"), "utf8"));
const meta = register.gesetze.find((m) => [m.abk, m.slug, m.datei].some((v) => kurz(v) === kurz(gesetzRoh)));
if (!meta) throw new Error(`Unbekanntes Gesetz: ${gesetzRoh}`);

const daten = JSON.parse(await readFile(path.join(WURZEL, "data", meta.datei), "utf8"));
const config = JSON.parse(await readFile(path.join(WURZEL, "config/handbuecher.json"), "utf8"));
const handbuch = config.handbuecher.find((h) => h.gesetz === daten.abk);
if (!handbuch) throw new Error(`${daten.abk}: kein amtliches Handbuch konfiguriert.`);
const karte = JSON.parse(await readFile(path.join(WURZEL, `config/handbuch-karte-${kurz(daten.abk)}.json`), "utf8"));
let vorhanden = null;
try { vorhanden = JSON.parse(await readFile(path.join(WURZEL, "belege", meta.datei), "utf8")); } catch {}

const PARALLEL = Math.max(1, Math.min(8, Number(process.env.VERWALTUNG_PARALLEL || 6)));
const PAUSE_MS = Math.max(1_000, Number(process.env.VERWALTUNG_PAUSE_MS || 1_000));
const TIMEOUT_MS = 90_000;
const MAX_VERSUCHE = 4;
const KENNUNG = "steuernorm/4 (+https://github.com/Ccan-devoloper/steuernorm)";
const WIEDERHOLBAR = new Set([408, 425, 429, 500, 502, 503, 504]);

let letzterStart = 0;
let startKette = Promise.resolve();
const warten = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startSlot() {
  const meinSlot = startKette.then(async () => {
    const rest = PAUSE_MS - (Date.now() - letzterStart);
    if (rest > 0) await warten(rest);
    letzterStart = Date.now();
  });
  startKette = meinSlot.catch(() => {});
  await meinSlot;
}

async function hole(url) {
  let letzterFehler = "unbekannter Fehler";
  for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch++) {
    await startSlot();
    try {
      const antwort = await fetch(url, {
        headers: { "User-Agent": KENNUNG, Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (antwort.ok) return { html: await antwort.text(), url: antwort.url || url, etag: antwort.headers.get("etag") };
      letzterFehler = `HTTP ${antwort.status}`;
      if (!WIEDERHOLBAR.has(antwort.status)) break;
    } catch (fehler) {
      letzterFehler = fehler.name === "TimeoutError" ? "Zeitüberschreitung" : fehler.message;
    }
    if (versuch < MAX_VERSUCHE) await warten(Math.min(2_000 * (2 ** (versuch - 1)), 20_000));
  }
  throw new Error(`${url}: ${letzterFehler} nach ${MAX_VERSUCHE} Versuchen`);
}

function kuerzen(t, max = 2_400) {
  if (t.length <= max) return t;
  const schnitt = t.slice(0, max);
  const punkt = Math.max(schnitt.lastIndexOf(". "), schnitt.lastIndexOf("; "));
  return `${(punkt > max * 0.5 ? schnitt.slice(0, punkt + 1) : schnitt).trim()} […]`;
}

const normen = {};
const aufgaben = [];
for (const norm of daten.normen) {
  const nr = String(norm.id);
  const alt = vorhanden?.normen?.[nr];
  normen[nr] = {
    enbez: norm.enbez,
    verwaltung: alt?.verwaltung ?? [],
    rechtsprechung: alt?.rechtsprechung ?? [],
    abgerufen: alt?.abgerufen ?? null,
    ...(alt?.etag ? { etag: alt.etag } : {}),
  };
  const ziel = karte.paragrafen?.[nr] || karte.vorschaltnormen?.[nr];
  if (ziel?.url) aufgaben.push({ nr, ziel });
}

let index = 0;
let erledigt = 0;
async function arbeiter() {
  while (true) {
    const position = index++;
    if (position >= aufgaben.length) return;
    const { nr, ziel } = aufgaben[position];
    const gelesen = await hole(ziel.url);
    const abschnitte = abschnitteAus(gelesen.html)
      .map((a) => ({ quelle: `${handbuch.abk} (${karte.jahrgang ?? handbuch.jahrgang})`, fundstelle: a.titel, text: kuerzen(a.text), url: gelesen.url }))
      .filter((a) => a.text.length > 40)
      .slice(0, 6);
    normen[nr].verwaltung = abschnitte;
    normen[nr].abgerufen = new Date().toISOString().slice(0, 10);
    if (gelesen.etag) normen[nr].etag = gelesen.etag;
    erledigt++;
    if (erledigt % 20 === 0 || erledigt === aufgaben.length) console.log(`${daten.abk}: ${erledigt}/${aufgaben.length} Verwaltungsseiten verarbeitet.`);
  }
}

await Promise.all(Array.from({ length: Math.min(PARALLEL, aufgaben.length || 1) }, () => arbeiter()));

const datei = {
  abk: daten.abk,
  titel: daten.titel,
  format: 1,
  handbuch: { abk: handbuch.abk, name: handbuch.name, jahrgang: karte.jahrgang ?? handbuch.jahrgang },
  hinweis: `Auszüge aus ${handbuch.name}. Amtliches Werk, nach § 5 Abs. 1 UrhG gemeinfrei. Unverändert wiedergegeben; maßgeblich ist die amtliche Fassung.`,
  aktualisiert: new Date().toISOString(),
  normen,
};

await writeFile(path.join(WURZEL, "belege", meta.datei), `${JSON.stringify(datei, null, 2)}\n`);
const alle = Object.values(normen);
const mitVerwaltung = alle.filter((n) => n.verwaltung?.length).length;
console.log(`${daten.abk}: ${mitVerwaltung}/${alle.length} Normen mit Verwaltungsbeleg; ${aufgaben.length} Seiten abgerufen.`);
if (mitVerwaltung < 1) process.exitCode = 2;
