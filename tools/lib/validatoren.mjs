/**
 * validatoren.mjs — deterministisches Veto.
 *
 * Diese Prüfungen ersetzen die menschliche Durchsicht nicht vollständig, aber sie
 * fangen genau die Fehlerklassen ab, die in der Auswertung aufgetaucht sind:
 * Fragmente, Fundstellen, Normsubjekte, Absatzblöcke, Kategorienverwechslung.
 *
 * Jeder Validator gibt entweder null (in Ordnung) oder einen Grund zurück.
 * Eine Spanne wird verworfen, sobald ein Validator anschlägt — unabhängig davon,
 * wie überzeugt das Modell war.
 */

import { istZeitangabe, NICHT_MARKIEREN } from "./syntax.mjs";

const MONATE = /^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/;
const FUNDSTELLE = /\b(BGBl\.|BStBl\.|BAnz\.)/;
const KONJUNKTION_START = /^(und|oder|sowie|aber|denn|sondern|beziehungsweise|bzw\.|wird|werden|ist|sind|so)\b/i;
const SATZZEICHEN_START = /^[,;:.)\]]/;
const NUR_VERWEIS = /^(§+\s?\d+[a-z]?(\s?(Abs(atz|\.)|Satz|Nummer|Nr\.|Buchst(abe|\.))\s?\d+[a-z]?)*(\s+(des|der)\s+[A-Za-zäöüß]+gesetzes?)?|Artikel\s?\d+)[.,;]?$/;
const ABGESCHNITTEN = /\b(dem|der|des|den|die|das|einer|eines|einem|einen|nach|vom|am|im|zum|zur|auf|bei|für|mit|und|oder)\s*$/i;

/**
 * @param {{art:string,text:string}} span
 * @param {{volltext:string, satztext:string, typ:string, gegenstand:string}} ctx
 * @returns {string|null} Ablehnungsgrund oder null
 */
export function pruefeSpanne(span, ctx) {
  const t = (span.text || "").trim();

  if (t.length < 4) return "zu kurz";
  if (t.length > 600) return "zu lang (>600 Zeichen)";

  // Muss wörtlich im Rechtssatz stehen — nicht nur irgendwo im Gesetz.
  if (!ctx.satztext.includes(t)) {
    if (!ctx.volltext.includes(t)) return "nicht wörtlich im Normtext";
    return "steht in einem anderen Rechtssatz als angegeben";
  }

  if (NICHT_MARKIEREN.has(ctx.typ)) return `Normtyp „${ctx.typ}" wird nicht markiert`;

  if (MONATE.test(t)) return "Fragment: beginnt mit Monatsnamen";
  if (SATZZEICHEN_START.test(t)) return "Fragment: beginnt mit Satzzeichen";
  if (/\b\d{1,2}\.\s*$/.test(t)) return "Fragment: endet auf abgeschnittener Ordinalzahl";
  if (ABGESCHNITTEN.test(t)) return "Fragment: endet auf Artikel oder Präposition";
  // Uneingeleitete Bedingungssätze beginnen zulässig mit dem finiten Verb
  // („Ist eine ausländische Familienstiftung …, so …"). Nur echte Fragmente ablehnen.
  if (span.art === "tb" && KONJUNKTION_START.test(t) && !ctx.verberst) {
    return "Fragment: beginnt mit Konjunktion oder finitem Verb";
  }

  if (FUNDSTELLE.test(t) && t.split(/\s+/).length < 12) return "Fundstelle statt Merkmal";
  if (istZeitangabe(t)) return "reine Zeitangabe";

  if (NUR_VERWEIS.test(t)) return "reiner Paragrafenverweis ohne Merkmalsgehalt";

  // Ganzer Absatz als ein Merkmal
  // Rechtsfolgen dürfen länger sein: Anordnungen mit Verweisungsketten sind
  // im Steuerrecht regelmäßig lang, ohne dadurch unbrauchbar zu werden.
  const woerter = t.split(/\s+/).length;
  const grenze = span.art === "rf" ? 75 : 45;
  if (woerter > grenze) return `zu grob (${woerter} Wörter)`;
  // Nur für Tatbestandsmerkmale: Eine Rechtsfolge DARF der ganze Rest des
  // Satzes sein — bei Definitionen und Verweisungen ist das der Regelfall.
  if (span.art === "tb" && t.length > 0.85 * ctx.satztext.length && woerter > 20) {
    return "deckt praktisch den ganzen Rechtssatz ab";
  }

  // Bloßes Normsubjekt — für Definiendum ausdrücklich erlaubt, dort IST der
  // Begriff das Element („Familienstiftungen sind Stiftungen, bei denen …").
  if (span.art === "tb" && istNormsubjekt(t, ctx.gegenstand)) return "bloßes Normsubjekt";
  if (span.art === "def" && t.split(/\s+/).length > 8) return "Definiendum zu lang";

  // Tarifnormen haben keinen eigenen Tatbestand.
  if (ctx.typ === "tarif" && span.art === "tb" && !/^(bei|beim|in den Fällen|für|soweit|auf)/i.test(t)) {
    return "Tarifnorm ohne konditionales Vorfeld — kein Tatbestandsmerkmal";
  }

  // Rechenregeln sind vollständig Rechtsfolge.
  if (ctx.typ === "rechenregel" && span.art !== "rf") return "Rechenregel ist vollständig Rechtsfolge";
  if (span.art === "def" && ctx.typ !== "definition") return "Definiendum nur in Definitionen";

  return null;
}

export function istNormsubjekt(t, gegenstand = "") {
  const kern = t.toLowerCase()
    .replace(/^(der|die|das|dieser|diese|dieses|ein|eine|einer)\s+/, "")
    .replace(/[.,;:]$/, "");
  if (kern.split(/\s+/).length > 4) return false;
  if (!/^[a-zäöüß-]+$/.test(kern.split(/\s+/)[0] || "")) {
    // Erstes Wort ist zusammengesetztes Substantiv — prüfen gegen Normgegenstand
  }
  const g = gegenstand.toLowerCase();
  if (g && kern.startsWith(g)) return true;
  if (g && g.startsWith(kern)) return true;
  return /^(der|die|das)\s+[A-ZÄÖÜ][\wäöüß-]+$/.test(t.trim());
}

/**
 * Widersprüche zwischen zwei Kategorisierungen derselben Spanne.
 * Wird genutzt, um Modellläufe gegeneinander und gegen die Syntaxanalyse zu halten.
 */
export function widerspruch(a, b) {
  if (!a || !b) return null;
  if (a.art === b.art) return null;
  return `Kategorie uneinheitlich: ${a.art} vs. ${b.art}`;
}

/** Bewertet, wie sauber eine Spanne ist — geht in die Konfidenz ein. */
export function guete(span, ctx) {
  let punkte = 1;
  const t = span.text.trim();
  const w = t.split(/\s+/).length;
  if (w < 3) punkte -= 0.25;
  if (w > 30) punkte -= 0.2;
  if (t.includes(";")) punkte -= 0.1;
  if (/\bund\b.*\boder\b/i.test(t)) punkte -= 0.1;
  if (span.grund) punkte += 0.05;
  return Math.max(0, Math.min(1, punkte));
}
