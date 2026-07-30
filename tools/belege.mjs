#!/usr/bin/env node
/**
 * belege.mjs — sammelt amtliche Belegstellen je Paragraf.
 *
 * Diese Schicht ist REIN EXTRAKTIV: Sie behauptet nichts, sie zitiert nur. Damit ist
 * sie für sich genommen bereits ein Produktmerkmal (das Fundstellenmodell, das
 * dejure.org wertvoll macht) und zugleich die Grundlage für die Quellenanbindung
 * des Modelllaufs.
 *
 *   node tools/belege.mjs --karte              Verzeichnisbäume der Handbücher aufbauen
 *   node tools/belege.mjs                      Belege für alle Gesetze holen
 *   node tools/belege.mjs --nur ao,estg
 *   node tools/belege.mjs --ohne-rechtsprechung
 *   node tools/belege.mjs --max 200            Abrufe je Lauf begrenzen
 *
 * Ergebnis: belege/<gesetz>.json und config/handbuch-karte-<abk>.json
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { abschnittLesen, karteBauen } from "./lib/handbuch.mjs";
import { entscheidungenZu } from "./lib/rechtsprechung.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const KONFIG = path.join(WURZEL, "config");
const DATEN = path.join(WURZEL, "data");
const ZIEL = path.join(WURZEL, "belege");

const args = process.argv.slice(2);
const hat = (f) => args.includes(f);
const wert = (f, v = null) => { const i = args.indexOf(f); return i >= 0 ? (args[i + 1] ?? v) : v; };

const nurKarte = hat("--karte");
const ohneRechtsprechung = hat("--ohne-rechtsprechung");
const MAX_ABRUFE = Number(wert("--max", process.env.MAX_BELEGABRUFE || 400));
const MIN_KARTEN_TREFFER = Number(process.env.MIN_KARTEN_TREFFER || 5);

const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");
const nurRoh = wert("--nur");
const nur = nurRoh ? new Set(nurRoh.split(",").map(kurz)) : null;

const konfig = JSON.parse(await readFile(path.join(KONFIG, "handbuecher.json"), "utf8"));
const register = JSON.parse(await readFile(path.join(DATEN, "index.json"), "utf8"));

await mkdir(ZIEL, { recursive: true });

/* ─────────────────────── Schritt 1: Karten aufbauen ─────────────────────── */

if (nurKarte) {
  for (const hb of konfig.handbuecher) {
    if (nur && !nur.has(kurz(hb.gesetz))) continue;
    console.log(`\n${hb.abk} — Verzeichnis wird abgelaufen …`);
    const karte = await karteBauen(hb, (m) => console.log(m));
    const anzahl = Object.keys(karte.paragrafen).length;
    if (anzahl < MIN_KARTEN_TREFFER) {
      throw new Error(`${hb.abk}: nur ${anzahl} Paragrafen gefunden; mindestens ${MIN_KARTEN_TREFFER} erwartet. Startadresse prüfen: ${hb.start}`);
    }
    const datei = path.join(KONFIG, `handbuch-karte-${kurz(hb.gesetz)}.json`);
    await writeFile(datei, `${JSON.stringify(karte, null, 2)}\n`);
    console.log(`  ✓ ${anzahl} Paragrafen, ${Object.keys(karte.vorschaltnormen).length} Vorschaltnormen → ${path.relative(WURZEL, datei)}`);
  }
  console.log("\nKarten aufgebaut. Jetzt: node tools/belege.mjs");
  process.exit(0);
}

/* ─────────────────────── Schritt 2: Belege holen ─────────────────────── */

let abrufe = 0;
const bilanz = [];

for (const meta of register.gesetze) {
  if (nur && ![meta.abk, meta.slug, meta.datei].some((k) => nur.has(kurz(k)))) continue;

  const gesetz = JSON.parse(await readFile(path.join(DATEN, meta.datei), "utf8"));
  const hb = konfig.handbuecher.find((h) => h.gesetz === gesetz.abk);
  const karte = hb ? await liesKarte(gesetz.abk) : null;
  const vorhanden = await liesBelege(meta.datei);

  if (hb && !karte) {
    console.warn(`${gesetz.abk}: keine Handbuchkarte. Erst 'node tools/belege.mjs --karte --nur ${kurz(gesetz.abk)}' laufen lassen.`);
  }

  const normen = {};
  let mitVerwaltung = 0, mitRechtsprechung = 0, uebernommen = 0;

  console.log(`\n${gesetz.abk} — ${gesetz.normen.length} Normen`);

  for (const norm of gesetz.normen) {
    const nr = String(norm.id);
    const alt = vorhanden?.normen?.[nr];

    // Frisch genug? Verwaltungsbelege ändern sich selten; 30 Tage sind reichlich.
    if (alt && frisch(alt.abgerufen, 30) && abrufe >= MAX_ABRUFE) {
      normen[nr] = alt; uebernommen++;
      if (alt.verwaltung?.length) mitVerwaltung++;
      if (alt.rechtsprechung?.length) mitRechtsprechung++;
      continue;
    }

    const eintrag = {
      enbez: norm.enbez,
      verwaltung: alt?.verwaltung ?? [],
      rechtsprechung: alt?.rechtsprechung ?? [],
      abgerufen: alt?.abgerufen ?? null,
    };

    // a) Verwaltungsanweisung
    if (karte && abrufe < MAX_ABRUFE && !frisch(alt?.abgerufen, 30)) {
      const ziel = karte.paragrafen[nr] || karte.vorschaltnormen[nr] || null;
      if (ziel) {
        abrufe++;
        const gelesen = await abschnittLesen({
          eintrag: ziel,
          quelle: `${hb.abk} (${karte.jahrgang ?? konfig.jahrgang})`,
          etag: alt?.etag ?? null,
        });
        if (gelesen && !gelesen.unveraendert) {
          eintrag.verwaltung = gelesen.abschnitte.map((a) => ({
            quelle: gelesen.quelle,
            fundstelle: a.titel,
            text: a.text,
            url: gelesen.url,
          }));
          eintrag.etag = gelesen.etag;
        }
        eintrag.abgerufen = heute();
      }
    }

    // b) Rechtsprechung
    if (!ohneRechtsprechung && abrufe < MAX_ABRUFE && !frisch(alt?.abgerufen, 30)) {
      abrufe++;
      const treffer = await entscheidungenZu({ gesetz: gesetz.abk, paragraf: nr, grenze: 5 });
      if (treffer.length) eintrag.rechtsprechung = treffer;
      eintrag.abgerufen = heute();
    }

    if (eintrag.verwaltung.length) mitVerwaltung++;
    if (eintrag.rechtsprechung.length) mitRechtsprechung++;
    normen[nr] = eintrag;

    if ((mitVerwaltung + mitRechtsprechung) % 25 === 0 && abrufe) {
      process.stdout.write(`  ${abrufe} Abrufe, ${mitVerwaltung} mit Verwaltungsbeleg\r`);
    }
    if (abrufe >= MAX_ABRUFE) {
      console.log(`\n  ⏸ Abrufgrenze ${MAX_ABRUFE} erreicht — Rest im nächsten Lauf.`);
      break;
    }
  }

  // Nicht erreichte Normen unverändert übernehmen
  for (const norm of gesetz.normen) {
    const nr = String(norm.id);
    if (!normen[nr] && vorhanden?.normen?.[nr]) { normen[nr] = vorhanden.normen[nr]; uebernommen++; }
  }

  const datei = {
    abk: gesetz.abk,
    titel: gesetz.titel,
    format: 1,
    handbuch: hb ? { abk: hb.abk, name: hb.name, jahrgang: karte?.jahrgang ?? konfig.jahrgang } : null,
    hinweis: hb
      ? `Auszüge aus ${hb.name}. Amtliches Werk, nach § 5 Abs. 1 UrhG gemeinfrei. Unverändert wiedergegeben; maßgeblich ist die amtliche Fassung.`
      : (konfig.ohne_handbuch?.[gesetz.abk] ?? "Für dieses Gesetz besteht kein amtliches Handbuch."),
    aktualisiert: new Date().toISOString(),
    normen,
  };
  await writeFile(path.join(ZIEL, meta.datei), `${JSON.stringify(datei, null, 2)}\n`);

  console.log(`  ✓ ${mitVerwaltung} mit Verwaltungsbeleg, ${mitRechtsprechung} mit Rechtsprechung, ${uebernommen} unverändert`);
  bilanz.push({ abk: gesetz.abk, normen: gesetz.normen.length, mitVerwaltung, mitRechtsprechung });

  if (abrufe >= MAX_ABRUFE) break;
}

await writeFile(
  path.join(WURZEL, "reports", "belege.json"),
  `${JSON.stringify({ erzeugt: new Date().toISOString(), abrufe, gesetze: bilanz }, null, 2)}\n`,
);
console.log(`\n${abrufe} Abrufe insgesamt.`);

/* ─────────────────────────── Hilfen ─────────────────────────── */

function heute() { return new Date().toISOString().slice(0, 10); }

function frisch(datum, tage) {
  if (!datum) return false;
  return (Date.now() - Date.parse(datum)) / 86_400_000 < tage;
}

async function liesKarte(abk) {
  try {
    return JSON.parse(await readFile(path.join(KONFIG, `handbuch-karte-${kurz(abk)}.json`), "utf8"));
  } catch { return null; }
}

async function liesBelege(datei) {
  try { return JSON.parse(await readFile(path.join(ZIEL, datei), "utf8")); } catch { return null; }
}
