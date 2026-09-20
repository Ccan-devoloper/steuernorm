#!/usr/bin/env node
/**
 * struktur.mjs — erzeugt `struktur/<gesetz>.json` aus `annotations/`.
 *
 * Die Oberfläche färbt Tatbestand, Rechtsfolge und Ausnahme im Normtext ein.
 * Redaktionell verifizierte Dateien können zusätzlich Definitionen enthalten.
 * Dafür braucht sie Zeichenbereiche, sonst nichts. Die Annotationen enthalten
 * diese Bereiche längst, aber eingebettet in alles Übrige: Begründungen,
 * Konfidenzen, Prüfungsschema, Belege. Für das Frontend sind das je Gesetz
 * mehrere Megabyte, von denen es drei Felder braucht.
 *
 * Dieses Werkzeug schneidet die Segmentierung heraus:
 *
 *   { normId: { segmente: [ { typ, von, bis, pfad, konfidenz } ] } }
 *
 * Die Zeichenpositionen beziehen sich auf den KANONISCHEN VOLLTEXT der Norm —
 * die Verkettung aller Absätze, wie `gliederung.mjs → volltextDerNorm` sie
 * bildet. Das Frontend baut dieselbe Zeichenkette aus dem DOM auf; nur wenn
 * beide Seiten identisch rechnen, sitzen die Farben richtig.
 *
 * Aus der AUTOMATIK werden weiterhin ausschließlich Tatbestand, Rechtsfolge
 * und Ausnahme übernommen. Definitionen kommen nicht aus dem bloßen
 * `def`-Tag, sondern nur aus einer redaktionell verifizierten Korrekturschicht.
 * So wird aus einem maschinell erkannten Definiendum nicht ungeprüft eine
 * Legaldefinition.
 *
 *   node tools/struktur.mjs                 alle Gesetze
 *   node tools/struktur.mjs --nur solzg
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { einheiten as zerlegeNorm } from "./lib/gliederung.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const ZIEL = path.join(WURZEL, "struktur");
const FORMAT = 1;

const args = process.argv.slice(2);
const nurRoh = args.includes("--nur") ? args[args.indexOf("--nur") + 1] : null;
const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");
const nur = nurRoh ? new Set(nurRoh.split(",").map(kurz).filter(Boolean)) : null;

/** Die drei maschinellen Kategorien. Definition ist ausschließlich redaktionell. */
const TYP = { tb: "tatbestand", rf: "rechtsfolge", ausn: "ausnahme" };

function fundNormId(fundstelle){
  const f = String(fundstelle || "").trim();
  let m = /^§\s*([0-9]+[a-z]?)/i.exec(f);
  if (m) return m[1].toLowerCase();
  m = /^Anlage\s+([0-9]+[a-z]?)/i.exec(f);
  return m ? "anlage-" + m[1].toLowerCase() : null;
}

function ueberlappt(a, b){
  return a.von < b.bis && a.bis > b.von;
}

/* Explizite redaktionelle Zeichenbereiche kommen aus redaktion/<gesetz>.json
 * selbst. Damit überleben satzgenaue Korrekturen einen Neuaufbau von
 * struktur/, statt nur zufällig aus der vorherigen Ausgabedatei konserviert
 * zu werden. Gleiche Bereiche derselben Kategorie werden mit allen Beleg-IDs
 * zusammengeführt. */
function expliziteRedaktion(redaktion, normId){
  const gruppen = new Map();
  for (const b of redaktion?.befunde || []) {
    if (fundNormId(b.fundstelle) !== normId
        || b.umsetzung !== "explizite redaktionelle Teilspanne"
        || !Array.isArray(b.bereiche)) continue;
    for (const r of b.bereiche) {
      if (!Number.isInteger(r.von) || !Number.isInteger(r.bis) || r.bis <= r.von) continue;
      const key = `${b.typ}:${r.von}:${r.bis}`;
      const alt = gruppen.get(key);
      if (alt) {
        alt.belegIds = [...new Set([...(alt.belegIds || []), b.id])];
        alt.pfad = b.fundstelle;
      } else {
        gruppen.set(key, {
          typ:b.typ, von:r.von, bis:r.bis, pfad:b.fundstelle,
          konfidenz:1, redaktionell:true, belegIds:[b.id],
        });
      }
    }
  }
  return [...gruppen.values()];
}

function ohneExpliziteIds(segmente, ids){
  if (!ids.size) return segmente;
  const raus = [];
  for (const seg of segmente) {
    const alt = Array.isArray(seg.belegIds) ? seg.belegIds : null;
    if (!alt) { raus.push(seg); continue; }
    const neu = alt.filter((id) => !ids.has(id));
    if (!neu.length) continue;
    raus.push(neu.length === alt.length ? seg : { ...seg, belegIds:neu });
  }
  return raus;
}

/* Redaktionelle Segmente aus dem bisherigen Strukturdatensatz bleiben bei
 * einem Neu-Lauf erhalten, solange der Normtext denselben Hash hat. Beim
 * Überlagern wird ein maschinelles Segment an den Rändern sauber geteilt,
 * statt sein nicht betroffenes Stück mit zu löschen. */
function redaktionBewahren(maschine, redaktionelle){
  let raus = maschine.map((x) => ({ ...x }));
  for (const neu of redaktionelle) {
    const bereich = { von:neu.von, bis:neu.bis };
    const naechste = [];
    for (const alt of raus) {
      if (!ueberlappt(alt, bereich)) { naechste.push(alt); continue; }
      if (alt.von < neu.von) naechste.push({ ...alt, bis:neu.von });
      if (alt.bis > neu.bis) naechste.push({ ...alt, von:neu.bis });
    }
    naechste.push({ ...neu });
    raus = naechste;
  }
  return raus.sort((a,b) => a.von - b.von || a.bis - b.bis);
}

/**
 * Satzgrenzen einer Norm.
 *
 * WOZU. Die amtlichen Daten führen Satznummern nur bei 260 von 1 537 Normen
 * als `<span class="sn">`; bei den übrigen 1 277 steht im Quelltext keine.
 * Angezeigt wurde deshalb fast nirgends eine — obwohl die Adresse überall
 * existiert: Die Gliederung spricht von „Abs. 3 Satz 2", die Fundstellen der
 * Verwaltungsanweisungen tun es auch, und ohne sichtbare Nummer kann der
 * Leser die eine der anderen nicht zuordnen.
 *
 * Gezählt wird deshalb NICHT neu, sondern aus derselben Quelle gelesen wie
 * die Fundstelle: `gliederung.mjs`. Damit zeigt die Anzeige denselben Satz 2,
 * den auch das Register meint. Eine eigene Satzzählung im Frontend wäre eine
 * zweite Wahrheit und liefe früher oder später auseinander.
 *
 * Aufzählungsglieder („Nr. 1", „Buchst. a") sind keine Sätze und bekommen
 * keine Nummer. Fortsetzungen („… (Teil 2)") gehören zu ihrem Satz und
 * bekommen ebenfalls keine eigene.
 */
const SATZPFAD = /(?:^|\s)Satz (\d+)$/;

function satzgrenzen(norm) {
  const raus = [];
  for (const e of zerlegeNorm(norm)) {
    const m = SATZPFAD.exec(e.pfad || "");
    if (!m) continue;
    if (!Number.isInteger(e.von)) continue;
    raus.push({
      nr: Number(m[1]),
      von: e.von,
      bis: Number.isInteger(e.bis) ? e.bis : e.von,
      pfad: e.pfad,
      /* Der Absatz, zu dem der Satz gehört — die Anzeige nummeriert nur, wo
         ein Absatz mehr als einen Satz hat. Bei einem einzigen Satz sagt die
         Absatzbezeichnung bereits alles. */
      absatz: e.pfad.replace(SATZPFAD, "").trim() || null,
    });
  }
  return raus;
}

const register = JSON.parse(await readFile(path.join(WURZEL, "data", "index.json"), "utf8"));
const gesetze = register.gesetze.filter(
  (m) => !nur || [m.abk, m.slug, m.datei].some((k) => nur.has(kurz(k))),
);
if (!gesetze.length) { console.error("Kein passendes Gesetz gefunden."); process.exit(2); }

await mkdir(ZIEL, { recursive: true });

let gesamtNormen = 0, gesamtSegmente = 0;

for (const meta of gesetze) {
  const datei = path.join(WURZEL, "annotations", meta.datei);
  let annotation;
  try {
    annotation = JSON.parse(await readFile(datei, "utf8"));
  } catch (fehler) {
    console.warn(`  ⚠ ${meta.abk}: keine Annotationen (${path.basename(datei)}) — übersprungen`);
    continue;
  }

  /* Der Normtext, nicht nur die Annotation: Die Satzgrenzen kommen aus
     `gliederung.mjs` und brauchen die Norm selbst. */
  const gesetz = JSON.parse(await readFile(path.join(WURZEL, "data", meta.datei), "utf8"));

  /* Redaktion ist optional. Sie wird NICHT aus den Annotationen rekonstruiert:
     ihr Inhalt ist manuell verifiziert. Der bisherige Strukturdatensatz liefert
     die bereits textgenau aufgelösten Segmente; der Text-Hash schützt davor,
     sie nach einer Gesetzesänderung blind weiterzuverwenden. */
  let redaktion = null, bisher = null;
  try {
    redaktion = JSON.parse(await readFile(path.join(WURZEL, "redaktion", meta.datei), "utf8"));
    bisher = JSON.parse(await readFile(path.join(ZIEL, meta.datei), "utf8"));
  } catch {
    redaktion = null; bisher = null;
  }

  const normen = {};
  let segmenteImGesetz = 0;
  let saetzeImGesetz = 0;

  /* Über die NORMEN des Gesetzes, nicht über die Annotationen: Satzgrenzen
     hängen nicht an der Erkennung. Wer nur die annotierten Normen durchgeht,
     lässt jede Norm ohne Annotation auch ohne Satznummern — und das waren 95. */
  for (const norm of gesetz.normen) {
    const normId = norm.id;
    const anm = (annotation.normen || {})[normId] || {};
    const segmente = [];

    for (const satz of anm.saetze || []) {
      for (const element of satz.elemente || []) {
        const typ = TYP[element.art];
        if (!typ) continue;

        /* Mehrteilige Spannen („werden … zugerechnet") liegen an zwei Stellen
           im Text und gehören trotzdem zu EINEM Merkmal. Jedes Stück wird
           eigens eingefärbt, die Zusammengehörigkeit steht in `gruppe`. */
        const stuecke = Array.isArray(element.teile) && element.teile.length
          ? element.teile
          : [{ von: element.von, laenge: element.laenge }];

        const gruppe = segmente.length;
        for (const stueck of stuecke) {
          if (!Number.isInteger(stueck.von) || !stueck.laenge) continue;
          segmente.push({
            typ,
            von: stueck.von,
            bis: stueck.von + stueck.laenge,
            pfad: element.pfad || satz.pfad || null,
            konfidenz: typeof element.konfidenz === "number" ? element.konfidenz : null,
            ...(stuecke.length > 1 ? { gruppe } : {}),
          });
        }
      }
    }

    segmente.sort((a, b) => a.von - b.von || a.bis - b.bis);

    let endSegmente = segmente;
    let redaktionNorm = null;
    const erwartet = redaktion?.text_hashes?.[normId] || null;
    const alt = bisher?.normen?.[normId] || null;
    const explizit = expliziteRedaktion(redaktion, normId);
    const expliziteIds = new Set(explizit.flatMap((x) => x.belegIds || []));
    if (erwartet && anm.text_hash === erwartet) {
      let redSegmente = (alt?.segmente || []).filter((x) => x.redaktionell);
      redSegmente = ohneExpliziteIds(redSegmente, expliziteIds);
      if (redSegmente.length) endSegmente = redaktionBewahren(endSegmente, redSegmente);
      if (explizit.length) endSegmente = redaktionBewahren(endSegmente, explizit);
      if (alt?.redaktion) redaktionNorm = alt.redaktion;
    } else if (erwartet && anm.text_hash && anm.text_hash !== erwartet) {
      console.warn(`  ⚠ ${meta.abk} ${norm.enbez}: redaktionelle Segmente wegen geändertem Text-Hash nicht übernommen`);
    }

    const saetze = satzgrenzen(norm);
    /* Eine Norm ohne Segmente KANN Satzgrenzen haben — 127 Normen tragen
       keine erkannte Struktur, ihre Sätze sind trotzdem adressierbar. Nur wo
       beides fehlt, gibt es nichts zu schreiben. */
    if (!endSegmente.length && !saetze.length) continue;
    normen[normId] = {
      ...(endSegmente.length ? { segmente:endSegmente } : {}),
      ...(saetze.length ? { saetze } : {}),
      ...(redaktionNorm ? { redaktion:redaktionNorm } : {}),
    };
    segmenteImGesetz += endSegmente.length;
    saetzeImGesetz += saetze.length;
    gesamtNormen++;
  }

  const inhalt = {
    abk: annotation.abk || meta.abk,
    titel: annotation.titel || meta.titel,
    format: FORMAT,
    erzeugt: new Date().toISOString(),
    quelle: "annotations/" + meta.datei,
    verfahren: annotation.verfahren || null,
    hinweis: redaktion && bisher?.redaktion
      ? "Maschinelle Grundstruktur mit redaktionell verifizierter Korrekturschicht. "
        + "Redaktionelle Segmente haben bei unverändertem Normtext Vorrang; "
        + "Zeichenpositionen beziehen sich auf den kanonischen Volltext der Norm."
      : "Maschinell erkannt, nicht redaktionell geprüft. "
        + "Zeichenpositionen beziehen sich auf den kanonischen Volltext der Norm.",
    ...(redaktion && bisher?.redaktion ? { redaktion:bisher.redaktion } : {}),
    normen,
  };

  await writeFile(path.join(ZIEL, meta.datei), `${JSON.stringify(inhalt)}\n`);
  gesamtSegmente += segmenteImGesetz;
  console.log(`  ${meta.abk.padEnd(7)} ${String(Object.keys(normen).length).padStart(4)} Normen · `
    + `${String(segmenteImGesetz).padStart(6)} Segmente · ${String(saetzeImGesetz).padStart(6)} Sätze`);
}

console.log(`\n${gesamtNormen} Normen, ${gesamtSegmente} Segmente nach struktur/ geschrieben.`);
