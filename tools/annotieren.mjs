#!/usr/bin/env node
/**
 * annotieren.mjs — erzeugt die Annotationen vollautomatisch.
 *
 *   node tools/annotieren.mjs                      alle Gesetze
 *   node tools/annotieren.mjs --nur solzg,estg
 *   node tools/annotieren.mjs --ohne-ki            nur Syntaxanalyse, kein Netz
 *   node tools/annotieren.mjs --laeufe 3           Anzahl unabhängiger Modellläufe
 *   node tools/annotieren.mjs --ohne-gegenprobe    spart Aufrufe
 *   node tools/annotieren.mjs --trocken            nichts schreiben
 *
 * Umgebung:
 *   GITHUB_TOKEN     Zugang zu GitHub Models
 *   KI_MODELLE       kommagetrennt, Voreinstellung: openai/gpt-4.1-mini,openai/gpt-4o-mini
 *   MAX_MODELLAUFRUFE Tagesbudget, Voreinstellung 400
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { einheiten as zerlegeNorm } from "./lib/gliederung.mjs";
import { zerlege as syntaxZerlege, NICHT_MARKIEREN } from "./lib/syntax.mjs";
import { baueSchema, fuehreZusammen, normText } from "./lib/konsens.mjs";
import {
  extrahiereMehrfach, gegenprobe,
  ModellBudgetErschoepft, ModellKontingentErschoepft,
} from "./lib/modell.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const DATEN = path.join(WURZEL, "data");
const ZIEL = path.join(WURZEL, "annotations");
const ZWISCHEN = path.join(WURZEL, ".fortschritt");
const BERICHTE = path.join(WURZEL, "reports");
const FORMAT = 3;

const args = process.argv.slice(2);
const flagWert = (f, v = null) => { const i = args.indexOf(f); return i >= 0 ? (args[i + 1] ?? v) : v; };
const hat = (f) => args.includes(f);

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const MODELLE = (process.env.KI_MODELLE || "openai/gpt-4.1-mini,openai/gpt-4o-mini").split(",").map((s) => s.trim()).filter(Boolean);
const ohneKi = hat("--ohne-ki") || !TOKEN;
const ohneGegenprobe = hat("--ohne-gegenprobe");
const trocken = hat("--trocken");
const LAEUFE = Math.max(1, Number(flagWert("--laeufe", process.env.KI_LAEUFE || 3)));
const budget = { maximum: Number(process.env.MAX_MODELLAUFRUFE || 400), verbraucht: 0 };

const nurRoh = flagWert("--nur");
const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");
const nur = nurRoh ? new Set(nurRoh.split(",").map(kurz).filter(Boolean)) : null;

const hash = (s) => createHash("sha256").update(s).digest("hex");

/* ─────────────────────────── Lauf ─────────────────────────── */

const register = JSON.parse(await readFile(path.join(DATEN, "index.json"), "utf8"));
const gesetze = register.gesetze.filter((m) => !nur || [m.abk, m.slug, m.datei].some((k) => nur.has(kurz(k))));
if (!gesetze.length) { console.error("Kein passendes Gesetz gefunden."); process.exit(2); }

await mkdir(ZWISCHEN, { recursive: true });
await mkdir(BERICHTE, { recursive: true });

const bericht = { erzeugt: new Date().toISOString(), format: FORMAT, modelle: ohneKi ? ["nur-syntax"] : MODELLE, laeufe: ohneKi ? 0 : LAEUFE, gesetze: [] };
let abbruch = null;

for (const meta of gesetze) {
  const gesetz = JSON.parse(await readFile(path.join(DATEN, meta.datei), "utf8"));
  const zielDatei = path.join(ZIEL, meta.datei);
  const zwischenDatei = path.join(ZWISCHEN, meta.datei);
  const alt = await lies(zielDatei);
  const zwischenstand = await lies(zwischenDatei);
  const normen = {};
  let bearbeitet = 0, uebernommen = 0, markierbar = 0;
  const alleAbgelehnt = [];

  console.log(`\n${gesetz.abk} — ${gesetz.normen.length} Normen`);

  for (const norm of gesetz.normen) {
    const einheiten = zerlegeNorm(norm);
    const volltext = einheiten.map((e) => e.text).join(" ");
    const th = hash(volltext);

    // Unverändert und im passenden Qualitätsmodus: übernehmen, kein Modellaufruf.
    // Ein vorhandener KI-Zwischenstand hat Vorrang vor der veröffentlichten Datei.
    const kandidaten = [
      { datei: zwischenstand, annotation: zwischenstand?.normen?.[norm.id] },
      { datei: alt, annotation: alt?.normen?.[norm.id] },
    ];
    const vorher = kandidaten.find(({ datei, annotation }) => wiederverwendbar({ datei, annotation, th }))?.annotation;
    if (vorher) {
      normen[norm.id] = vorher;
      uebernommen++;
      if (vorher.markierbar) markierbar++;
      continue;
    }

    const syntax = einheiten.map((e) => syntaxZerlege(e.text, { normtitel: norm.titel }));
    const kontext = { volltext, gegenstand: gegenstandAus(gesetz) };

    let laeufe = [];
    let gegenproben = new Map();
    if (!ohneKi && !abbruch && einheiten.length) {
      try {
        laeufe = await extrahiereMehrfach({
          gesetz, norm, einheiten,
          vorschlag: syntax.map((s, i) => ({ pfad: einheiten[i].pfad, typ: s.typ, elemente: s.elemente })),
          modelle: MODELLE, laeufe: LAEUFE, token: TOKEN, budget,
        });
        if (!ohneGegenprobe) {
          gegenproben = await macheGegenproben({ einheiten, syntax, laeufe, kontext });
        }
      } catch (fehler) {
        if (fehler instanceof ModellBudgetErschoepft || fehler instanceof ModellKontingentErschoepft) {
          console.warn(`  ⏸ ${fehler.message} — Rest bleibt im Zwischenstand`);
          abbruch = fehler.message;
        } else {
          console.warn(`  ⚠ ${norm.enbez}: ${fehler.message}`);
        }
      }
    }

    const erg = fuehreZusammen({ einheiten, syntax, laeufe, gegenproben, kontext });
    alleAbgelehnt.push(...erg.abgelehnt.map((a) => ({ norm: norm.enbez, ...a })));

    normen[norm.id] = bauAnnotation({ norm, erg, th, ohneKi });
    bearbeitet++;
    if (erg.markierbar) markierbar++;

    if (bearbeitet % 25 === 0) {
      process.stdout.write(`  ${bearbeitet + uebernommen}/${gesetz.normen.length}\r`);
      await schreibe(zwischenDatei, datei(gesetz, normen, true));
    }
    if (abbruch) break;
  }

  const inhalt = datei(gesetz, normen, Boolean(abbruch));
  if (!trocken) {
    if (abbruch) {
      await schreibe(zwischenDatei, inhalt);
      console.log(`  Zwischenstand gespeichert (${Object.keys(normen).length}/${gesetz.normen.length}).`);
    } else {
      const tmp = `${zielDatei}.tmp`;
      await schreibe(tmp, inhalt);
      await rename(tmp, zielDatei);
      await rm(zwischenDatei, { force: true });
      console.log(`  ✓ ${bearbeitet} neu, ${uebernommen} unverändert, ${markierbar} markierbar.`);
    }
  }

  bericht.gesetze.push({
    abk: gesetz.abk, normen: gesetz.normen.length, bearbeitet, uebernommen,
    markierbar, abgelehnt: alleAbgelehnt.length, vollstaendig: !abbruch,
  });
  if (!trocken) {
    await schreibe(path.join(BERICHTE, `abgelehnt-${kurz(meta.abk)}.json`), alleAbgelehnt.slice(0, 500));
  }
  if (abbruch) break;
}

bericht.modellaufrufe = budget.verbraucht;
bericht.abgebrochen = abbruch;
if (!trocken) await schreibe(path.join(BERICHTE, "annotation.json"), bericht);
console.log(`\nModellaufrufe: ${budget.verbraucht}${abbruch ? ` — abgebrochen: ${abbruch}` : ""}`);

/* ─────────────────────────── Bausteine ─────────────────────────── */

function wiederverwendbar({ datei, annotation, th }) {
  if (!annotation || annotation.text_hash !== th || Number(datei?.format) !== FORMAT) return false;

  // Ein rein syntaktischer Baseline-Lauf darf vorhandene höherwertige KI-Ergebnisse
  // niemals zurückstufen. Im KI-Modus werden Syntax-Baselines dagegen gezielt
  // auf den aktuellen Mehrfachlauf hochgestuft.
  if (ohneKi) return true;

  const verfahren = String(annotation.verfahren || datei?.verfahren || "");
  const hatMehrfachlauf = verfahren.includes("mehrfachlauf") && Number(annotation.laeufe || 0) >= LAEUFE;
  const hatGegenprobe = ohneGegenprobe || verfahren.includes("gegenprobe");
  const vorhandeneModelle = new Set(Array.isArray(datei?.modelle) ? datei.modelle : []);
  const modellePassend = MODELLE.every((modell) => vorhandeneModelle.has(modell));
  return hatMehrfachlauf && hatGegenprobe && modellePassend;
}

function bauAnnotation({ norm, erg, th, ohneKi }) {
  const alleElemente = erg.saetze.flatMap((s) => s.elemente);
  const typen = [...new Set(erg.saetze.map((s) => s.typ))];
  return {
    typ: typen.length === 1 ? typen[0] : "gemischt",
    typen,
    saetze: erg.saetze,
    schema: baueSchema(erg.saetze),
    // Rückwärtskompatible Felder für die bisherige Darstellung
    tb: alleElemente.filter((e) => e.art === "tb").map((e) => e.text),
    rf: alleElemente.filter((e) => e.art === "rf").map((e) => e.text),
    ausnahmen: alleElemente.filter((e) => e.art === "ausn").map((e) => e.text),
    status: erg.status,
    markierbar: erg.markierbar,
    konfidenz: erg.konfidenz,
    einstimmigkeit: erg.einstimmigkeit ?? null,
    laeufe: erg.laeufe,
    verfahren: ohneKi ? "syntaxanalyse" : "syntaxanalyse+mehrfachlauf+gegenprobe",
    hinweis: hinweistext(erg, ohneKi),
    text_hash: th,
    format: FORMAT,
    aktualisiert: new Date().toISOString(),
  };
}

function hinweistext(erg, ohneKi) {
  if (!erg.saetze.some((s) => s.elemente.length)) {
    return "Für diese Vorschrift wird keine Markierung erzeugt (Anwendungs- oder Verweisungsvorschrift ohne eigenständige Tatbestand-Rechtsfolge-Struktur).";
  }
  const basis = ohneKi
    ? "Rein syntaktisch erzeugt, ohne Modelllauf."
    : `Aus ${erg.laeufe} unabhängigen Modellläufen und einer Syntaxanalyse zusammengeführt; Übereinstimmung ${(100 * (erg.einstimmigkeit ?? 0)).toFixed(0)} %.`;
  const warnung = erg.status === "uneinheitlich"
    ? " Die Läufe widersprechen einander; die Markierung ist als unsicher gekennzeichnet."
    : "";
  return `${basis}${warnung} Automatisch erzeugt und nicht redaktionell geprüft. Keine Rechtsberatung.`;
}

function datei(gesetz, normen, unvollstaendig) {
  return {
    abk: gesetz.abk,
    titel: gesetz.titel,
    format: FORMAT,
    automatisch: true,
    verfahren: ohneKi ? "syntaxanalyse" : "syntaxanalyse+mehrfachlauf+gegenprobe",
    modelle: ohneKi ? ["nur-syntax"] : MODELLE,
    laeufe: ohneKi ? 0 : LAEUFE,
    aktualisiert: new Date().toISOString(),
    quelle: gesetz.quelle,
    stand: gesetz.stand,
    ...(unvollstaendig ? { unvollstaendig: true } : {}),
    normen,
  };
}

async function macheGegenproben({ einheiten, syntax, laeufe, kontext }) {
  const raus = new Map();
  for (const [i, e] of einheiten.entries()) {
    if (NICHT_MARKIEREN.has(syntax[i].typ)) continue;
    const kandidaten = sammleKandidaten(e, syntax[i], laeufe);
    if (!kandidaten.length) continue;
    try {
      raus.set(e.pfad, await gegenprobe({
        satztext: e.text, spannen: kandidaten,
        modell: MODELLE[0], token: TOKEN, budget,
      }));
    } catch (fehler) {
      if (fehler instanceof ModellBudgetErschoepft) throw fehler;
      // Ohne Gegenprobe weiterarbeiten; die Konfidenz fällt dadurch niedriger aus.
    }
  }
  return raus;
}

function sammleKandidaten(einheit, syn, laeufe) {
  const gesehen = new Set();
  const raus = [];
  const zufuegen = (text) => {
    const t = normText(text);
    if (!t || gesehen.has(t.toLowerCase())) return;
    gesehen.add(t.toLowerCase());
    raus.push({ text: t });
  };
  for (const lauf of laeufe) {
    const s = (lauf.saetze || []).find((x) => x.pfad === einheit.pfad);
    if (!s) continue;
    for (const f of ["tb", "rf", "ausnahmen"]) for (const t of s[f] || []) zufuegen(t);
  }
  for (const el of syn.elemente || []) zufuegen(el.text);
  return raus.slice(0, 12);
}

function gegenstandAus(gesetz) {
  return String(gesetz.titel || "").replace(/gesetz.*$/i, "").trim().toLowerCase();
}

async function lies(datei) {
  try { return JSON.parse(await readFile(datei, "utf8")); } catch { return null; }
}
async function schreibe(datei, inhalt) {
  if (trocken) return;
  await writeFile(datei, `${JSON.stringify(inhalt, null, 2)}\n`);
}
