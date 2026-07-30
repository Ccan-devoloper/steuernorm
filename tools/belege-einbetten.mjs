#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const REGISTER = JSON.parse(await readFile(path.join(WURZEL, "data/index.json"), "utf8"));
const CONFIG = JSON.parse(await readFile(path.join(WURZEL, "config/handbuecher.json"), "utf8"));
const JETZT = new Date().toISOString();

const hash = (wert) => createHash("sha256").update(JSON.stringify(wert)).digest("hex");
const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");

function fundstellenAus(belegNorm) {
  const fundstellen = [];
  for (const b of belegNorm?.verwaltung || []) {
    if (!b?.fundstelle && !b?.quelle) continue;
    fundstellen.push({
      art: "verwaltung",
      quelle: b.quelle || null,
      fundstelle: b.fundstelle || null,
      url: b.url || null,
      ebene: "norm",
    });
  }
  for (const b of belegNorm?.rechtsprechung || []) {
    const fundstelle = [b.gericht, b.datum, b.az].filter(Boolean).join(" · ") || b.fundstelle || b.titel || null;
    if (!fundstelle && !b?.url) continue;
    fundstellen.push({
      art: "rechtsprechung",
      quelle: b.gericht || b.quelle || null,
      fundstelle,
      url: b.url || b.dokumentUrl || null,
      ebene: "norm",
    });
  }
  return fundstellen;
}

function vereinigen(bisher, roh) {
  const ausgabe = [];
  const gesehen = new Set();
  for (const b of [...(Array.isArray(bisher) ? bisher : []), ...roh]) {
    if (!b) continue;
    const schluessel = [b.art || "verwaltung", b.quelle || "", b.fundstelle || "", b.url || ""].join("\u0000");
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    ausgabe.push(b);
  }
  return ausgabe;
}

const bilanz = [];
let normenGesamt = 0;
let normenMitBelegen = 0;
let fundstellenGesamt = 0;
let handbuecherMitBelegen = 0;

for (const meta of REGISTER.gesetze) {
  const annotationsPfad = path.join(WURZEL, "annotations", meta.datei);
  const belegePfad = path.join(WURZEL, "belege", meta.datei);
  let annotation;
  let belege;
  try {
    annotation = JSON.parse(await readFile(annotationsPfad, "utf8"));
  } catch {
    throw new Error(`${meta.abk}: Annotationsdatei fehlt.`);
  }
  try {
    belege = JSON.parse(await readFile(belegePfad, "utf8"));
  } catch {
    belege = { normen: {} };
  }

  let gesetzNormenMitBelegen = 0;
  let gesetzFundstellen = 0;
  for (const [normId, anm] of Object.entries(annotation.normen || {})) {
    normenGesamt++;
    const belegNorm = belege.normen?.[String(normId)] || null;
    const roh = fundstellenAus(belegNorm);
    const zusammen = vereinigen(anm.belege, roh);
    if (zusammen.length) {
      gesetzNormenMitBelegen++;
      normenMitBelegen++;
      gesetzFundstellen += zusammen.length;
      fundstellenGesamt += zusammen.length;
    }
    annotation.normen[normId] = {
      ...anm,
      belege: zusammen,
      beleg_hash: hash({ verwaltung: belegNorm?.verwaltung || [], rechtsprechung: belegNorm?.rechtsprechung || [] }),
      belege_aktualisiert: JETZT,
    };
  }

  annotation.belegstand = belege.aktualisiert || JETZT;
  annotation.belege_eingebettet = true;
  await writeFile(annotationsPfad, `${JSON.stringify(annotation, null, 2)}\n`);

  const hatHandbuch = CONFIG.handbuecher.some((h) => kurz(h.gesetz) === kurz(meta.abk));
  if (hatHandbuch && gesetzNormenMitBelegen > 0) handbuecherMitBelegen++;
  bilanz.push({
    abk: meta.abk,
    normen: Object.keys(annotation.normen || {}).length,
    normenMitBelegen: gesetzNormenMitBelegen,
    fundstellen: gesetzFundstellen,
    handbuch: hatHandbuch,
  });
}

if (REGISTER.gesetze.length !== 14) throw new Error(`14 Gesetze erwartet, gefunden: ${REGISTER.gesetze.length}.`);
if (normenGesamt !== 1537) throw new Error(`1537 Annotationen erwartet, gefunden: ${normenGesamt}.`);
if (handbuecherMitBelegen !== 8) throw new Error(`Acht Handbücher mit eingebetteten Belegen erwartet, gefunden: ${handbuecherMitBelegen}.`);
if (normenMitBelegen < 1 || fundstellenGesamt < 1) throw new Error("Keine amtlichen Fundstellen eingebettet.");

await mkdir(path.join(WURZEL, "reports"), { recursive: true });
await writeFile(
  path.join(WURZEL, "reports/belege-annotation.json"),
  `${JSON.stringify({
    erzeugt: JETZT,
    gesetze: REGISTER.gesetze.length,
    normen: normenGesamt,
    handbuecherMitBelegen,
    normenMitBelegen,
    fundstellen: fundstellenGesamt,
    vollstaendig: true,
    bilanz,
  }, null, 2)}\n`,
);
console.log(`${normenMitBelegen} Normen mit ${fundstellenGesamt} amtlichen Fundstellen in 14 Annotationsdateien eingebettet.`);
