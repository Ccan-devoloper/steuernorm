#!/usr/bin/env node
/** Vollautomatische, quellenbasierte Tatbestand-/Rechtsfolge-Annotation. */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eindeutig, hashText, logikAnalyse, textDerNorm } from "./lib/text.mjs";
import { ladeQuellen } from "./lib/quellen.mjs";
import {
  modellAufruf,
  ModellBudgetErschoepft,
  ModellKontingentErschoepft,
} from "./lib/model.mjs";
import { konsensAnnotation } from "./lib/konsens.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const DATEN = path.join(WURZEL, "data");
const ANNOTATIONEN = path.join(WURZEL, "annotations");
const FORTSCHRITT = path.join(WURZEL, ".ki-fortschritt");
const REPORTS = path.join(WURZEL, "reports");
const PIPELINE_VERSION = 2;
const MODELL = process.env.KI_MODELL || "openai/gpt-4.1-mini";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const BATCH_NORMEN = Math.max(1, Number(process.env.BATCH_NORMEN || 2));
const BATCH_ZEICHEN = Math.max(6_000, Number(process.env.BATCH_ZEICHEN || 9_000));
const TEIL_ZEICHEN = Math.max(4_000, Number(process.env.TEIL_ZEICHEN || 6_500));
const MAX_AUFRUFE_ROH = Number(process.env.MAX_MODELLAUFRUFE || Number.POSITIVE_INFINITY);
const budget = {
  maximum: Number.isFinite(MAX_AUFRUFE_ROH) ? Math.max(1, MAX_AUFRUFE_ROH) : Number.POSITIVE_INFINITY,
  verbraucht: 0,
};

const args = process.argv.slice(2);
function wert(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
function schluessel(eingabe) {
  return String(eingabe || "").trim().toLowerCase().replace(/\.json$/i, "").replace(/[^a-z0-9]/g, "");
}

const nurRoh = wert("--nur");
const nur = nurRoh ? new Set(nurRoh.split(",").map(schluessel).filter(Boolean)) : null;
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

function htmlSicher(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textTeilen(volltext) {
  if (volltext.length <= TEIL_ZEICHEN) return [volltext];
  const teile = [];
  let rest = volltext;
  while (rest.length > TEIL_ZEICHEN) {
    const minimum = Math.floor(TEIL_ZEICHEN * 0.55);
    const fenster = rest.slice(minimum, TEIL_ZEICHEN + 1);
    let schnitt = -1;
    for (const muster of [/[.;!?]\s+(?=[A-ZÄÖÜ§(])/g, /[,;:]\s+/g, /\s+/g]) {
      const treffer = [...fenster.matchAll(muster)];
      if (treffer.length) {
        const letzter = treffer[treffer.length - 1];
        schnitt = minimum + letzter.index + letzter[0].length;
        break;
      }
    }
    if (schnitt < minimum) schnitt = TEIL_ZEICHEN;
    const teil = rest.slice(0, schnitt).trim();
    if (teil) teile.push(teil);
    rest = rest.slice(schnitt).trimStart();
  }
  if (rest.trim()) teile.push(rest.trim());
  return teile;
}

function analyseTeile(eintrag) {
  const volltext = textDerNorm(eintrag.norm);
  const texte = textTeilen(volltext);
  return texte.map((text, index) => {
    const id = texte.length === 1 ? String(eintrag.norm.id) : `${eintrag.norm.id}::${index + 1}`;
    const norm = {
      ...eintrag.norm,
      id,
      enbez: texte.length === 1 ? eintrag.norm.enbez : `${eintrag.norm.enbez} – Teil ${index + 1}/${texte.length}`,
      abs: [{ n: null, html: htmlSicher(text) }],
    };
    return {
      analyseId: id,
      originalId: String(eintrag.norm.id),
      norm,
      text,
      gewicht: Math.max(1, text.length),
      logik: logikAnalyse(norm),
    };
  });
}

function batches(liste) {
  const ergebnis = [];
  let aktuell = [];
  let zeichen = 0;
  for (const eintrag of liste) {
    const groesse = eintrag.text.length + 900;
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

function kiTeileVereinen(originalId, teile) {
  if (!teile.length || teile.some((teil) => !teil.ki)) {
    throw new Error(`Unvollständige KI-Teilantwort für Norm ${originalId}`);
  }
  const klassen = teile.map((teil) => teil.ki.klassifikation);
  const normativ = new Set([
    "rule", "definition", "fiction", "obligation", "prohibition", "permission",
    "entitlement", "calculation", "procedure", "competence",
  ]);
  const normativeKlassen = klassen.filter((klasse) => normativ.has(klasse));
  let klassifikation = "no_classic_rule";
  if (normativeKlassen.includes("rule")) klassifikation = "rule";
  else if (normativeKlassen.length) klassifikation = normativeKlassen[0];
  else if (klassen.includes("reference_only")) klassifikation = "reference_only";

  const gesamtGewicht = teile.reduce((summe, teil) => summe + teil.gewicht, 0);
  const konfidenz = teile.reduce(
    (summe, teil) => summe + Math.max(0, Math.min(1, Number(teil.ki.konfidenz || 0))) * teil.gewicht,
    0,
  ) / Math.max(1, gesamtGewicht);

  return {
    id: originalId,
    klassifikation,
    tb: eindeutig(teile.flatMap((teil) => teil.ki.tb || [])),
    rf: eindeutig(teile.flatMap((teil) => teil.ki.rf || [])),
    ausnahmen: eindeutig(teile.flatMap((teil) => teil.ki.ausnahmen || [])),
    konfidenz: Number(konfidenz.toFixed(3)),
    quellen_support: eindeutig(teile.flatMap((teil) => teil.ki.quellen_support || []).map(String)),
    quellen_konsens: teile.some((teil) => teil.ki.quellen_konsens === true),
    begruendung_kurz: teile.map((teil) => teil.ki.begruendung_kurz).filter(Boolean).join(" ").slice(0, 240),
  };
}

function annotationsDatei(meta, gesetz, erreichbar, minimum, normen) {
  return {
    abk: meta.abk,
    titel: gesetz.titel,
    pipeline_version: PIPELINE_VERSION,
    automatisch: true,
    modell: ohneKi ? "nur-regellogik" : MODELL,
    aktualisiert: new Date().toISOString(),
    quellenpolitik: {
      minimum,
      erreichbar: erreichbar.length,
      methode: "mindestens vier Referenzen je Gesetz; direkte Normbelege separat",
    },
    normen,
  };
}

async function fortschrittSpeichern(datei, meta, gesetz, erreichbar, minimum, normen) {
  if (trocken) return;
  const inhalt = {
    ...annotationsDatei(meta, gesetz, erreichbar, minimum, normen),
    unvollstaendig: true,
    bearbeitet: Object.keys(normen).length,
    gesamt: gesetz.normen.length,
    modellaufrufe: budget.verbraucht,
  };
  await writeFile(datei, `${JSON.stringify(inhalt, null, 2)}\n`);
}

function markdown(bericht) {
  const zeilen = [
    "# KI-Annotationsfortschritt",
    "",
    `Erzeugt: ${bericht.aktualisiert}`,
    `Pipeline: v${bericht.pipeline_version}; Modell: ${bericht.modell}`,
    `Modellaufrufe in diesem Lauf: ${bericht.modellaufrufe}`,
    "",
    "| Gesetz | bearbeitet | gesamt | fertig | mit TB/RF |",
    "|---|---:|---:|:---:|---:|",
  ];
  for (const gesetz of bericht.gesetze) {
    zeilen.push(`| ${gesetz.abk} | ${gesetz.bearbeitet} | ${gesetz.normen} | ${gesetz.fertig ? "ja" : "nein"} | ${gesetz.mit_regel} |`);
  }
  zeilen.push("", "Automatisierte Strukturierungshilfe, keine Rechtsberatung.");
  return `${zeilen.join("\n")}\n`;
}

async function main() {
  await Promise.all([
    mkdir(ANNOTATIONEN, { recursive: true }),
    mkdir(FORTSCHRITT, { recursive: true }),
    mkdir(REPORTS, { recursive: true }),
  ]);

  const register = await json(path.join(DATEN, "index.json"));
  const config = await json(path.join(WURZEL, "config", "referenzquellen.json"));
  if (!register?.gesetze?.length) throw new Error("data/index.json enthält keine Gesetze");

  const gesetze = register.gesetze.filter((gesetz) => {
    if (!nur) return true;
    return [gesetz.abk, gesetz.slug, gesetz.datei].some((kandidat) => nur.has(schluessel(kandidat)));
  });
  if (!gesetze.length) {
    const verfuegbar = register.gesetze.map((gesetz) => `${gesetz.abk}/${gesetz.slug}/${gesetz.datei}`).join(", ");
    throw new Error(`Keine Gesetze für --nur ${nurRoh || "(leer)"} gefunden. Verfügbar: ${verfuegbar}`);
  }
  console.log(`Auswahl: ${gesetze.map((gesetz) => gesetz.abk).join(", ")}`);
  console.log(`Modellbudget: ${Number.isFinite(budget.maximum) ? budget.maximum : "unbegrenzt"} Aufrufe`);

  const bericht = {
    aktualisiert: new Date().toISOString(),
    pipeline_version: PIPELINE_VERSION,
    modell: ohneKi ? "nur-regellogik" : MODELL,
    modellaufrufe: 0,
    fortsetzung_noetig: false,
    gesetze: [],
  };
  let anhalten = false;

  for (const meta of gesetze) {
    if (anhalten) break;
    const gesetz = await json(path.join(DATEN, meta.datei));
    const ziel = path.join(ANNOTATIONEN, meta.datei);
    const standDatei = path.join(FORTSCHRITT, meta.datei);
    const alt = await json(ziel, { abk: meta.abk, normen: {} });
    const stand = voll ? { normen: {} } : await json(standDatei, { normen: {} });
    if (voll && !trocken) await rm(standDatei, { force: true });

    const quellen = await ladeQuellen(config, gesetz, WURZEL);
    const minimum = Math.max(4, Number(config.minimum_quellen || 4), minEnv);
    const erreichbar = quellen.filter((quelle) => quelle.erreichbar);
    const erreichbareIds = new Set(erreichbar.map((quelle) => quelle.id));
    if (erreichbar.length < minimum) {
      throw new Error(`${meta.abk}: weniger als ${minimum} unabhängige Quellen erreichbar`);
    }

    const ausgabe = {};
    const alle = gesetz.normen.map((norm) => {
      const textHash = hashText(textDerNorm(norm));
      const kandidaten = voll ? [] : [stand.normen?.[norm.id], alt.normen?.[norm.id]].filter(Boolean);
      const vorhanden = kandidaten.find((annotation) => {
        const quellenAktuell = Array.isArray(annotation.gesetz_quellen)
          && annotation.gesetz_quellen.length >= minimum
          && annotation.gesetz_quellen.every((id) => erreichbareIds.has(id));
        return annotation.text_hash === textHash
          && annotation.pipeline_version === PIPELINE_VERSION
          && annotation.gesetz_quellen_konsens === true
          && quellenAktuell;
      });
      if (vorhanden) ausgabe[norm.id] = vorhanden;
      return { norm, logik: logikAnalyse(norm), vorhanden };
    });

    const neu = alle.filter((eintrag) => !eintrag.vorhanden);
    const analyseEinheiten = neu.flatMap(analyseTeile);
    const teileSoll = new Map();
    for (const einheit of analyseEinheiten) {
      teileSoll.set(einheit.originalId, (teileSoll.get(einheit.originalId) || 0) + 1);
    }
    const gruppen = batches(analyseEinheiten);
    const teilAntworten = new Map();
    console.log(`\n${meta.abk}: ${gesetz.normen.length} Normen, ${neu.length} offen, ${gruppen.length} Batches`);

    for (const batch of gruppen) {
      let antwort;
      try {
        antwort = ohneKi
          ? null
          : await modellAufruf({ gesetz, batch, quellen, token: TOKEN, modell: MODELL, budget });
      } catch (fehler) {
        if (fehler instanceof ModellBudgetErschoepft || fehler instanceof ModellKontingentErschoepft) {
          console.warn(`${meta.abk}: ${fehler.message}; Zwischenstand wird gespeichert.`);
          anhalten = true;
          bericht.fortsetzung_noetig = true;
          break;
        }
        if (requireKi) throw fehler;
        console.warn(`${meta.abk}: KI ausgefallen, Logik übernimmt: ${fehler.message}`);
        antwort = null;
      }

      const map = new Map((antwort?.normen || []).map((eintrag) => [String(eintrag.id), eintrag]));
      if (requireKi) {
        const fehlend = batch.map((eintrag) => eintrag.analyseId).filter((id) => !map.has(id));
        if (fehlend.length) throw new Error(`${meta.abk}: Modellantwort fehlt für Teil(e) ${fehlend.join(", ")}`);
      }
      for (const eintrag of batch) {
        teilAntworten.set(eintrag.analyseId, { ...eintrag, ki: map.get(eintrag.analyseId) });
      }

      const beruehrteNormen = eindeutig(batch.map((eintrag) => eintrag.originalId));
      for (const originalId of beruehrteNormen) {
        if (ausgabe[originalId]) continue;
        const teile = [...teilAntworten.values()].filter((teil) => teil.originalId === originalId);
        if (teile.length !== teileSoll.get(originalId)) continue;
        const original = alle.find((eintrag) => String(eintrag.norm.id) === originalId);
        const ki = ohneKi ? null : kiTeileVereinen(originalId, teile);
        ausgabe[originalId] = konsensAnnotation({
          norm: original.norm,
          logik: original.logik,
          ki,
          quellen,
          gesetz,
          modell: MODELL,
          pipelineVersion: PIPELINE_VERSION,
          minQuellen: minimum,
        });
        await fortschrittSpeichern(standDatei, meta, gesetz, erreichbar, minimum, ausgabe);
      }
    }

    const fertig = gesetz.normen.every((norm) => Boolean(ausgabe[norm.id]));
    if (fertig) {
      const geordnet = {};
      for (const norm of gesetz.normen) geordnet[norm.id] = ausgabe[norm.id];
      if (!trocken) {
        await writeFile(ziel, `${JSON.stringify(annotationsDatei(meta, gesetz, erreichbar, minimum, geordnet), null, 2)}\n`);
        await rm(standDatei, { force: true });
      }
      console.log(`${meta.abk}: vollständig; veröffentlichungsfähige Annotationsdatei erzeugt.`);
    } else {
      await fortschrittSpeichern(standDatei, meta, gesetz, erreichbar, minimum, ausgabe);
      bericht.fortsetzung_noetig = true;
      console.log(`${meta.abk}: ${Object.keys(ausgabe).length}/${gesetz.normen.length} Normen gesichert; Fortsetzung folgt.`);
    }

    const werte = Object.values(ausgabe);
    bericht.gesetze.push({
      abk: meta.abk,
      normen: gesetz.normen.length,
      bearbeitet: werte.length,
      fertig,
      mit_regel: werte.filter((annotation) => annotation.tb?.length && annotation.rf?.length).length,
    });
  }

  bericht.modellaufrufe = budget.verbraucht;
  if (!trocken) {
    await writeFile(path.join(REPORTS, "annotation-progress.json"), `${JSON.stringify(bericht, null, 2)}\n`);
    await writeFile(path.join(REPORTS, "annotation-progress.md"), markdown(bericht));
  }
  console.log(`\nModellaufrufe: ${budget.verbraucht}. Fortsetzung nötig: ${bericht.fortsetzung_noetig ? "ja" : "nein"}.`);
}

try {
  await main();
} catch (fehler) {
  console.error(`KI-Annotation fehlgeschlagen: ${fehler.stack || fehler.message}`);
  process.exitCode = 1;
}
