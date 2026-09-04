#!/usr/bin/env node
/**
 * beitraege-pruefen.mjs — prüft, dass jeder Beitrag hält, was das Verfahren
 * verspricht.
 *
 * WOZU. Der Beitrag geht ohne Menschen ins Netz, unter dem Namen dieser Seite,
 * und er zitiert Gesetzestext. Die eine Zusage, die dabei nicht wackeln darf,
 * lautet: KEIN SATZ IST FORMULIERT. Jeder Auszug steht wörtlich im Normtext
 * oder in einer amtlichen Verwaltungsanweisung.
 *
 * Diese Zusage ist prüfbar, und genau das tut dieser Lauf: Er baut den
 * Normtext aus `data/` neu auf und sucht jeden Auszug darin — Zeichen für
 * Zeichen. Findet er ihn nicht, ist etwas hinzugedichtet oder verändert
 * worden, und der Lauf schlägt fehl, bevor der Beitrag Instagram sieht.
 *
 * Dazu die Formalien, an denen die Veröffentlichung sonst scheitert: JPEG,
 * Seitenverhältnis, Dateigröße, Länge der Bildunterschrift, Zahl der
 * Hashtags — alles Grenzen von Instagram, die eine Fehlermeldung erst dann
 * nennen würde, wenn der Beitrag schon halb angelegt ist.
 *
 *   node tools/beitraege-pruefen.mjs
 *   node tools/beitraege-pruefen.mjs --ohne-bilder    nur die Texte
 *   node tools/beitraege-pruefen.mjs --id 2026-09-04-ao-175b
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { volltextDerNorm } from "./lib/gliederung.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const ohneBilder = args.includes("--ohne-bilder");
const nurId = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;

/* Grenzen von Instagram, Stand der Dokumentation zur Graph-Schnittstelle. */
const IG = {
  unterschrift: 2200,
  hashtags: 30,
  dateiMB: 8,
  verhaeltnisMin: 0.8,     // 4:5, Hochformat
  verhaeltnisMax: 1.91,    // Querformat
};

const pruef = [];
const ok = (name, bedingung, zusatz = "") =>
  pruef.push({ name, bestanden: Boolean(bedingung), zusatz: String(zusatz) });

const lies = async (p) => JSON.parse(await readFile(path.join(WURZEL, p), "utf8"));
/* Vergleich auf Zeichenebene, aber ohne Streit über Leerraum: Der Normtext
   steht im Beitrag in einer Zeile, in den Daten über Absätze verteilt. */
const flach = (s) => String(s || "").replace(/\s+/g, " ").trim();

const index = await lies("beitraege/index.json");
ok("Index hat eine Formatangabe", Number.isInteger(index.format), `format=${index.format}`);
ok("Index führt eine Liste", Array.isArray(index.beitraege), `${(index.beitraege || []).length} Einträge`);

const beitraege = (index.beitraege || []).filter((b) => !nurId || b.id === nurId);
ok("Es gibt einen zu prüfenden Beitrag", beitraege.length > 0, `${beitraege.length}`);

/* Absteigend nach Datum — die Startseite zeigt `beitraege[0]` als „Beitrag
   des Tages". Stimmt die Reihenfolge nicht, zeigt sie den falschen. */
const sortiert = [...(index.beitraege || [])]
  .map((b) => b.datum)
  .every((d, i, alle) => i === 0 || alle[i - 1] >= d);
ok("Index ist absteigend sortiert", sortiert);
const ids = new Set();
const daten = new Set();
let dubletten = 0;
for (const b of (index.beitraege || [])) {
  if (ids.has(b.id) || daten.has(b.datum)) dubletten++;
  ids.add(b.id);
  daten.add(b.datum);
}
ok("Keine doppelten Kennungen oder Tage", dubletten === 0, `${dubletten} Dubletten`);

const gesetzGedaechtnis = new Map();
async function gesetzHolen(datei) {
  if (!gesetzGedaechtnis.has(datei)) gesetzGedaechtnis.set(datei, await lies(`data/${datei}`));
  return gesetzGedaechtnis.get(datei);
}

const register = await lies("data/index.json");

for (const zeile of beitraege) {
  const marke = zeile.id;
  let beitrag;
  try {
    beitrag = await lies(zeile.datei);
  } catch (fehler) {
    ok(`${marke}: Datei lesbar`, false, fehler.message);
    continue;
  }
  ok(`${marke}: Kennung passt zur Datei`, beitrag.id === zeile.id, `${beitrag.id}`);
  ok(`${marke}: Verfahren ist „auszug"`, beitrag.verfahren === "auszug", beitrag.verfahren);
  ok(`${marke}: Hinweis auf die Grenzen steht im Beitrag`,
    /nicht redaktionell geprüft/i.test(beitrag.hinweis || ""));

  const meta = register.gesetze.find((g) => g.abk === beitrag.gesetz.abk);
  if (!meta) {
    ok(`${marke}: Gesetz steht im Register`, false, beitrag.gesetz.abk);
    continue;
  }
  const gesetz = await gesetzHolen(meta.datei);
  const norm = gesetz.normen.find((n) => String(n.id) === String(beitrag.norm.id));
  if (!norm) {
    ok(`${marke}: Norm steht im Gesetz`, false, `${beitrag.gesetz.abk} ${beitrag.norm.id}`);
    continue;
  }
  ok(`${marke}: Bezeichnung stimmt mit den Daten überein`, norm.enbez === beitrag.norm.enbez,
    norm.enbez === beitrag.norm.enbez ? "" : `${norm.enbez} ≠ ${beitrag.norm.enbez}`);

  const volltext = flach(volltextDerNorm(norm));

  /* ── Die eine Zusage ── */
  const wortlaut = beitrag.abschnitte.find((a) => a.art === "wortlaut");
  ok(`${marke}: Der Auszug steht wörtlich in der Norm`,
    wortlaut && volltext.startsWith(flach(wortlaut.text)),
    flach(wortlaut ? wortlaut.text : "").slice(0, 60) + " …");

  const struktur = beitrag.abschnitte.find((a) => a.art === "struktur");
  const punkte = struktur ? struktur.punkte : [];
  const fremd = punkte.filter((p) => !volltext.includes(flach(p.text)));
  ok(`${marke}: Jedes Bauteil steht wörtlich in der Norm`,
    punkte.length > 0 && fremd.length === 0,
    fremd.length ? fremd.map((p) => p.text.slice(0, 40)).join(" | ") : `${punkte.length} Bauteile`);
  ok(`${marke}: Jedes Bauteil trägt eine Kategorie der Legende`,
    punkte.every((p) => ["tatbestand", "rechtsfolge", "ausnahme"].includes(p.kategorie)));

  /* ── Die Einfärbung des Auszugs ── */
  const spannen = (wortlaut && wortlaut.spannen) || [];
  let sauber = true;
  let bisher = 0;
  for (const s of spannen) {
    if (!(s.von >= bisher) || !(s.bis > s.von) || s.bis > wortlaut.text.length) sauber = false;
    bisher = s.bis;
  }
  ok(`${marke}: Spannen liegen im Auszug, ohne Überschneidung`, sauber,
    `${spannen.length} Spannen, Auszug ${wortlaut ? wortlaut.text.length : 0} Zeichen`);
  const falschGefaerbt = spannen.filter((s) =>
    !volltext.includes(flach(wortlaut.text.slice(s.von, s.bis))));
  ok(`${marke}: Jede eingefärbte Stelle steht so in der Norm`, falschGefaerbt.length === 0,
    `${falschGefaerbt.length} Abweichungen`);

  /* ── Verwaltungsauszüge ── */
  const verwaltung = beitrag.abschnitte.find((a) => a.art === "verwaltung");
  if (verwaltung) {
    let belege = null;
    try { belege = await lies(`belege/${meta.datei}`); } catch { belege = null; }
    const roh = belege && belege.normen && belege.normen[String(norm.id)];
    const vorrat = flach(((roh && roh.verwaltung) || []).map((v) => v.text).join(" "))
      .replace(/&(gt|lt|amp|nbsp|sect|quot);/g, " ")
      .replace(/\s+/g, " ");
    /* Der Auszug ist gesäubert (Bedienelemente entfernt, Entitäten aufgelöst);
       verglichen wird deshalb wortweise, nicht als Zeichenkette. Ein
       hinzugedichteter Satz fällt trotzdem auf: Seine Wörter stehen nirgends. */
    const fremdeWorte = flach(verwaltung.punkte.map((p) => p.text).join(" "))
      .split(" ")
      .filter((w) => w.length > 6 && !vorrat.includes(w));
    ok(`${marke}: Verwaltungsauszüge stammen aus der Belegschicht`,
      vorrat.length > 0 && fremdeWorte.length === 0,
      fremdeWorte.slice(0, 5).join(", ") || `${verwaltung.punkte.length} Stellen`);
    ok(`${marke}: Jede Verwaltungsstelle nennt ihre Fundstelle`,
      verwaltung.punkte.every((p) => p.quelle || p.fundstelle));
  }

  /* ── Verweise ── */
  const verweise = beitrag.abschnitte.find((a) => a.art === "verweise");
  if (verweise) {
    const alle = await lies("data/verweise.json");
    const echt = new Set(alle.normen[`${beitrag.gesetz.slug}/${beitrag.norm.id}`] || []);
    const erfunden = verweise.punkte.filter((p) => !echt.has(`${p.gesetz.toLowerCase()}/${p.norm}`));
    ok(`${marke}: Jeder genannte Rückverweis steht im Verweisindex`, erfunden.length === 0,
      erfunden.map((p) => p.anzeige).join(", "));
  }

  /* ── Was Instagram annimmt ── */
  const ig = beitrag.instagram || {};
  ok(`${marke}: Bildunterschrift bleibt unter ${IG.unterschrift} Zeichen`,
    typeof ig.text === "string" && ig.text.length <= IG.unterschrift, `${(ig.text || "").length}`);
  ok(`${marke}: Höchstens ${IG.hashtags} Hashtags`,
    (ig.text || "").split("#").length - 1 <= IG.hashtags,
    `${(ig.text || "").split("#").length - 1}`);
  ok(`${marke}: Die Bildunterschrift nennt die Grenzen des Verfahrens`,
    /nicht redaktionell geprüft/i.test(ig.text || ""));

  if (!ohneBilder) {
    const bildpfad = path.join(WURZEL, beitrag.bild);
    let groesse = null;
    try { groesse = (await stat(bildpfad)).size; } catch { groesse = null; }
    ok(`${marke}: Bild vorhanden`, groesse !== null, beitrag.bild);
    if (groesse !== null) {
      ok(`${marke}: Bild bleibt unter ${IG.dateiMB} MB`, groesse <= IG.dateiMB * 1024 * 1024,
        `${(groesse / 1024 / 1024).toFixed(2)} MB`);
      const kopf = await readFile(bildpfad);
      ok(`${marke}: Bild ist wirklich JPEG`,
        kopf[0] === 0xFF && kopf[1] === 0xD8 && kopf[2] === 0xFF,
        `${kopf.slice(0, 3).toString("hex")}`);
      /* Maße stehen im SOF-Abschnitt des JPEG. Ein Bild im falschen
         Seitenverhältnis wird von Instagram beschnitten — und beschnitten
         wird zuerst der Wortlaut. */
      const masse = jpegMasse(kopf);
      if (masse) {
        const verhaeltnis = masse.breite / masse.hoehe;
        ok(`${marke}: Seitenverhältnis wird angenommen`,
          verhaeltnis >= IG.verhaeltnisMin - 0.001 && verhaeltnis <= IG.verhaeltnisMax + 0.001,
          `${masse.breite}×${masse.hoehe} (${verhaeltnis.toFixed(3)})`);
      }
    }
  }
}

/** Breite und Höhe aus dem ersten SOF-Abschnitt eines JPEG. */
function jpegMasse(daten) {
  let i = 2;
  while (i < daten.length - 9) {
    if (daten[i] !== 0xFF) { i++; continue; }
    const kennung = daten[i + 1];
    const laenge = daten.readUInt16BE(i + 2);
    // SOF0…SOF15, ohne DHT (C4), DNL (C8) und DAC (CC)
    if (kennung >= 0xC0 && kennung <= 0xCF
        && kennung !== 0xC4 && kennung !== 0xC8 && kennung !== 0xCC) {
      return { hoehe: daten.readUInt16BE(i + 5), breite: daten.readUInt16BE(i + 7) };
    }
    i += 2 + laenge;
  }
  return null;
}

console.log("");
let fehler = 0;
for (const p of pruef) {
  if (!p.bestanden) fehler++;
  console.log(`  ${p.bestanden ? "✓" : "✗"} ${p.name}${p.zusatz ? "  — " + p.zusatz : ""}`);
}
console.log(`\n${pruef.length - fehler}/${pruef.length} bestanden`);
process.exit(fehler ? 1 : 0);
