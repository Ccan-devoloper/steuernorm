#!/usr/bin/env node
/**
 * annotieren.mjs — erzeugt die Annotationen vollautomatisch.
 *
 *   node tools/annotieren.mjs                      alle Gesetze
 *   node tools/annotieren.mjs --nur solzg,estg
 *   node tools/annotieren.mjs --gold               nur die Normen des Goldstandards
 *   node tools/annotieren.mjs --normen ustg:10,ao:12
 *   node tools/annotieren.mjs --ohne-ki            nur Syntaxanalyse, kein Netz
 *   node tools/annotieren.mjs --laeufe 3           Anzahl unabhängiger Modellläufe
 *   node tools/annotieren.mjs --ohne-gegenprobe    spart Aufrufe
 *   node tools/annotieren.mjs --trocken            nichts schreiben
 *
 * Umgebung:
 *   GEMINI_API_KEY   Zugang zur kostenlosen Gemini-Freistufe (aistudio.google.com/app/apikey)
 *                    GitHub Models wurde am 30.07.2026 abgeschaltet.
 *   KI_SCHLUESSEL    Schlüssel eines beliebigen Anbieters — hat Vorrang.
 *   KI_ENDPUNKT      Anderer OpenAI-kompatibler Endpunkt, ohne „/chat/completions".
 *   KI_MODELLE       kommagetrennt, Voreinstellung: gemini-2.5-flash,gemini-2.0-flash
 *   KI_MINDESTABSTAND_MS  Wartezeit zwischen zwei Modellaufrufen, Voreinstellung 6500
 *   MAX_MODELLAUFRUFE Tagesbudget, Voreinstellung 400
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { einheiten as zerlegeNorm } from "./lib/gliederung.mjs";
import { zerlege as syntaxZerlege, NICHT_MARKIEREN } from "./lib/syntax.mjs";
import { baueSchema, fuehreZusammen, normText } from "./lib/konsens.mjs";
import {
  einAufruf, extrahiereMehrfach, gegenprobe,
  verfuegbareModelle, modelleAbgleichen, modelleOrdnen, modellAntwortet,
  erschoepfteModelle, unbrauchbareAntworten,
  ModellBudgetErschoepft, ModellKontingentErschoepft,
} from "./lib/modell.mjs";
// ModellTageslimitErschoepft wird nicht eigens importiert — sie erbt von
// ModellBudgetErschoepft und wird daher überall automatisch mit erfasst.
import { belegProbe, probeAnwenden } from "./lib/belegprobe.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const DATEN = path.join(WURZEL, "data");
const ZIEL = path.join(WURZEL, "annotations");
const ZWISCHEN = path.join(WURZEL, ".fortschritt");
const BERICHTE = path.join(WURZEL, "reports");
const BELEGE = path.join(WURZEL, "belege");
const FORMAT = 5;

const args = process.argv.slice(2);
const flagWert = (f, v = null) => { const i = args.indexOf(f); return i >= 0 ? (args[i + 1] ?? v) : v; };
const hat = (f) => args.includes(f);

// GitHub Models wurde am 30.07.2026 abgeschaltet. Voreingestellt ist die
// KOSTENLOSE Gemini-Freistufe (Google AI Studio); GEMINI_API_KEY ist dafür der
// maßgebliche Name, GOOGLE_API_KEY ein gängiger Alias. KI_SCHLUESSEL steht
// davor und gilt für jeden Anbieter — zusammen mit KI_ENDPUNKT (siehe
// lib/modell.mjs) ist ein Anbieterwechsel damit reine Umgebung.
const TOKEN = process.env.KI_SCHLUESSEL
  || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
// Zwei unterschiedliche Gemini-Modelle für die Mehrfachläufe — dieselbe Überlegung
// wie zuvor bei zwei OpenAI-Modellen: getrennte Modelle irren seltener übereinstimmend
// als zwei Temperaturen desselben Modells. Beide liegen auf der kostenlosen Freistufe.
/* `?? ""` statt `|| "…"`: KI_MODELLE="" heißt AUSDRÜCKLICH „automatisch
   wählen". Mit `||` war der leere String falsch und fiel auf zwei fest
   eingetragene Namen zurück — genau die beiden, die nicht mehr gehen. Der
   Workflow setzte die Automatik damit still wieder ab. */
const MODELLWUNSCH = (process.env.KI_MODELLE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/* Wird gleich gegen die tatsächlich verfügbaren Modelle abgeglichen. Ein fest
   eingetragener Name überlebt keinen Zeitraum: Google zieht Modelle zurück,
   und die API antwortet dann mit HTTP 404 — derselben Zahl wie bei einem
   falschen Pfad, aber einer ganz anderen als bei einem ungültigen Schlüssel. */
let MODELLE = MODELLWUNSCH;
const aufwerten = hat("--aufwerten");
/* Erzwingt Neuberechnung, auch wenn sich der Normtext nicht geändert hat.
   Wird gebraucht, sobald sich eine REGEL ändert: Der Zwischenstand hängt am
   Texthash, und der bleibt gleich — eine verbesserte Syntaxregel schlüge sonst
   nirgends durch, und die Messung gegen den Goldstandard zeigte den alten
   Stand. Höherwertige KI-Ergebnisse bleiben geschützt (siehe unten). */
const neuRechnen = hat("--neu");
const ohneKi = hat("--ohne-ki") || !TOKEN;

if (!TOKEN && !hat("--ohne-ki")) {
  console.error("");
  console.error("  ⚠  Kein Schlüssel gesetzt — es läuft NUR die Syntaxanalyse.");
  console.error("     Erwartet wird KI_SCHLUESSEL oder GEMINI_API_KEY.");
  console.error("     Kostenlosen Schlüssel holen: aistudio.google.com/app/apikey");
  console.error("     (kein Zahlungsmittel nötig). Im Workflow benötigt:");
  console.error("     env.GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}");
  console.error("     Secret anlegen unter: Repository → Settings → Secrets and variables");
  console.error("     → Actions → New repository secret → Name GEMINI_API_KEY.");
  console.error("     Lokal: export GEMINI_API_KEY=...");
  console.error("");
}
const ohneGegenprobe = hat("--ohne-gegenprobe");
const ohneBelegprobe = hat("--ohne-belegprobe");
const trocken = hat("--trocken");
const LAEUFE = Math.max(1, Number(flagWert("--laeufe", process.env.KI_LAEUFE || 3)));
// Deutlich niedriger als beim kostenpflichtigen Zugang: Berichte zur täglichen
// Obergrenze der Gemini-Freistufe schwanken zwischen rund 250 und 1500 Anfragen und
// werden von Google ohne Vorankündigung angepasst. 180 bleibt sicher darunter, auch
// im ungünstigsten gemeldeten Fall — der Rest folgt automatisch am nächsten Tag.
const budget = { maximum: Number(process.env.MAX_MODELLAUFRUFE || 180), verbraucht: 0 };
let belegLiegtVor = false;

const nurRoh = flagWert("--nur");
const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");
let nur = nurRoh ? new Set(nurRoh.split(",").map(kurz).filter(Boolean)) : null;

/* ── Filter auf einzelne NORMEN ───────────────────────────────────────
   `--nur` schränkt auf Gesetze ein, und das reicht nicht: Die 45 Normen des
   Goldstandards verteilen sich über alle vierzehn Gesetze. Ein Lauf mit dem
   Tagesbudget von 180 Aufrufen hätte sie nie erreicht — er wäre der Reihe nach
   durch die AO gelaufen und hätte 45 Normen annotiert, von denen keine
   einzige gemessen werden kann.

   `--gold` liest die Auswahl aus `eval/gold/`. Damit kostet ein Messlauf genau
   so viel Kontingent, wie er messbar macht: 45 Normen × 4 Aufrufe = 180. */
const normenRoh = flagWert("--normen");
let normFilter = null;

if (hat("--gold")) {
  const { readdir } = await import("node:fs/promises");
  normFilter = new Map();
  for (const datei of (await readdir(path.join(WURZEL, "eval", "gold"))).filter((d) => d.endsWith(".json"))) {
    const gold = JSON.parse(await readFile(path.join(WURZEL, "eval", "gold", datei), "utf8"));
    const schluessel = kurz(gold.abk || datei);
    const ids = new Set(Object.keys(gold.normen || {}).map(String));
    normFilter.set(schluessel, new Set([...(normFilter.get(schluessel) || []), ...ids]));
  }
} else if (normenRoh) {
  /* Schreibweise: gesetz:id, kommagetrennt — „ustg:10,ao:12" */
  normFilter = new Map();
  for (const stueck of normenRoh.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [g, id] = stueck.split(":");
    if (!g || !id) { console.error(`--normen: „${stueck}" ist kein gesetz:id`); process.exit(2); }
    const schluessel = kurz(g);
    if (!normFilter.has(schluessel)) normFilter.set(schluessel, new Set());
    normFilter.get(schluessel).add(String(id));
  }
}

if (normFilter) {
  /* Der Normfilter zieht den Gesetzesfilter nach: Ein Gesetz ohne ausgewählte
     Norm wird gar nicht erst geöffnet. */
  const betroffen = new Set(normFilter.keys());
  nur = nur ? new Set([...nur].filter((k) => betroffen.has(k))) : betroffen;
  const zahl = [...normFilter.values()].reduce((a, s) => a + s.size, 0);
  console.error(`  Normfilter: ${zahl} Normen in ${normFilter.size} Gesetzen`
    + ` (rechnerisch ${zahl * (LAEUFE + 1)} Aufrufe bei ${LAEUFE} Läufen und Gegenprobe)`);
}

const hash = (s) => createHash("sha256").update(s).digest("hex");

/* ─────────────────────────── Lauf ─────────────────────────── */

/* ── Modelle gegen den Schlüssel abgleichen ──────────────────────────
   Vor der ersten Norm, nicht mittendrin: Ein Lauf, der nach zwanzig Minuten
   an einem gesperrten Modell scheitert, hat zwanzig Minuten Kontingent
   verbrannt.

   ZWEI STUFEN, und die zweite ist die wichtige. Die Modellliste sagt, was
   EXISTIERT — nicht, was dieser Schlüssel aufrufen darf. `gemini-2.5-flash`
   steht dort und antwortet trotzdem mit „404 This model is no longer
   available to new users". Gelistet und gesperrt zugleich. Diese
   Unterscheidung kennt nur der Aufruf selbst, also wird jedes Modell einmal
   mit einem Token angepingt, bevor es zum Einsatz kommt. */
if (!ohneKi) {
  try {
    const verfuegbar = await verfuegbareModelle(TOKEN);
    const { modelle: gewaehlt, ersetzt } = modelleAbgleichen(MODELLWUNSCH, verfuegbar);

    for (const { gewuenscht, statt } of ersetzt) {
      console.error(statt
        ? `  ⚠  Modell ${gewuenscht} steht nicht in der Liste — es läuft ${statt}.`
        : `  ⚠  Modell ${gewuenscht} steht nicht in der Liste, und kein Ersatz derselben Familie ist da.`);
    }

    /* Stufe zwei: Wer antwortet wirklich? Reihum durch die geordneten
       Kandidaten.

       GESUCHT WERDEN VIER, nicht zwei. Gearbeitet wird mit den ersten beiden;
       die anderen sind Ausweichgleis. Die Freistufe zählt je Modell getrennt,
       und ein Lauf über 1 537 Normen läuft zuverlässig in eine
       Kontingentgrenze — dann wird das Modell gewechselt statt der Lauf
       abgebrochen. Vier Probeaufrufe kosten vier Token. */
    const RESERVE = 4;
    const kandidaten = [...gewaehlt,
      ...modelleOrdnen(verfuegbar, "flash").filter((m) => !gewaehlt.includes(m))];
    const tauglich = [];
    const abgelehnt = [];
    for (const modell of kandidaten) {
      if (tauglich.length >= RESERVE) break;
      const probe = await modellAntwortet(TOKEN, modell);
      if (probe.ok) { tauglich.push(modell); continue; }
      abgelehnt.push(`${modell} (HTTP ${probe.status}: ${probe.meldung.slice(0, 90)})`);
    }

    for (const zeile of abgelehnt) console.error("  ⚠  Antwortet nicht: " + zeile);

    if (!tauglich.length) {
      console.error("");
      console.error("  ⚠  Kein einziges Modell antwortet auf diesen Schlüssel.");
      console.error("     Gelistet sind:");
      for (const m of modelleOrdnen(verfuegbar, "flash").slice(0, 12)) console.error("       " + m);
      console.error("");
      console.error("     Genaueres zeigt: node tools/modelle-zeigen.mjs");
      process.exit(3);
    }

    MODELLE = tauglich;
    console.error(`  Modelle: ${MODELLE.slice(0, 2).join(", ")}`
      + (MODELLE.length > 2 ? `  ·  Ausweich: ${MODELLE.slice(2).join(", ")}` : "")
      + `  (${verfuegbar.length} gelistet, ${abgelehnt.length} abgelehnt)`);
  } catch (fehler) {
    /* Die Prüfung ist eine Hilfe, kein Muss. Fällt sie aus, wird mit dem Wunsch
       weitergearbeitet — scheitert der, sagt der Fehler des ersten Aufrufs,
       woran es lag. */
    console.error("  ⚠  Modellprüfung nicht möglich: " + fehler.message);
    console.error("     Es wird mit " + MODELLWUNSCH.join(", ") + " weitergearbeitet.");
  }
}

const register = JSON.parse(await readFile(path.join(DATEN, "index.json"), "utf8"));
const gesetze = register.gesetze.filter((m) => !nur || [m.abk, m.slug, m.datei].some((k) => nur.has(kurz(k))));
if (!gesetze.length) { console.error("Kein passendes Gesetz gefunden."); process.exit(2); }

await mkdir(ZWISCHEN, { recursive: true });
await mkdir(BERICHTE, { recursive: true });

const bericht = { erzeugt: new Date().toISOString(), format: FORMAT, modelle: ohneKi ? ["nur-syntax"] : MODELLE, laeufe: ohneKi ? 0 : LAEUFE, gesetze: [] };
let abbruch = null;
const belegBilanz = { gestuetzt: 0, entfernt: 0, strittig: 0 };

for (const meta of gesetze) {
  const gesetz = JSON.parse(await readFile(path.join(DATEN, meta.datei), "utf8"));
  const belegdatei = await lies(path.join(BELEGE, meta.datei));
  const zielDatei = path.join(ZIEL, meta.datei);
  const zwischenDatei = path.join(ZWISCHEN, meta.datei);
  const alt = await lies(zielDatei);
  const zwischenstand = await lies(zwischenDatei);
  const normen = {};
  let bearbeitet = 0, uebernommen = 0, markierbar = 0;
  const alleAbgelehnt = [];

  console.log(`\n${gesetz.abk} — ${gesetz.normen.length} Normen`);

  for (const norm of gesetz.normen) {
    /* Nicht ausgewählt: Die vorhandene Annotation bleibt unangetastet stehen —
       ein Filterlauf darf den Bestand nicht ausdünnen. */
    if (normFilter && !(normFilter.get(kurz(meta.abk)) || new Set()).has(String(norm.id))) {
      const bestand = alt?.normen?.[norm.id];
      if (bestand) {
        normen[norm.id] = bestand;
        uebernommen++;
        if (bestand.markierbar) markierbar++;
      }
      continue;
    }

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

    // Aufzählungsglieder brauchen ihren Einleitungssatz: Das Prädikat steht dort,
    // nicht im Glied selbst.
    const syntax = einheiten.map((e, i) => syntaxZerlege(e.text, {
      normtitel: norm.titel,
      ebene: e.ebene,
      nr: e.nr,
      einleitung: e.ebene === "nr" ? einleitungZu(einheiten, i) : null,
    }));
    const kontext = { volltext, gegenstand: gegenstandAus(gesetz) };
    const normBelege = belegdatei?.normen?.[norm.id] ?? null;
    if (normBelege?.verwaltung?.length || normBelege?.rechtsprechung?.length) belegLiegtVor = true;

    let laeufe = [];
    let gegenproben = new Map();
    if (!ohneKi && !abbruch && einheiten.length) {
      try {
        laeufe = await extrahiereMehrfach({
          gesetz, norm, einheiten,
          vorschlag: syntax.map((s, i) => ({ pfad: einheiten[i].pfad, typ: s.typ, elemente: s.elemente })),
          belege: normBelege,
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

    const erg = fuehreZusammen({ einheiten, syntax, laeufe, gegenproben, belege: normBelege, kontext });

    // Belegprobe: trägt die genannte Fundstelle die Zuordnung tatsächlich?
    // Der bisherige Validator schließt nur ERFUNDENE Fundstellen aus, nicht
    // falsch zugeordnete. Ein getrennter Aufruf sieht nur Belegtext und Behauptung.
    if (!ohneKi && !ohneBelegprobe && !abbruch && normBelege && erg.belegquote) {
      try {
        for (const satz of erg.saetze) {
          if (!satz.elemente.some((e) => e.beleg)) continue;
          const urteile = await belegProbe({
            spannen: satz.elemente, belege: normBelege,
            aufrufen: einAufruf, modell: MODELLE[0], token: TOKEN, budget,
          });
          const b = probeAnwenden(satz.elemente, urteile);
          belegBilanz.gestuetzt += b.gestuetzt;
          belegBilanz.entfernt += b.entfernt;
          belegBilanz.strittig += b.strittig;
        }
        neuBewerten(erg);
      } catch (fehler) {
        if (fehler instanceof ModellBudgetErschoepft) { abbruch = fehler.message; }
        // ModellKontingentErschoepft (z. B. eine einzelne fehlgeschlagene Gegenprobe)
        // bleibt bewusst ohne Abbruch — nur die eigentliche Extraktion oben löst
        // bei diesem Fehlertyp einen vollständigen Stopp aus.
      }
    }
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
      /* UND IN DEN BESTAND. Der Zwischenstand allein reichte nicht: Solange
         der Lauf am Tagesbudget abbricht, wurde `annotations/<gesetz>.json`
         nie geschrieben — bei 503 Normen der AO und 18 Normen je Tag wären das
         achtundzwanzig Tage, in denen die Oberfläche nichts von der Arbeit
         sieht, weil `struktur/` aus `annotations/` gebildet wird.
         Ersetzt werden darf die Datei dabei NICHT: Nach dem Abbruch enthält
         `normen` nur die bearbeiteten, die übrigen 485 stünden nicht darin und
         verschwänden. Der Teilstand wird deshalb über den vorhandenen gelegt. */
      const zusammen = { ...(alt?.normen || {}), ...normen };
      const tmp = `${zielDatei}.tmp`;
      await schreibe(tmp, datei(gesetz, zusammen, true));
      await rename(tmp, zielDatei);
      console.log(`  Zwischenstand gespeichert (${Object.keys(normen).length}/${gesetz.normen.length})`
        + `, ${Object.keys(zusammen).length} Normen im Bestand.`);
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
    /* Der Bericht sammelt nur über die BEARBEITETEN Normen. Ein Filterlauf
       hätte ihn deshalb geleert — 11 545 Zeilen Verworfenes wären beim ersten
       Messlauf verschwunden, obwohl die zugehörigen Annotationen unverändert
       stehen. Was nicht angefasst wurde, bleibt darum stehen. */
    const datei = path.join(BERICHTE, `abgelehnt-${kurz(meta.abk)}.json`);
    let eintraege = alleAbgelehnt;
    if (normFilter) {
      const angefasst = new Set(alleAbgelehnt.map((a) => a.norm));
      const frueher = (await lies(datei)) || [];
      eintraege = [...(Array.isArray(frueher) ? frueher : []).filter((a) => !angefasst.has(a.norm)),
        ...alleAbgelehnt];
    }
    await schreibe(datei, eintraege.slice(0, 500));
  }
  if (abbruch) break;
}

bericht.modellaufrufe = budget.verbraucht;
/* Was das Modell zurückgab, wenn es nichts Brauchbares zurückgab. Ohne diese
   Zeilen sieht man nur, DASS nichts ankam. */
const unbrauchbar = unbrauchbareAntworten();
if (unbrauchbar.length) bericht.unbrauchbareAntworten = unbrauchbar;
bericht.belegprobe = belegBilanz;
bericht.abgebrochen = abbruch;
if (!trocken) await schreibe(path.join(BERICHTE, "annotation.json"), bericht);
console.log(`\nModellaufrufe: ${budget.verbraucht}${abbruch ? ` — abgebrochen: ${abbruch}` : ""}`);
/* Welche Modelle unterwegs ans Kontingent gestoßen sind. Ohne diese Zeile
   sieht ein halber Lauf wie ein Fehler aus, obwohl er die Freistufe schlicht
   ausgeschöpft hat — und am nächsten Tag fortsetzt. */
const gebremst = erschoepfteModelle();
if (gebremst.length) {
  console.log(`Am Kontingent: ${gebremst.join(", ")} — die Freistufe zählt je Modell und setzt täglich zurück.`);
}
if (belegBilanz.gestuetzt || belegBilanz.entfernt || belegBilanz.strittig) {
  console.log(`Belegprobe: ${belegBilanz.gestuetzt} gestützt, ${belegBilanz.entfernt} nicht tragfähig entfernt, ${belegBilanz.strittig} strittig.`);
}

/* ─────────────────────────── Bausteine ─────────────────────────── */

function wiederverwendbar({ datei, annotation, th }) {
  if (!annotation || annotation.text_hash !== th || Number(datei?.format) !== FORMAT) return false;

  /* --neu rechnet rein syntaktische Annotationen neu. Was aus Mehrfachläufen
     stammt, bleibt unangetastet: Eine Regeländerung rechtfertigt es nicht,
     geprüfte Modellergebnisse wegzuwerfen. */
  if (neuRechnen && !String(annotation.verfahren || "").includes("mehrfachlauf")) return false;

  // --aufwerten: alles neu rechnen, was noch rein syntaktisch ist oder keinen Beleg trägt.
  if (aufwerten && !ohneKi) {
    const v = String(annotation.verfahren || "");
    if (!v.includes("mehrfachlauf")) return false;
    if (annotation.status === "uneinheitlich") return false;
    if (belegLiegtVor && !Number(annotation.belegquote || 0)) return false;
  }

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
    definitionen: alleElemente.filter((e) => e.art === "def").map((e) => e.text),
    status: erg.status,
    markierbar: erg.markierbar,
    konfidenz: erg.konfidenz,
    belegquote: erg.belegquote ?? 0,
    belege: belegzusammenfassung(erg),
    strittig: Boolean(erg.strittig),
    einstimmigkeit: erg.einstimmigkeit ?? null,
    laeufe: erg.laeufe,
    /* Das Verfahren muss sagen, was WIRKLICH geschehen ist, nicht in welchem
       Modus der Lauf gestartet wurde. Eine Norm, deren Modellaufrufe alle
       gescheitert sind, fällt auf die Syntaxbasis zurück — sie trug trotzdem
       „syntaxanalyse+mehrfachlauf+gegenprobe" im Feld und behauptete damit
       eine Herkunft, die sie nicht hat. In einem Bestand, der seine Herkunft
       belegen soll, ist das der schlimmste Ort für eine Ungenauigkeit. */
    verfahren: (ohneKi || !erg.laeufe)
      ? "syntaxanalyse"
      : "syntaxanalyse+mehrfachlauf+gegenprobe",
    hinweis: hinweistext(erg, ohneKi || !erg.laeufe),
    text_hash: th,
    format: FORMAT,
    aktualisiert: new Date().toISOString(),
  };
}

/** Nach der Belegprobe müssen Konfidenz, Belegquote und Status neu bestimmt werden. */
function neuBewerten(erg) {
  const alle = erg.saetze.flatMap((s) => s.elemente);
  if (!alle.length) return;
  const belegt = alle.filter((e) => e.beleg).length;
  erg.belegquote = Number((belegt / alle.length).toFixed(3));
  erg.konfidenz = Number((alle.reduce((a, e) => a + e.konfidenz, 0) / alle.length).toFixed(3));
  if (alle.some((e) => e.strittig)) erg.strittig = true;
  if (erg.status === "belegt" && !(erg.belegquote >= 0.4 && erg.konfidenz >= 0.7)) {
    erg.status = erg.konfidenz >= 0.5 ? "mehrheit" : "uneinheitlich";
    erg.markierbar = erg.status !== "uneinheitlich";
  }
}

function belegzusammenfassung(erg) {
  const gesehen = new Map();
  for (const satz of erg.saetze) {
    for (const el of satz.elemente) {
      if (!el.beleg) continue;
      const schluessel = `${el.beleg.art}\u0000${el.beleg.fundstelle}`;
      if (!gesehen.has(schluessel)) gesehen.set(schluessel, el.beleg);
    }
  }
  return [...gesehen.values()];
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
  const beleg = erg.belegquote
    ? ` ${Math.round(erg.belegquote * 100)} % der Merkmale sind durch eine amtliche Fundstelle gestützt.`
    : "";
  return `${basis}${warnung}${beleg} Automatisch erzeugt und nicht redaktionell geprüft. Keine Rechtsberatung.`;
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
        modell: MODELLE[0], modelle: MODELLE, token: TOKEN, budget,
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

/**
 * Sucht den Einleitungssatz eines Aufzählungsglieds: den letzten voranstehenden
 * Rechtssatz derselben Ebene „satz" im selben Absatz.
 */
function einleitungZu(einheiten, i) {
  const absatz = absatzTeil(einheiten[i].pfad);
  for (let k = i - 1; k >= 0; k--) {
    if (absatzTeil(einheiten[k].pfad) !== absatz) break;
    if (einheiten[k].ebene === "satz") return einheiten[k].text;
  }
  return null;
}

function absatzTeil(pfad) {
  const m = /^Abs\. \d+[a-z]?/.exec(String(pfad || ""));
  return m ? m[0] : "";
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
