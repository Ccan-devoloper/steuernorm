#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const wurzel = process.cwd();
const indexPfad = path.join(wurzel, "faelle", "index.json");
const fehler = [];
const warnungen = [];

function laden(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    fehler.push(`${path.relative(wurzel, p)}: ${err.message}`);
    return null;
  }
}

const index = laden(indexPfad);
if (index) {
  if (index.schema_version !== 1) fehler.push(`faelle/index.json: schema_version ist ${index.schema_version}, erwartet 1`);
  if (!Array.isArray(index.module) || index.module.length !== 25) {
    fehler.push(`faelle/index.json: ${index.module?.length ?? 0} Module, erwartet 25`);
  }

  const modulIds = new Set();
  const fallIds = new Set();
  let gesamt = 0;

  for (const meta of index.module || []) {
    if (modulIds.has(meta.id)) fehler.push(`Doppelte Modul-ID: ${meta.id}`);
    modulIds.add(meta.id);

    const datei = path.join(wurzel, meta.datei || "");
    const modul = laden(datei);
    if (!modul) continue;

    if (modul.id !== meta.id) fehler.push(`${meta.datei}: Modul-ID ${modul.id} passt nicht zu ${meta.id}`);
    if (modul.nummer !== meta.nummer) fehler.push(`${meta.datei}: Modulnummer ${modul.nummer} passt nicht zu ${meta.nummer}`);
    if (modul.titel !== meta.titel) fehler.push(`${meta.datei}: Modultitel weicht vom Index ab`);
    if (!Array.isArray(modul.faelle) || modul.faelle.length !== meta.anzahl) {
      fehler.push(`${meta.datei}: ${modul.faelle?.length ?? 0} Fälle, Index nennt ${meta.anzahl}`);
      continue;
    }

    for (const fall of modul.faelle) {
      gesamt++;
      if (fallIds.has(fall.id)) fehler.push(`Doppelte Fall-ID: ${fall.id}`);
      fallIds.add(fall.id);

      for (const feld of ["sachverhalt", "loesung"]) {
        if (typeof fall[feld] !== "string" || fall[feld].trim().length < 20) {
          fehler.push(`${meta.datei} ${fall.id}: ${feld} fehlt oder ist zu kurz`);
        }
        if (/Persönliches PDF für|Steuerberaterausbildung|RA,\s*StB Karsten Melzer/.test(fall[feld] || "")) {
          fehler.push(`${meta.datei} ${fall.id}: Kopf-/Fußzeile oder personenbezogenes Wasserzeichen enthalten`);
        }
      }

      if (!Number.isInteger(fall.quelle?.fall_seite) || !Number.isInteger(fall.quelle?.loesung_seite)) {
        fehler.push(`${meta.datei} ${fall.id}: Quellseiten fehlen`);
      }
    }
  }

  if (gesamt !== 90) fehler.push(`${gesamt} Fälle, erwartet 90`);
  if (index.gesamt_faelle !== gesamt) fehler.push(`Index nennt ${index.gesamt_faelle} Fälle, tatsächlich ${gesamt}`);
  if (!Array.isArray(index.nicht_zugeordnet)) fehler.push("nicht_zugeordnet muss ein Array sein");
  if ((index.nicht_zugeordnet || []).length) warnungen.push(`${index.nicht_zugeordnet.length} Fälle sind keinem Modul zugeordnet`);
}

console.log(`${index?.module?.length ?? 0} Module · ${index?.gesamt_faelle ?? 0} Fälle · ${index?.nicht_zugeordnet?.length ?? 0} offen`);
for (const w of warnungen) console.log(`WARNUNG: ${w}`);
for (const f of fehler) console.error(`FEHLER: ${f}`);
console.log(`${fehler.length} Fehler, ${warnungen.length} Warnungen.`);
process.exitCode = fehler.length ? 1 : 0;
