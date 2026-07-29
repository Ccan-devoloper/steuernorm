#!/usr/bin/env node
/**
 * steuernorm — Aktualisierung der Gesetzestexte
 *
 * Quelle: "Gesetze im Internet" (BMJ / Bundesamt für Justiz).
 * Das Portal veröffentlicht ein tagesaktuelles Inhaltsverzeichnis unter
 * https://www.gesetze-im-internet.de/gii-toc.xml und je Gesetz ein xml.zip.
 * Gesetzestexte sind amtliche Werke und nach § 5 Abs. 1 UrhG gemeinfrei.
 *
 * Aufrufe:
 *   node tools/update.mjs                 alle konfigurierten Gesetze laden
 *   node tools/update.mjs --nur estg,ao   nur einzelne Gesetze
 *   node tools/update.mjs --aus ./xml     lokale XML-Dateien konvertieren
 *
 * Schreibt data/<abk>.json und data/index.json.
 * Beendet sich mit Code 0. Der Exitstatus sagt nichts über Änderungen aus —
 * die erkennt der Workflow an geänderten Dateien.
 */

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const WURZEL = path.resolve(import.meta.dirname, "..");
const GII = "https://www.gesetze-im-internet.de";

/* Welche Gesetze aufgenommen werden. "slug" ist das Kürzel im
   GII-Verzeichnis, sichtbar in der URL von gesetze-im-internet.de. */
const GESETZE = [
  { slug: "ao_1977", abk: "AO", titel: "Abgabenordnung" },
  { slug: "bewg", abk: "BewG", titel: "Bewertungsgesetz" },
  { slug: "estg", abk: "EStG", titel: "Einkommensteuergesetz" },
  { slug: "kstg_1977", abk: "KStG", titel: "Körperschaftsteuergesetz" },
  { slug: "ustg_1980", abk: "UStG", titel: "Umsatzsteuergesetz" },
  { slug: "gewstg", abk: "GewStG", titel: "Gewerbesteuergesetz" },
  { slug: "erbstg_1974", abk: "ErbStG", titel: "Erbschaftsteuer- und Schenkungsteuergesetz" },
  { slug: "grstg_1973", abk: "GrStG", titel: "Grundsteuergesetz" },
  { slug: "fgo", abk: "FGO", titel: "Finanzgerichtsordnung" },
  { slug: "grestg_1983", abk: "GrEStG", titel: "Grunderwerbsteuergesetz" },
  { slug: "umwstg_2006", abk: "UmwStG", titel: "Umwandlungssteuergesetz" },
  { slug: "astg", abk: "AStG", titel: "Außensteuergesetz" },
  { slug: "solzg_1995", abk: "SolzG", titel: "Solidaritätszuschlaggesetz" },
  { slug: "invstg_2018", abk: "InvStG", titel: "Investmentsteuergesetz" },
];

/* ---------------------------- XML-Hilfen ---------------------------- */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  sect: "§", para: "§", deg: "°", euro: "€", eur: "€", bdquo: "„", ldquo: "“",
  rdquo: "”", sbquo: "‚", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—",
  hellip: "…", middot: "·", times: "×", minus: "−", plusmn: "±", frac12: "½",
  frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", Prozent: "%", uArr: "⇑",
};

function entitaeten(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ersterTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

function nurText(xml) {
  if (xml == null) return "";
  return entitaeten(xml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/* GII-Markup nach schlankem HTML. Die DTD nutzt Tags teils rein
   typografisch; übernommen wird nur, was für das Lesen zählt. */
const TAGS = {
  P: "p", DL: "dl", DT: "dt", DD: "dd", LA: "span", BR: "br",
  IT: "em", B: "strong", F: "em", U: "u", NB: "span", Title: "h4",
  table: "table", thead: "thead", tbody: "tbody", row: "tr",
  entry: "td", pre: "pre", Content: "div", TOC: "div",
  Revision: "span", Ident: "span", small: "small", noindex: "span",
};
const WEG = new Set(["tgroup", "colspec", "FnR", "FnArea", "Footnotes", "Img", "kommentar"]);

function zuHtml(xml) {
  if (!xml) return "";
  let out = "";
  let i = 0;
  const stack = [];
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) { out += escapeHtml(entitaeten(xml.slice(i))); break; }
    if (lt > i) out += escapeHtml(entitaeten(xml.slice(i, lt)));
    const gt = xml.indexOf(">", lt);
    if (gt === -1) break;
    const roh = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (roh.startsWith("!") || roh.startsWith("?")) continue;
    const schluss = roh.startsWith("/");
    const leer = roh.endsWith("/");
    const name = roh.replace(/^\//, "").replace(/\/$/, "").split(/[\s>]/)[0];
    const attr = roh.slice(name.length).replace(/\/$/, "");

    if (WEG.has(name)) { if (!schluss && !leer) stack.push(null); else if (schluss) stack.pop(); continue; }
    const ziel = TAGS[name];
    if (!ziel) { if (!schluss && !leer) stack.push(null); else if (schluss) stack.pop(); continue; }

    if (schluss) { const off = stack.pop(); if (off) out += `</${off}>`; continue; }

    // Satznummern erscheinen als <SUP class="Rec">1</SUP>
    let klasse = "";
    if (name === "SUP") klasse = "";
    if (/class="Rec"/.test(attr)) klasse = ' class="sn"';
    if (name === "DL") {
      const typ = (attr.match(/Type="([^"]*)"/) || [])[1] || "";
      klasse = ` class="gl gl-${typ || "plain"}"`;
    }
    if (name === "entry" && /namest|morerows/.test(attr)) klasse = "";

    if (ziel === "br" || leer) { out += `<${ziel}${klasse}>`; if (!leer && ziel !== "br") stack.push(ziel); continue; }
    out += `<${ziel}${klasse}>`;
    stack.push(ziel);
  }
  while (stack.length) { const off = stack.pop(); if (off) out += `</${off}>`; }
  return out
    .replace(/<span>\s*<\/span>/g, "")
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Satznummern <SUP class="Rec">n</SUP> vorher sichern, damit sie nicht verloren gehen
function satznummern(xml) {
  return xml.replace(/<SUP class="Rec">(\d+)<\/SUP>/g, '<NB class="Rec">$1</NB>');
}

/* Absätze abtrennen: ein Absatz beginnt mit "(1)" am Anfang eines <p>. */
function absaetze(html) {
  const teile = html.split(/(?=<p>)/).filter((t) => t.trim());
  const out = [];
  for (const t of teile) {
    const m = t.match(/^<p>\s*\(?(\d+[a-z]?)\)\s*/);
    if (m) out.push({ n: m[1], html: t.replace(/^<p>\s*\(\d+[a-z]?\)\s*/, "<p>") });
    else if (out.length) out[out.length - 1].html += t;
    else out.push({ n: null, html: t });
  }
  return out.length ? out : [{ n: null, html }];
}

const normId = (enbez) =>
  enbez.replace(/^§+\s*/, "").replace(/^Art\.?\s*/i, "art-").replace(/\s+/g, "-").toLowerCase();

/* ----------------------------- Parser ----------------------------- */

function parseGesetz(xml, meta) {
  const bloecke = xml.match(/<norm\b[\s\S]*?<\/norm>/g) || [];
  const kopf = bloecke[0] || "";
  const stand = [...kopf.matchAll(/<standangabe[^>]*>([\s\S]*?)<\/standangabe>/g)]
    .map((m) => ({
      typ: nurText(ersterTag(m[1], "standtyp")),
      text: nurText(ersterTag(m[1], "standkommentar")),
    }))
    .filter((s) => s.text);
  const builddate = (xml.match(/builddate="(\d{4})(\d{2})(\d{2})"/) || []).slice(1).join("-") || null;

  const normen = [];
  let gliederung = null;

  for (const b of bloecke) {
    const md = ersterTag(b, "metadaten") || "";
    const gbez = nurText(ersterTag(md, "gliederungsbez"));
    const gtit = nurText(ersterTag(md, "gliederungstitel"));
    if (gbez || gtit) gliederung = [gbez, gtit].filter(Boolean).join(" ");

    const enbez = nurText(ersterTag(md, "enbez"));
    if (!enbez) continue;
    if (/^Inhalts(übersicht|verzeichnis)$/i.test(enbez)) continue;

    const titel = nurText(ersterTag(md, "titel"));
    const textteil = ersterTag(b, "text");
    const inhalt = textteil ? ersterTag(textteil, "Content") : null;
    const fuss = nurText(ersterTag(ersterTag(b, "fussnoten") || "", "Content"));

    const html = zuHtml(satznummern(inhalt || ""));
    if (!html && !titel) continue;

    normen.push({
      id: normId(enbez),
      enbez,
      titel: titel || "",
      gliederung,
      abs: absaetze(html),
      fussnote: fuss || undefined,
      volltext: nurText(inhalt || ""),
    });
  }

  return {
    abk: meta.abk,
    slug: meta.slug,
    titel: meta.titel,
    stand,
    builddate,
    quelle: `${GII}/${meta.slug}/`,
    geladen: new Date().toISOString().slice(0, 10),
    normen,
  };
}

/* ----------------------------- Laden ----------------------------- */

async function ladeVonGii(slug, tmp) {
  const url = `${GII}/${slug}/xml.zip`;
  const res = await fetch(url, { headers: { "User-Agent": "steuernorm-updater" } });
  if (!res.ok) throw new Error(`${url} antwortete mit ${res.status}`);
  const zip = path.join(tmp, `${slug}.zip`);
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  const { stdout } = await run("unzip", ["-p", zip], { maxBuffer: 200 * 1024 * 1024, encoding: "buffer" });
  return stdout.toString("utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const wert = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : null; };
  const nur = wert("--nur")?.split(",").map((s) => s.trim().toLowerCase());
  const ausOrdner = wert("--aus");

  const auswahl = GESETZE.filter(
    (g) => !nur || nur.includes(g.abk.toLowerCase()) || nur.includes(g.slug)
  );
  const datenOrdner = path.join(WURZEL, "data");
  const tmp = path.join(WURZEL, ".tmp");
  await mkdir(datenOrdner, { recursive: true });
  await mkdir(tmp, { recursive: true });

  let lokale = [];
  if (ausOrdner) lokale = await readdir(path.resolve(ausOrdner));

  const register = [];
  for (const g of auswahl) {
    try {
      let xml;
      if (ausOrdner) {
        const treffer = lokale.find((f) => f === `${g.slug}.xml`);
        if (!treffer) { console.log(`übersprungen  ${g.abk} — keine lokale Datei`); continue; }
        xml = await readFile(path.join(path.resolve(ausOrdner), treffer), "utf8");
      } else {
        xml = await ladeVonGii(g.slug, tmp);
      }
      const gesetz = parseGesetz(xml, g);
      const schlank = { ...gesetz, normen: gesetz.normen.map(({ volltext, ...r }) => r) };
      await writeFile(
        path.join(datenOrdner, `${g.abk.toLowerCase()}.json`),
        JSON.stringify(schlank),
        "utf8"
      );
      register.push({
        abk: gesetz.abk,
        titel: gesetz.titel,
        slug: gesetz.slug,
        datei: `${g.abk.toLowerCase()}.json`,
        builddate: gesetz.builddate,
        stand: gesetz.stand.find((s) => s.typ === "Stand")?.text || null,
        anzahl: gesetz.normen.length,
        normen: gesetz.normen.map((n) => ({ id: n.id, e: n.enbez, t: n.titel })),
      });
      console.log(`fertig        ${g.abk.padEnd(7)} ${String(gesetz.normen.length).padStart(4)} Normen  Stand ${gesetz.builddate}`);
    } catch (err) {
      console.error(`fehlgeschlagen ${g.abk}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (register.length) {
    await writeFile(
      path.join(datenOrdner, "index.json"),
      JSON.stringify({ aktualisiert: new Date().toISOString(), quelle: GII, gesetze: register }),
      "utf8"
    );
    console.log(`\nRegister geschrieben: ${register.length} Gesetze, ${register.reduce((a, g) => a + g.anzahl, 0)} Normen`);
  }
}

main();
