#!/usr/bin/env node
/**
 * beitrag.mjs — stellt den Beitrag des Tages zusammen.
 *
 * WOZU. Der Bestand dieses Repositoriums beantwortet täglich dieselbe Frage
 * für 1 537 Normen: Was ordnet die Norm an, woran knüpft sie es, was sagt die
 * Verwaltung dazu, wer verweist darauf. Wer die Seite nicht kennt, stellt
 * diese Frage nie. Ein Beitrag am Tag trägt jeweils eine Norm nach draußen —
 * auf die Seite selbst und, über `instagram.mjs`, in ein Netz, in dem
 * Steuerrecht sonst als Meinung vorkommt und nicht als Wortlaut.
 *
 * DER BEITRAG WIRD NICHT GESCHRIEBEN, ER WIRD ZUSAMMENGESTELLT. Kein Satz
 * darin ist erzeugt; jeder stammt wörtlich aus dem Normtext, aus einer
 * amtlichen Verwaltungsanweisung oder aus dem, was `annotieren.mjs` an der
 * Norm bereits erkannt hat. Das ist keine Sparsamkeit, sondern die einzige
 * Fassung, die zur Haltung dieses Projekts passt: Ein Modell, das über eine
 * Norm frei formuliert, erzeugt genau die Sorte plausibler Falschaussage,
 * gegen die `docs/03-richtigkeit-und-grenzen.md` das ganze Verfahren aufbaut
 * — nur diesmal ohne Prüfer, mit Reichweite und unter fremdem Namen.
 *
 * Die Auswahl ist BERECHENBAR, nicht zufällig: Der Tag ist der Keim. Derselbe
 * Tag liefert dieselbe Norm, auch wenn der Lauf zweimal startet, und ein
 * doppelter Lauf schreibt keinen zweiten Beitrag.
 *
 *   node tools/beitrag.mjs                    Beitrag für heute
 *   node tools/beitrag.mjs --datum 2026-09-06
 *   node tools/beitrag.mjs --norm estg/15     eine bestimmte Norm
 *   node tools/beitrag.mjs --nachholen 7      die letzten sieben Tage füllen
 *   node tools/beitrag.mjs --neu              vorhandenen Beitrag überschreiben
 *   node tools/beitrag.mjs --trocken          nichts schreiben, nur zeigen
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { volltextDerNorm, saetze } from "./lib/gliederung.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const ZIEL = path.join(WURZEL, "beitraege");
const FORMAT = 1;

/* Wieviel darf in einen Beitrag? Die Grenzen sind nicht kosmetisch: Ein
   Auszug, der über die Satzgrenze hinausgeht, verändert den Wortlaut. Gekürzt
   wird deshalb ausschließlich an Satzgrenzen, nie mitten im Satz. */
const MASS = {
  wortlautZeichen: 700,        // Aufhänger aus dem Normtext
  bauteile: 6,                 // Tatbestand/Rechtsfolge/Ausnahme im Beitrag
  bauteilZeichen: 240,
  /* Untergrenze, und sie ist der Unterschied zwischen einem Beitrag und
     einem Kartenspiel. Die Segmentierung liefert auch Splitter — „in diesem
     Fall", „zu entrichten". Sie sind als Einfärbung im Volltext richtig, weil
     der Satz drumherum steht; allein unter einer Überschrift „Rechtsfolge"
     sagen sie nichts. */
  bauteilMinZeichen: 45,
  bauteilMinWorte: 5,
  verwaltung: 2,               // Verwaltungsstellen unter dem Beitrag
  verwaltungZeichen: 520,
  verweise: 8,                 // „Zitiert von"
  bildunterschrift: 2200,      // harte Grenze von Instagram
};

/* Normen, die als Beitrag nichts hergeben: zu kurz für eine Aussage, zu lang
   für ein Bild, oder ohne erkannte Struktur. Lieber keinen Beitrag als einen
   über § 1 „Anwendungsbereich". */
const AUSWAHL = {
  zeichenMin: 320,
  zeichenMax: 4200,
  bauteileMin: 2,
  schonung: 4,   // so viele Beiträge lang kommt dasselbe Gesetz nicht wieder
};

const args = process.argv.slice(2);
const schalter = (name, standard = null) => {
  const i = args.indexOf(name);
  return i === -1 ? standard : (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true);
};
const heute = () => new Date().toISOString().slice(0, 10);

const datumArg = schalter("--datum");
const normArg = schalter("--norm");
const nachholen = Number(schalter("--nachholen", 0)) || 0;
const neu = args.includes("--neu");
const trocken = args.includes("--trocken");

const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");
const lies = async (pfad) => JSON.parse(await readFile(path.join(WURZEL, pfad), "utf8"));
const liesWennDa = async (pfad) => { try { return await lies(pfad); } catch { return null; } };

/* ── Streuung über den Bestand ─────────────────────────────────────────────
   Ein Keim aus dem Datum, kein `Math.random`. Zwei Läufe am selben Tag müssen
   dieselbe Norm wählen — sonst schreibt der zweite Lauf einen zweiten Beitrag
   über eine andere Norm und das Bild passt nicht mehr zum Text. */
function keim(text) {
  let h = 0x811c9dc5;
  for (const zeichen of String(text)) {
    h ^= zeichen.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function wuerfel(startwert) {
  let z = startwert >>> 0;
  return () => {
    z = (z + 0x6d2b79f5) >>> 0;
    let t = Math.imul(z ^ (z >>> 15), 1 | z);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Auszüge, immer an der Satzgrenze ────────────────────────────────────── */
function aufSatzgrenze(text, grenze) {
  const sauber = String(text || "").replace(/\s+/g, " ").trim();
  if (sauber.length <= grenze) return sauber;
  let raus = "";
  for (const satz of saetze(sauber)) {
    if (raus && (raus.length + satz.length + 1) > grenze) break;
    raus = raus ? `${raus} ${satz}` : satz;
    if (raus.length >= grenze) break;
  }
  /* Ein einziger Satz, der schon zu lang ist: dann lieber das Wortende und
     eine sichtbare Auslassung als ein abgeschnittenes Wort. */
  if (!raus) raus = `${sauber.slice(0, grenze).replace(/\s+\S*$/, "")} …`;
  return raus;
}

const KATEGORIE = {
  tatbestand: { marke: "Tatbestand", frage: "Woran knüpft die Norm an?" },
  rechtsfolge: { marke: "Rechtsfolge", frage: "Was ordnet sie an?" },
  ausnahme: { marke: "Ausnahme", frage: "Wann gilt sie nicht?" },
};

/**
 * Adresse der Norm bei „Gesetze im Internet" — dieselbe Regel wie im
 * Frontend (`giiAdresse`): geraten wird nichts, Anlagen führen auf das Gesetz.
 */
function amtlicheAdresse(gesetz, norm) {
  if (!gesetz.quelle) return null;
  const basis = String(gesetz.quelle).replace(/\/*$/, "/");
  return /^\d+[a-z]?$/i.test(String(norm.id)) ? `${basis}__${norm.id}.html` : basis;
}

/* ── Bestand einlesen ──────────────────────────────────────────────────────
   Nur einmal je Gesetz, danach aus dem Gedächtnis: `annotations/estg.json`
   allein ist 9 MB groß und wird für die Auswahl über alle Gesetze gebraucht.
   Für die AUSWAHL genügt `struktur/`, das genau die drei Kategorien führt und
   ein Tausendstel wiegt. Die Annotationen werden erst für den gewählten
   Beitrag geöffnet — und nur, wenn `struktur/` fehlt. */
const gedaechtnis = new Map();
async function bestand(datei) {
  if (!gedaechtnis.has(datei)) {
    gedaechtnis.set(datei, {
      daten: await lies(`data/${datei}`),
      struktur: await liesWennDa(`struktur/${datei}`),
      belege: await liesWennDa(`belege/${datei}`),
    });
  }
  return gedaechtnis.get(datei);
}

/** Bauteile einer Norm: die erkannten Spannen, nach Kategorie, mit Wortlaut. */
function bauteile(struktur, normId, volltext) {
  const eintrag = struktur && struktur.normen ? struktur.normen[String(normId)] : null;
  if (!eintrag || !Array.isArray(eintrag.segmente)) return [];
  const raus = [];
  for (const s of eintrag.segmente) {
    if (!KATEGORIE[s.typ]) continue;
    if (!Number.isInteger(s.von) || !Number.isInteger(s.bis)) continue;
    const text = volltext.slice(s.von, s.bis).replace(/\s+/g, " ").trim();
    if (text.length < 12) continue;
    raus.push({
      kategorie: s.typ,
      marke: KATEGORIE[s.typ].marke,
      pfad: s.pfad || null,
      konfidenz: typeof s.konfidenz === "number" ? s.konfidenz : null,
      von: s.von,
      bis: s.bis,
      text,
    });
  }
  return raus;
}

/**
 * Die Bauteile für den Beitrag: je Kategorie das tragfähigste Stück zuerst,
 * dann abwechselnd auffüllen. Ohne diese Mischung stünden bei langen Normen
 * sechs Tatbestände und keine Rechtsfolge im Beitrag — die Norm wäre
 * abgebildet, aber nicht verstanden.
 */
function bauteileWaehlen(alle) {
  const nachKategorie = new Map();
  const gesehen = new Set();
  for (const b of alle) {
    if (b.text.length < MASS.bauteilMinZeichen) continue;
    if (b.text.split(/\s+/).length < MASS.bauteilMinWorte) continue;
    if (b.text.length > MASS.bauteilZeichen * 2) continue;   // ganze Absätze taugen nicht als Punkt
    const schluessel = b.text.toLowerCase();
    if (gesehen.has(schluessel)) continue;                   // dieselbe Wendung nicht zweimal
    gesehen.add(schluessel);
    const liste = nachKategorie.get(b.kategorie) || [];
    liste.push(b);
    nachKategorie.set(b.kategorie, liste);
  }
  /* Vordere Absätze zuerst. Der Wortlaut oben im Beitrag beginnt bei Absatz 1;
     Bauteile aus Absatz 7 stünden daneben ohne den Satz, zu dem sie gehören. */
  const absatzNr = (pfad) => {
    const m = /Abs\. (\d+)/.exec(pfad || "");
    return m ? Number(m[1]) : 99;
  };
  for (const liste of nachKategorie.values()) {
    liste.sort((a, b) => absatzNr(a.pfad) - absatzNr(b.pfad)
      || (b.konfidenz || 0) - (a.konfidenz || 0)
      || b.text.length - a.text.length);
  }
  const reihenfolge = ["tatbestand", "rechtsfolge", "ausnahme"];
  const raus = [];
  for (let runde = 0; raus.length < MASS.bauteile; runde++) {
    let etwasGenommen = false;
    for (const k of reihenfolge) {
      const liste = nachKategorie.get(k);
      if (!liste || !liste[runde]) continue;
      raus.push({ ...liste[runde], text: aufSatzgrenze(liste[runde].text, MASS.bauteilZeichen) });
      etwasGenommen = true;
      if (raus.length >= MASS.bauteile) break;
    }
    if (!etwasGenommen) break;
  }
  /* Gewählt wird nach Kategorie, gezeigt wird in der Reihenfolge der Norm:
     Der Leser liest oben den Wortlaut und findet die Bauteile darin wieder. */
  return raus.sort((a, b) => a.von - b.von).map(({ von, ...rest }) => rest);
}

/* ── Verwaltungsauszüge säubern ────────────────────────────────────────────
   Die Handbuchseiten des BMF sind Aufklapper. Was `belege.mjs` als Text
   abgreift, trägt deshalb die Bedienelemente mit — jeder zweite Auszug
   beginnt mit „aufklappen Zuklappen" —, und vor dem ersten Satz steht bei
   vielen Abschnitten noch das Inhaltsverzeichnis der Seite, ohne einen
   einzigen Punkt darin.
   Im Volltext der Seite stört das kaum; als erster Satz eines Beitrags ist es
   das Aus. Entfernt werden ausschließlich Bedienelemente und Verzeichnisse —
   am Wortlaut der Anweisung selbst wird nichts geändert (§ 14 UrhG). */
const BEDIENUNG = /^(?:Inhaltsverzeichnis\s+)?(?:aufklappen\s+)?(?:Zuklappen\s+)?/i;
const ENTITAET = { "&gt;": "›", "&lt;": "‹", "&amp;": "&", "&nbsp;": " ", "&sect;": "§", "&quot;": "\"" };

function verwaltungstext(roh) {
  let text = String(roh || "").replace(/&(gt|lt|amp|nbsp|sect|quot);/g, (m) => ENTITAET[m] || m);
  text = text.replace(/\s+/g, " ").replace(BEDIENUNG, "").trim();
  /* Führende Randnummer („1 Unbeschränkt steuerpflichtig …") — sie gehört zur
     Zählung des Handbuchs, nicht zum Satz. */
  text = text.replace(/^\d{1,2}\s+(?=[A-ZÄÖÜ§])/, "");
  /* Ein Inhaltsverzeichnis hat keine Satzzeichen und wird deshalb zu einem
     einzigen überlangen „Satz". Der fliegt raus; was danach kommt, ist Prosa. */
  const stuecke = saetze(text).filter((satz) => satz.length <= 450);
  return stuecke.join(" ").trim();
}

/** Fundstellen tragen dieselben Bedienelemente im Namen: „H 2 — Hinweise — aufklappen". */
function fundstelle(roh) {
  return String(roh || "")
    .replace(/\s*[—–-]\s*(aufklappen|Zuklappen)\s*$/i, "")
    .replace(/[:\s]+$/, "")
    .trim() || null;
}

/**
 * Verwaltungsstellen aus der Belegschicht — wörtlich, mit Fundstelle.
 *
 * Richtlinien und Anwendungserlasse stehen vor „Hinweisen": Erstere sind
 * ausformulierte Anweisungen, letztere Stichwortsammlungen mit Fundstellen
 * der Rechtsprechung. Beide sind amtlich, aber nur eine liest sich.
 */
function verwaltungsstellen(belege, normId) {
  const eintrag = belege && belege.normen ? belege.normen[String(normId)] : null;
  const liste = (eintrag && Array.isArray(eintrag.verwaltung)) ? eintrag.verwaltung : [];
  return liste
    .map((v) => ({
      quelle: v.quelle || (belege.handbuch ? belege.handbuch.abk : null),
      fundstelle: fundstelle(v.fundstelle),
      url: v.url || v.adresse || null,
      hinweisrubrik: /Hinweise|^H\s/i.test(String(v.fundstelle || "")),
      text: verwaltungstext(v.text),
    }))
    .filter((v) => v.text.length >= 80)
    .sort((a, b) => Number(a.hinweisrubrik) - Number(b.hinweisrubrik))
    .slice(0, MASS.verwaltung)
    .map(({ hinweisrubrik, ...v }) => ({ ...v, text: aufSatzgrenze(v.text, MASS.verwaltungZeichen) }));
}

/* ── Auswahl ───────────────────────────────────────────────────────────── */
async function kandidaten(register) {
  const raus = [];
  for (const meta of register.gesetze) {
    const { daten, struktur, belege } = await bestand(meta.datei);
    for (const norm of daten.normen) {
      const volltext = volltextDerNorm(norm);
      if (volltext.length < AUSWAHL.zeichenMin || volltext.length > AUSWAHL.zeichenMax) continue;
      const teile = bauteile(struktur, norm.id, volltext);
      const arten = new Set(teile.map((t) => t.kategorie));
      if (teile.length < AUSWAHL.bauteileMin) continue;
      /* Ohne Rechtsfolge sagt der Beitrag nicht, was die Norm anordnet. Das
         ist der eine Punkt, an dem er nicht verhandelbar ist. */
      if (!arten.has("rechtsfolge")) continue;
      const stellen = verwaltungsstellen(belege, norm.id);
      raus.push({
        schluessel: `${kurz(meta.abk)}/${norm.id}`,
        /* Die Adresse der amtlichen Quelle steht in `data/<gesetz>.json`, nicht
           im Register: `data/index.json` führt Kürzel, Titel und Stand, aber
           kein `quelle`. Wer sie dort sucht, bekommt `null` und der Beitrag
           verliert den Weg zum amtlichen Wortlaut. */
        quelle: daten.quelle || null,
        meta, norm, volltext, teile, stellen,
        gewicht: 1
          + (stellen.length ? 0.8 : 0)                 // belegte Normen zuerst
          + (arten.has("ausnahme") ? 0.3 : 0)          // Regel und Ausnahme ist der lehrreichere Fall
          + (norm.titel ? 0.2 : 0),
      });
    }
  }
  /* Ohne Ausgleich läge fast jeder fünfte Beitrag in der AO: Sie stellt 367
     der Kandidaten, das SolzG drei. Die Wurzel dämpft das, ohne es
     umzukehren — große Gesetze kommen häufiger vor, kleine kommen vor. */
  const proGesetz = new Map();
  for (const k of raus) proGesetz.set(k.meta.abk, (proGesetz.get(k.meta.abk) || 0) + 1);
  for (const k of raus) k.gewicht /= Math.sqrt(proGesetz.get(k.meta.abk));
  return raus;
}

/**
 * Ziehen mit Gewicht, aber ohne Wiederholung: schon veröffentlichte Normen
 * fallen raus, und die zuletzt bespielten Gesetze werden für `schonung`
 * Beiträge zurückgestellt. Sonst kämen fünf Tage nacheinander Absätze aus dem
 * EStG — es stellt mit Abstand die meisten Normen.
 */
function ziehen(liste, verbraucht, letzteGesetze, wurf) {
  const frei = liste.filter((k) => !verbraucht.has(k.schluessel));
  if (!frei.length) return null;
  const geschont = frei.filter((k) => !letzteGesetze.includes(kurz(k.meta.abk)));
  const topf = geschont.length ? geschont : frei;
  const summe = topf.reduce((s, k) => s + k.gewicht, 0);
  let ziel = wurf() * summe;
  for (const k of topf) {
    ziel -= k.gewicht;
    if (ziel <= 0) return k;
  }
  return topf[topf.length - 1];
}

/* ── Beitrag bauen ─────────────────────────────────────────────────────── */

/** Die erkannten Spannen, auf den gezeigten Auszug beschnitten, ohne Überlappung. */
function spannenImAuszug(teile, laenge) {
  const raus = [];
  let bisher = 0;
  for (const t of [...teile].sort((a, b) => a.von - b.von)) {
    if (!Number.isInteger(t.von) || !Number.isInteger(t.bis)) continue;
    const von = Math.max(t.von, bisher);
    const bis = Math.min(t.bis, laenge);
    if (bis - von < 8) continue;
    raus.push({ typ: t.kategorie, von, bis });
    bisher = bis;
    if (bisher >= laenge) break;
  }
  return raus;
}
function beitragBauen(kandidat, datum, verweise) {
  const { meta, norm, volltext, teile, stellen, quelle } = kandidat;
  const abk = meta.abk;
  const slug = kurz(abk);
  const id = `${datum}-${slug}-${String(norm.id).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const zitierendeAlle = (verweise.normen || {})[`${slug}/${norm.id}`] || [];
  const zitierende = zitierendeAlle.slice(0, MASS.verweise).map((v) => {
    const [g, n] = String(v).split("/");
    return { gesetz: g.toUpperCase(), norm: n, anzeige: `§ ${n} ${g.toUpperCase()}`, ziel: `#/${g}/${n}` };
  });

  const wortlaut = aufSatzgrenze(volltext, MASS.wortlautZeichen);
  const gewaehlteTeile = bauteileWaehlen(teile);
  const stand = Array.isArray(meta.stand) ? meta.stand.map((s) => s.text).join(" ") : (meta.stand || null);

  const abschnitte = [
    {
      art: "wortlaut",
      titel: "Der Wortlaut",
      text: wortlaut,
      gekuerzt: wortlaut.length < volltext.length,
      /* Die Einfärbung des Auszugs — dieselben drei Kategorien wie im
         Arbeitsplatz, auf den Auszug beschnitten. Ohne sie wäre der Beitrag
         ein Zitat wie jedes andere; mit ihr zeigt er in einem Blick, was
         diese Seite ausmacht. Überlappungen fallen weg: Zwei Farben auf
         demselben Zeichen ergeben keine lesbare Fläche. */
      spannen: spannenImAuszug(teile, wortlaut.length),
    },
    {
      art: "struktur",
      titel: "Wie die Norm gebaut ist",
      hinweis: "Maschinell erkannt, nicht redaktionell geprüft.",
      punkte: gewaehlteTeile,
    },
  ];
  if (stellen.length) {
    abschnitte.push({
      art: "verwaltung",
      titel: "Was die Verwaltung dazu sagt",
      hinweis: "Wörtlich aus dem amtlichen Handbuch, gekürzt an der Satzgrenze.",
      punkte: stellen,
    });
  }
  if (zitierende.length) {
    abschnitte.push({
      art: "verweise",
      titel: "Wer darauf verweist",
      anzahl: zitierendeAlle.length,
      punkte: zitierende,
    });
  }

  const beitrag = {
    format: FORMAT,
    id,
    datum,
    erzeugt: new Date().toISOString(),
    verfahren: "auszug",
    hinweis: "Automatisch aus dem Bestand dieser Seite zusammengestellt: Wortlaut, "
      + "maschinell erkannte Struktur und amtliche Verwaltungsanweisungen. Kein Satz ist "
      + "frei formuliert. Nicht redaktionell geprüft, keine Rechtsberatung; maßgeblich ist "
      + "der im Bundesgesetzblatt verkündete Wortlaut.",
    gesetz: { abk, slug, titel: meta.titel, quelle: quelle || null },
    norm: { id: norm.id, enbez: norm.enbez, titel: norm.titel || null, gliederung: norm.gliederung || null },
    titel: `${norm.enbez} ${abk}${norm.titel ? ` — ${norm.titel}` : ""}`,
    aufhaenger: KATEGORIE.rechtsfolge.frage,
    ziel: `#/${slug}/${norm.id}`,
    amtlich: amtlicheAdresse({ quelle }, norm),
    stand,
    kennzahlen: {
      zeichen: volltext.length,
      absaetze: norm.abs.length,
      erkannteSpannen: teile.length,
      verwaltungsstellen: stellen.length,
      zitiertVon: zitierendeAlle.length,
    },
    abschnitte,
    bild: `beitraege/bilder/${id}.jpg`,
  };
  beitrag.instagram = instagramText(beitrag);
  return beitrag;
}

/**
 * Die Bildunterschrift für Instagram.
 *
 * Instagram verlinkt aus dem Beitragstext nicht. Der Weg auf die Seite läuft
 * über das Profil; die Adresse steht trotzdem im Text, weil sie sich abtippen
 * lässt und weil ein Beitrag ohne Herkunftsangabe bei amtlichen Auszügen
 * nicht in Ordnung wäre (§ 63 UrhG, Quellenangabe).
 */
function instagramText(beitrag) {
  const struktur = beitrag.abschnitte.find((a) => a.art === "struktur");
  const verwaltung = beitrag.abschnitte.find((a) => a.art === "verwaltung");
  const zeilen = [];
  zeilen.push(beitrag.titel);
  zeilen.push("");
  zeilen.push(aufSatzgrenze(beitrag.abschnitte[0].text, 420));
  if (struktur && struktur.punkte.length) {
    zeilen.push("");
    for (const p of struktur.punkte.slice(0, 3)) {
      zeilen.push(`${p.marke}${p.pfad ? ` (${p.pfad})` : ""}: ${aufSatzgrenze(p.text, 160)}`);
    }
  }
  if (verwaltung && verwaltung.punkte.length) {
    const v = verwaltung.punkte[0];
    zeilen.push("");
    zeilen.push(`Verwaltung — ${[v.quelle, v.fundstelle].filter(Boolean).join(", ")}: ${aufSatzgrenze(v.text, 220)}`);
  }
  zeilen.push("");
  zeilen.push("Struktur maschinell erkannt, nicht redaktionell geprüft. Keine Rechtsberatung; "
    + "maßgeblich ist der im Bundesgesetzblatt verkündete Wortlaut.");
  zeilen.push("Volltext, Struktur und Nachweise: steuernorm (Link im Profil).");

  const marken = ["#steuerrecht", "#steuern", `#${kurz(beitrag.gesetz.abk)}`, "#gesetz",
    "#steuerberatung", "#rechtimwortlaut", "#steuernorm"];
  let text = zeilen.join("\n");
  const anhang = `\n\n${marken.join(" ")}`;
  if (text.length + anhang.length > MASS.bildunterschrift) {
    text = text.slice(0, MASS.bildunterschrift - anhang.length - 2).replace(/\s+\S*$/, "") + " …";
  }
  return { text: text + anhang, hashtags: marken, laenge: (text + anhang).length };
}

/* ── Index ─────────────────────────────────────────────────────────────── */
async function indexLesen() {
  const vorhanden = await liesWennDa("beitraege/index.json");
  if (vorhanden && Array.isArray(vorhanden.beitraege)) return vorhanden;
  return {
    format: FORMAT,
    aktualisiert: null,
    hinweis: "Täglich aus dem Bestand zusammengestellt. Kein Satz ist frei formuliert; "
      + "alle Auszüge stehen wörtlich im Normtext oder in einer amtlichen Verwaltungsanweisung.",
    beitraege: [],
  };
}

function indexZeile(b) {
  return {
    id: b.id,
    datum: b.datum,
    titel: b.titel,
    gesetz: b.gesetz.abk,
    norm: b.norm.id,
    normtitel: b.norm.titel,
    ziel: b.ziel,
    datei: `beitraege/${b.id}.json`,
    bild: b.bild,
    kurz: aufSatzgrenze(b.abschnitte[0].text, 180),
    kennzahlen: b.kennzahlen,
  };
}

/* ── Lauf ──────────────────────────────────────────────────────────────── */
const register = await lies("data/index.json");
const verweise = (await liesWennDa("data/verweise.json")) || { normen: {} };
const index = await indexLesen();
const alle = await kandidaten(register);

if (!alle.length) {
  console.error("Kein Kandidat: fehlt struktur/? (node tools/struktur.mjs)");
  process.exit(1);
}
console.log(`${alle.length} Normen kommen als Beitrag in Frage.`);

/* Welche Tage sind zu füllen? Standard ist heute; `--nachholen N` füllt die
   letzten N Tage, ohne vorhandene Beiträge anzufassen. */
const tage = [];
if (nachholen > 0) {
  const start = new Date(`${datumArg && datumArg !== true ? datumArg : heute()}T00:00:00Z`);
  for (let i = nachholen - 1; i >= 0; i--) {
    tage.push(new Date(start.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
} else {
  tage.push(datumArg && datumArg !== true ? String(datumArg) : heute());
}

const verbraucht = new Set(index.beitraege.map((b) => `${kurz(b.gesetz)}/${b.norm}`));
let geschrieben = 0;

for (const datum of tage) {
  const schonDa = index.beitraege.find((b) => b.datum === datum);
  if (schonDa && !neu) {
    console.log(`${datum}: bereits vorhanden (${schonDa.titel}) — übersprungen.`);
    continue;
  }
  /* Wird ein Tag neu gezogen, gibt der alte Beitrag seine Norm wieder frei —
     sonst wäre ausgerechnet die Norm gesperrt, die ersetzt werden soll. */
  if (schonDa) verbraucht.delete(`${kurz(schonDa.gesetz)}/${schonDa.norm}`);

  let kandidat = null;
  if (normArg && normArg !== true) {
    const [gRoh, nRoh] = String(normArg).split("/");
    kandidat = alle.find((k) => kurz(k.meta.abk) === kurz(gRoh) && String(k.norm.id) === String(nRoh));
    if (!kandidat) {
      console.error(`Norm ${normArg} ist kein Kandidat (zu kurz, zu lang oder ohne erkannte Rechtsfolge).`);
      process.exit(1);
    }
  } else {
    const letzte = index.beitraege
      .filter((b) => b.datum < datum)
      .sort((a, b) => b.datum.localeCompare(a.datum))
      .slice(0, AUSWAHL.schonung)
      .map((b) => kurz(b.gesetz));
    kandidat = ziehen(alle, verbraucht, letzte, wuerfel(keim(datum)));
  }
  if (!kandidat) {
    console.error(`${datum}: alle Kandidaten sind bereits erschienen.`);
    continue;
  }

  const beitrag = beitragBauen(kandidat, datum, verweise);
  verbraucht.add(kandidat.schluessel);

  console.log(`${datum}: ${beitrag.titel}`);
  console.log(`  ${beitrag.kennzahlen.erkannteSpannen} Spannen · `
    + `${beitrag.kennzahlen.verwaltungsstellen} Verwaltungsstellen · `
    + `zitiert von ${beitrag.kennzahlen.zitiertVon} · `
    + `Bildunterschrift ${beitrag.instagram.laenge} Zeichen`);

  /* Der Index wird AUCH im Trockenlauf fortgeschrieben — nur eben nicht
     gespeichert. Sonst sähe die Schonfrist beim Nachholen mehrerer Tage nur
     den Stand von vorher, und fünf Tage in Folge kämen aus der AO. */
  index.beitraege = index.beitraege
    .filter((b) => b.datum !== datum)
    .concat([indexZeile(beitrag)])
    .sort((a, b) => b.datum.localeCompare(a.datum) || b.id.localeCompare(a.id));

  if (trocken) {
    console.log(`\n${beitrag.instagram.text}\n`);
    continue;
  }

  await mkdir(path.join(ZIEL, "bilder"), { recursive: true });
  /* Beim Ersetzen bleibt sonst eine verwaiste Datei liegen, die im Index nicht
     mehr vorkommt, auf der Website aber weiter ausgeliefert wird. */
  if (schonDa && schonDa.id !== beitrag.id) {
    await rm(path.join(WURZEL, schonDa.datei), { force: true });
    if (schonDa.bild) await rm(path.join(WURZEL, schonDa.bild), { force: true });
  }
  await writeFile(path.join(ZIEL, `${beitrag.id}.json`), `${JSON.stringify(beitrag, null, 2)}\n`);
  geschrieben++;
}

if (!trocken && geschrieben) {
  index.aktualisiert = new Date().toISOString();
  index.format = FORMAT;
  await writeFile(path.join(ZIEL, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`${geschrieben} Beitrag/Beiträge geschrieben, ${index.beitraege.length} insgesamt.`);
} else if (!geschrieben) {
  console.log("Nichts geschrieben.");
}
