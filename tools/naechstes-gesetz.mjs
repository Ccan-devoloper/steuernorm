#!/usr/bin/env node
/** Wählt für die nächste KI-Etappe genau ein offenes Gesetz aus. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashText, textDerNorm } from "./lib/text.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const PIPELINE_VERSION = 2;

async function json(datei, fallback = null) {
  try {
    return JSON.parse(await readFile(datei, "utf8"));
  } catch (fehler) {
    if (fehler.code === "ENOENT") return fallback;
    throw fehler;
  }
}

function wiederverwendbar(annotation, textHash) {
  return annotation
    && annotation.text_hash === textHash
    && Number(annotation.pipeline_version) === PIPELINE_VERSION
    && annotation.gesetz_quellen_konsens === true
    && Array.isArray(annotation.gesetz_quellen)
    && annotation.gesetz_quellen.length >= 4;
}

const register = await json(path.join(WURZEL, "data", "index.json"));
if (!register?.gesetze?.length) throw new Error("data/index.json enthält keine Gesetze");

const kandidaten = [];
for (const meta of register.gesetze) {
  const gesetz = await json(path.join(WURZEL, "data", meta.datei));
  const final = await json(path.join(WURZEL, "annotations", meta.datei), { normen: {} });
  const stand = await json(path.join(WURZEL, ".ki-fortschritt", meta.datei), { normen: {} });
  const finalV2 = final?.automatisch === true && Number(final.pipeline_version) >= PIPELINE_VERSION;
  const hatZwischenstand = stand?.unvollstaendig === true;

  let offen = 0;
  let ausZwischenstand = 0;
  for (const norm of gesetz.normen) {
    const textHash = hashText(textDerNorm(norm));
    const fortschritt = stand.normen?.[norm.id];
    const veroeffentlicht = final.normen?.[norm.id];
    if (wiederverwendbar(fortschritt, textHash)) {
      ausZwischenstand++;
      continue;
    }
    if (wiederverwendbar(veroeffentlicht, textHash)) continue;
    offen++;
  }

  if (!offen) continue;
  kandidaten.push({
    abk: meta.abk,
    anzahl: gesetz.normen.length,
    offen,
    // 0: begonnenen Zwischenstand fertigstellen; 1: geändertes fertiges Gesetz;
    // 2: erstmals vollständig annotieren.
    prioritaet: hatZwischenstand && ausZwischenstand > 0 ? 0 : (finalV2 ? 1 : 2),
  });
}

kandidaten.sort((a, b) =>
  a.prioritaet - b.prioritaet
  || a.anzahl - b.anzahl
  || a.offen - b.offen
  || a.abk.localeCompare(b.abk, "de"),
);

if (kandidaten.length) process.stdout.write(kandidaten[0].abk);
