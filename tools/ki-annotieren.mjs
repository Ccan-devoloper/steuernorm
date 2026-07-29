#!/usr/bin/env node
/** Vollautomatische, quellenbasierte Tatbestand-/Rechtsfolge-Annotation. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashText, logikAnalyse, textDerNorm } from "./lib/text.mjs";
import { ladeQuellen } from "./lib/quellen.mjs";
import { modellAufruf } from "./lib/model.mjs";
import { konsensAnnotation } from "./lib/konsens.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const DATEN = path.join(WURZEL, "data");
const ANNOTATIONEN = path.join(WURZEL, "annotations");
const REPORTS = path.join(WURZEL, "reports");
const PIPELINE_VERSION = 2;
const MODELL = process.env.KI_MODELL || "openai/gpt-4.1-mini";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const BATCH_NORMEN = Math.max(1, Number(process.env.BATCH_NORMEN || 6));
const BATCH_ZEICHEN = Math.max(8_000, Number(process.env.BATCH_ZEICHEN || 26_000));

const args = process.argv.slice(2);
function wert(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
function schluessel(wert) {
  return String(wert || "").trim().toLowerCase().replace(/\.json$/i, "").replace(/[^a-z0-9]/g, "");
}

const nurRoh = wert("--nur");
const nur = nurRoh
  ? new Set(nurRoh.split(",").map(schluessel).filter(Boolean))
  : null;
const voll = args.includes("--voll");
const trocken = args.includes("--trocken");
const ohneKi = args.includes("--ohne-ki") || !TOKEN;
const requireKi = process.env.REQUIRE_AI === "1";
const minEnv = Number(process.env.MIN_QUELLEN || 0);

if (requireKi && ohneKi) throw new Error("REQUIRE_AI=1, aber kein GitHub-Token verfügbar");

async function json(datei, fallback = null) {
  try {
    return JSON.parse(await readFile(datei, "utf8"));
  } catch (fehler) {
    if (fehler.code === "ENOENT") return fallback;
    throw fehler;
  }
}

function batches(liste) {
  const ergebnis = [];
  let aktuell = [];
  let zeichen = 0;
  for (const eintrag of liste) {
    const groesse = textDerNorm(eintrag.norm).length + 1_200;
    if (aktuell.length && (aktuell.length >= BATCH_NORMEN || zeichen + groesse > BATCH_ZEICHEN)) {
      ergebnis.push(aktuell);
      aktuell = [];
      zeichen = 0;
    }
    aktuell.push(eintrag);
    zeichen += groesse;
  }
  if (aktuell.length) ergebnis.push(aktuell);
  return ergebnis;
}

function markdown(bericht) {
  const zeilen = [
    "# KI-Annotationsabdeckung",
    "",
    `Erzeugt: ${bericht.aktualisiert}`,
    `Pipeline: v${bericht.pipeline_version}; Modell: ${bericht.modell}`,
    "",
    "| Gesetz | Normen | mit TB/RF | anders klassifiziert | Quellen min. | Ø Konfidenz |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  for (const gesetz of bericht.gesetze) {
    zeilen.push(`| ${gesetz.abk} | ${gesetz.normen} | ${gesetz.mit_regel} | ${gesetz.ohne_klassische_regel} | ${gesetz.quellen_min} | ${(gesetz.konfidenz_mittel * 100).toFixed(1)} % |`);
  }
  zeilen.push(
    "",
    `**Gesamt:** ${bericht.gesamt.normen} Normen; ${bericht.gesamt.mit_regel} mit automatisch erkannter Tatbestand-Rechtsfolge-Struktur.`,
    "",
    "Automatisierte Strukturierungshilfe, keine Rechtsberatung.",
  );
  return `${zeilen.join("\n")}\n`;
}

async function main() {
  await Promise.all([
    mkdir(ANNOTATIONEN, { recursive: true }),
    mkdir(REPORTS, { recursive: true }),
  ]);

  const register = await json(path.join(DATEN, "index.json"));
  const config = await json(path.join(WURZEL, "config", "referenzquellen.json"));
  if (!register?.gesetze?.length) throw new Error("data/index.json enthält keine Gesetze");

  const gesetze = register.gesetze.filter((gesetz) => {
    if (!nur) return true;
    const kandidaten = [gesetz.abk, gesetz.slug, gesetz.datei];
    return kandidaten.some((kandidat) => nur.has(schluessel(kandidat)));
  });
  if (!gesetze.length) {
    const verfuegbar = register.gesetze.map((gesetz) => `${gesetz.abk}/${gesetz.slug}/${gesetz.datei}`).join(", ");
    throw new Error(`Keine Gesetze für --nur ${nurRoh || "(leer)"} gefunden. Verfügbar: ${verfuegbar}`);
  }
  console.log(`Auswahl: ${gesetze.map((gesetz) => gesetz.abk).join(", ")}`);

  const bericht = {
    aktualisiert: new Date().toISOString(),
    pipeline_version: PIPELINE_VERSION,
    modell: ohneKi ? "nur-regellogik" : MODELL,
    gesetze: [],
  };

  for (const meta of gesetze) {
    const gesetz = await json(path.join(DATEN, meta.datei));
    const ziel = path.join(ANNOTATIONEN, meta.datei);
    const alt = await json(ziel, { abk: meta.abk, normen: {} });
    const quellen = await ladeQuellen(config, gesetz, WURZEL);
    const minimum = Math.max(4, Number(config.minimum_quellen || 4), minEnv);
    const erreichbar = quellen.filter((quelle) => quelle.erreichbar);
    const erreichbareIds = new Set(erreichbar.map((quelle) => quelle.id));
    if (erreichbar.length < minimum) {
      throw new Error(`${meta.abk}: weniger als ${minimum} unabhängige Quellen erreichbar`);
    }

    const alle = gesetz.normen.map((norm) => {
      const textHash = hashText(textDerNorm(norm));
      const vorhanden = alt.normen?.[norm.id];
      const supportAktuell = Array.isArray(vorhanden?.quellen_support)
        && vorhanden.quellen_support.length >= minimum
        && vorhanden.quellen_support.every((id) => erreichbareIds.has(id));
      return {
        norm,
        logik: logikAnalyse(norm),
        vorhanden,
        wiederverwenden:
          !voll
          && vorhanden?.text_hash === textHash
          && vorhanden?.pipeline_version === PIPELINE_VERSION
          && supportAktuell,
      };
    });

    const neu = alle.filter((eintrag) => !eintrag.wiederverwenden);
    const ausgabe = {};
    for (const eintrag of alle.filter((x) => x.wiederverwenden)) {
      ausgabe[eintrag.norm.id] = eintrag.vorhanden;
    }

    const gruppen = batches(neu);
    console.log(`\n${meta.abk}: ${gesetz.normen.length} Normen, ${neu.length} neu/geändert, ${gruppen.length} Batches`);

    for (const batch of gruppen) {
      let antwort = null;
      try {
        antwort = ohneKi ? null : await modellAufruf({ gesetz, batch, quellen, token: TOKEN, modell: MODELL });
      } catch (fehler) {
        if (requireKi) throw fehler;
        console.warn(`${meta.abk}: KI ausgefallen, Logik übernimmt: ${fehler.message}`);
      }

      const map = new Map((antwort?.normen || []).map((eintrag) => [String(eintrag.id), eintrag]));
      if (requireKi) {
        const fehlend = batch.map((eintrag) => String(eintrag.norm.id)).filter((id) => !map.has(id));
        if (fehlend.length) throw new Error(`${meta.abk}: Modellantwort fehlt für Norm(en) ${fehlend.join(", ")}`);
      }

      for (const eintrag of batch) {
        ausgabe[eintrag.norm.id] = konsensAnnotation({
          norm: eintrag.norm,
          logik: eintrag.logik,
          ki: map.get(String(eintrag.norm.id)),
          quellen,
          gesetz,
          modell: MODELL,
          pipelineVersion: PIPELINE_VERSION,
          minQuellen: minimum,
        });
      }
    }

    const geordnet = {};
    for (const norm of gesetz.normen) {
      if (!ausgabe[norm.id]) throw new Error(`${meta.abk} ${norm.enbez}: keine Annotation erzeugt`);
      geordnet[norm.id] = ausgabe[norm.id];
    }

    const datei = {
      abk: meta.abk,
      titel: gesetz.titel,
      pipeline_version: PIPELINE_VERSION,
      automatisch: true,
      modell: ohneKi ? "nur-regellogik" : MODELL,
      aktualisiert: new Date().toISOString(),
      quellenpolitik: {
        minimum,
        erreichbar: erreichbar.length,
        methode: "ausdrücklicher KI-Support plus deterministische Regellogik",
      },
      normen: geordnet,
    };
    if (!trocken) await writeFile(ziel, `${JSON.stringify(datei, null, 2)}\n`);

    const werte = Object.values(geordnet);
    const mitRegel = werte.filter((annotation) => annotation.tb?.length && annotation.rf?.length).length;
    bericht.gesetze.push({
      abk: meta.abk,
      normen: werte.length,
      mit_regel: mitRegel,
      ohne_klassische_regel: werte.length - mitRegel,
      quellen_min: Math.min(...werte.map((annotation) => annotation.quellen_support?.length || 0)),
      konfidenz_mittel: werte.reduce((summe, annotation) => summe + Number(annotation.konfidenz || 0), 0) / Math.max(1, werte.length),
    });
  }

  bericht.gesamt = {
    normen: bericht.gesetze.reduce((summe, gesetz) => summe + gesetz.normen, 0),
    mit_regel: bericht.gesetze.reduce((summe, gesetz) => summe + gesetz.mit_regel, 0),
  };
  if (!trocken) {
    await writeFile(path.join(REPORTS, "annotation-coverage.json"), `${JSON.stringify(bericht, null, 2)}\n`);
    await writeFile(path.join(REPORTS, "annotation-coverage.md"), markdown(bericht));
  }
  console.log(`\nFertig: ${bericht.gesamt.mit_regel}/${bericht.gesamt.normen} Normen mit TB/RF.`);
}

main().catch((fehler) => {
  console.error(`KI-Annotation fehlgeschlagen: ${fehler.stack || fehler.message}`);
  process.exitCode = 1;
});
