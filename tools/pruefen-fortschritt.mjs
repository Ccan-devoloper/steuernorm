#!/usr/bin/env node
/** Prüft veröffentlichte v2-Annotationen und noch nicht veröffentlichte KI-Zwischenstände. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const register = JSON.parse(await readFile(path.join(WURZEL, "data", "index.json"), "utf8"));
const minimum = Number(process.env.MIN_QUELLEN || 4);
const erlaubteKlassen = new Set([
  "rule", "definition", "fiction", "obligation", "prohibition", "permission",
  "entitlement", "calculation", "procedure", "competence", "reference_only", "no_classic_rule",
]);
const normativ = new Set([
  "rule", "definition", "fiction", "obligation", "prohibition", "permission",
  "entitlement", "calculation", "procedure", "competence",
]);

async function json(datei, fallback = null) {
  try {
    return JSON.parse(await readFile(datei, "utf8"));
  } catch (fehler) {
    if (fehler.code === "ENOENT") return fallback;
    throw fehler;
  }
}

function text(html = "") {
  return html
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<\/p>|<\/li>|<\/dd>|<\/dt>|<\/tr>|<\/h\d>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&sect;/g, "§")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}
function normtext(norm) {
  return norm.abs.map((absatz) => text(absatz.html)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
function hash(inhalt) {
  return createHash("sha256").update(inhalt).digest("hex");
}
function urlKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return "";
  }
}

let fehler = 0;
let geprueft = 0;
let endgueltig = 0;
let zwischenstaende = 0;
const zeilen = [];

for (const meta of register.gesetze) {
  const gesetz = JSON.parse(await readFile(path.join(WURZEL, "data", meta.datei), "utf8"));
  const final = await json(path.join(WURZEL, "annotations", meta.datei));
  const stand = await json(path.join(WURZEL, ".ki-fortschritt", meta.datei));
  const finalV2 = final?.automatisch === true && Number(final.pipeline_version) >= 2;
  const quelle = finalV2 ? final : stand;
  if (!quelle) continue;

  if (finalV2) endgueltig++;
  else zwischenstaende++;
  const ids = Object.keys(quelle.normen || {});
  const normMap = new Map(gesetz.normen.map((norm) => [String(norm.id), norm]));

  if (finalV2 && ids.length !== gesetz.normen.length) {
    console.error(`FEHLER ${meta.abk}: finale Datei enthält ${ids.length}/${gesetz.normen.length} Normen`);
    fehler++;
  }
  if (!finalV2 && quelle.unvollstaendig !== true) {
    console.error(`FEHLER ${meta.abk}: Zwischenstand nicht als unvollständig gekennzeichnet`);
    fehler++;
  }

  for (const id of ids) {
    geprueft++;
    const norm = normMap.get(String(id));
    const annotation = quelle.normen[id];
    if (!norm) {
      console.error(`FEHLER ${meta.abk} § ${id}: verwaiste Annotation`);
      fehler++;
      continue;
    }
    const volltext = normtext(norm);
    if (annotation.text_hash !== hash(volltext)) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: veralteter Text-Hash`);
      fehler++;
    }
    if (!erlaubteKlassen.has(annotation.klassifikation)) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: ungültige Klasse`);
      fehler++;
    }
    if (annotation.modell === "nur-regellogik" || annotation.konsens_methode !== "ki_logik_quellen") {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: KI-/Logikverfahren fehlt`);
      fehler++;
    }

    const quellen = Array.isArray(annotation.quellen) ? annotation.quellen : [];
    const idsGesetz = [...new Set((annotation.gesetz_quellen || []).map(String))];
    const gespeicherteIds = new Set(quellen.map((q) => String(q.id)));
    const urls = new Set(quellen.map((q) => urlKey(q.url)).filter(Boolean));
    if (annotation.gesetz_quellen_konsens !== true || idsGesetz.length < minimum || urls.size < minimum) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: weniger als ${minimum} Gesetzesreferenzen`);
      fehler++;
    }
    if (idsGesetz.some((quellenId) => !gespeicherteIds.has(quellenId))) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: Referenz-ID ohne Quelldatensatz`);
      fehler++;
    }

    for (const art of ["tb", "rf", "ausnahmen"]) {
      if (!Array.isArray(annotation[art])) {
        console.error(`FEHLER ${meta.abk} ${norm.enbez}: ${art} ist kein Array`);
        fehler++;
        continue;
      }
      for (const phrase of annotation[art]) {
        if (!volltext.includes(phrase)) {
          console.error(`FEHLER ${meta.abk} ${norm.enbez} [${art}]: Textspanne trifft nicht`);
          fehler++;
        }
      }
    }

    const hatRegel = annotation.tb?.length > 0 && annotation.rf?.length > 0;
    if (normativ.has(annotation.klassifikation) !== hatRegel) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: Klasse und TB/RF-Paar widersprechen sich`);
      fehler++;
    }
  }
  zeilen.push(`${meta.abk} ${ids.length}/${gesetz.normen.length}${finalV2 ? " final" : " in Arbeit"}`);
}

if (!geprueft) {
  console.error("FEHLER: Weder v2-Annotationen noch KI-Zwischenstände vorhanden");
  fehler++;
}
console.log(`Geprüft: ${geprueft} Normen · ${endgueltig} Gesetze final · ${zwischenstaende} Zwischenstände.`);
console.log(zeilen.join(" · "));
console.log(`${fehler} Fehler.`);
if (fehler) process.exitCode = 1;
