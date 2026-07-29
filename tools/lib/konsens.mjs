/**
 * konsens.mjs — führt Syntaxanalyse, Mehrfachläufe und Gegenprobe zusammen.
 *
 * Umgekehrte Rollenverteilung gegenüber der alten Fassung:
 *   ALT: Regellogik ist Basis, das Modell darf nur bestätigen.
 *   NEU: Das Modell schlägt vor, die Syntaxanalyse und die Validatoren legen ein Veto ein,
 *        und die ÜBEREINSTIMMUNG MEHRERER LÄUFE bestimmt die Konfidenz.
 *
 * Konfidenz ist damit erstmals eine gemessene Größe: Anteil der Läufe, die eine
 * Spanne mit derselben Kategorie geliefert haben, gewichtet mit der Spannengüte
 * und bestätigt durch die unabhängige Gegenprobe.
 */

import { guete, pruefeSpanne } from "./validatoren.mjs";
import { junktor } from "./syntax.mjs";

const ARTEN = ["tb", "rf", "ausn"];

/* ─────────────────────────── Normalisierung ─────────────────────────── */

export function normText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,;:]+|[\s,;:.]+$/g, "")
    .trim();
}

function schluessel(art, text) {
  return `${art}\u0000${normText(text).toLowerCase()}`;
}

/** Zwei Spannen gelten als dieselbe, wenn eine die andere weitgehend enthält. */
function gleich(a, b) {
  const x = normText(a).toLowerCase();
  const y = normText(b).toLowerCase();
  if (x === y) return true;
  const kurz = x.length < y.length ? x : y;
  const lang = x.length < y.length ? y : x;
  return lang.includes(kurz) && kurz.length / lang.length >= 0.7;
}

/* ─────────────────────────── Zusammenführung ─────────────────────────── */

/**
 * @param {object} arg
 * @param {Array} arg.einheiten     Rechtssätze mit pfad und text
 * @param {Array} arg.syntax        pro Rechtssatz: Ergebnis von syntax.zerlege
 * @param {Array} arg.laeufe        k Modellantworten der Form { saetze: [...] }
 * @param {Map}   arg.gegenproben   pfad → Map(index → art)
 * @param {object} arg.kontext      { volltext, gegenstand }
 */
export function fuehreZusammen({ einheiten, syntax, laeufe, gegenproben = new Map(), kontext }) {
  const saetze = [];
  const abgelehnt = [];
  const anzahlLaeufe = laeufe.length;
  const nurSyntax = anzahlLaeufe === 0;

  for (const [i, einheit] of einheiten.entries()) {
    const syn = syntax[i];
    const typ = bestimmeTyp(einheit.pfad, syn, laeufe);
    const ctx = {
      volltext: kontext.volltext,
      satztext: einheit.text,
      typ,
      gegenstand: kontext.gegenstand,
    };

    // 1. Kandidaten sammeln: Modell (je Lauf) + Syntaxanalyse als ein weiterer Stimmgeber
    const stimmen = new Map(); // schluessel → { art, text, quellen:Set, gruende:[] }
    const stimmeAbgeben = (art, text, quelle, grund) => {
      const t = normText(text);
      if (!t) return;
      let ziel = null;
      for (const [, v] of stimmen) if (v.art === art && gleich(v.text, t)) { ziel = v; break; }
      if (!ziel) {
        ziel = { art, text: t, quellen: new Set(), gruende: [] };
        stimmen.set(schluessel(art, t), ziel);
      }
      // längere, vollständigere Fassung bevorzugen
      if (t.length > ziel.text.length && t.length <= ziel.text.length * 1.6) ziel.text = t;
      ziel.quellen.add(quelle);
      if (grund) ziel.gruende.push(grund);
    };

    for (const [k, lauf] of laeufe.entries()) {
      const satz = (lauf.saetze || []).find((s) => s.pfad === einheit.pfad);
      if (!satz) continue;
      for (const art of ARTEN) {
        const feld = art === "ausn" ? "ausnahmen" : art;
        for (const text of satz[feld] || []) stimmeAbgeben(art, text, `modell#${k}`, satz.begruendung);
      }
    }
    for (const el of syn.elemente || []) stimmeAbgeben(el.art, el.text, "syntax", el.grund);

    // 2. Veto der Validatoren
    const geprueft = [];
    for (const s of stimmen.values()) {
      const grund = pruefeSpanne(s, ctx);
      if (grund) { abgelehnt.push({ pfad: einheit.pfad, art: s.art, text: s.text.slice(0, 90), grund }); continue; }
      geprueft.push(s);
    }

    // 3. Widersprüche auflösen: dieselbe Spanne in zwei Kategorien
    const bereinigt = loeseWiderspruch(geprueft, anzahlLaeufe);

    // 4. Gegenprobe anwenden
    const urteile = gegenproben.get(einheit.pfad);
    const final = [];
    for (const [idx, s] of bereinigt.entries()) {
      const urteil = urteile?.get(idx);
      if (urteil === "kein") {
        abgelehnt.push({ pfad: einheit.pfad, art: s.art, text: s.text.slice(0, 90), grund: "Gegenprobe: kein normatives Merkmal" });
        continue;
      }
      const bestaetigt = !urteil || urteil === s.art;
      if (!bestaetigt && s.quellen.size <= 1) {
        abgelehnt.push({ pfad: einheit.pfad, art: s.art, text: s.text.slice(0, 90), grund: `Gegenprobe widerspricht (${urteil})` });
        continue;
      }
      final.push({ ...s, gegenprobe: urteil ?? null, bestaetigt });
    }

    // 5. Konfidenz je Spanne: gemessene Übereinstimmung
    const modellStimmen = (s) => [...s.quellen].filter((q) => q.startsWith("modell#")).length;
    const elemente = final.map((s) => {
      const anteil = anzahlLaeufe > 0 ? modellStimmen(s) / anzahlLaeufe : 0;
      const syntaxStuetze = s.quellen.has("syntax") ? 1 : 0;
      const gegen = s.gegenprobe === null ? 0.5 : (s.bestaetigt ? 1 : 0);
      // Ohne Modelllauf gibt es nichts zu vergleichen: dann zählt allein die
      // syntaktische Begründung, und das wird im Status offen ausgewiesen.
      const konfidenz = (nurSyntax ? 0.6 * syntaxStuetze : (0.55 * anteil + 0.25 * syntaxStuetze + 0.20 * gegen))
        * guete(s, ctx);
      return {
        art: s.art,
        text: s.text,
        pfad: einheit.pfad,
        von: (einheit.von ?? 0) + Math.max(0, einheit.text.indexOf(s.text)),
        laenge: s.text.length,
        konfidenz: Number(konfidenz.toFixed(3)),
        stimmen: modellStimmen(s),
        laeufe: anzahlLaeufe,
        syntax: Boolean(syntaxStuetze),
        gegenprobe: s.gegenprobe,
        grund: s.gruende[0] || null,
      };
    });

    saetze.push({
      pfad: einheit.pfad,
      von: einheit.von ?? null,
      bis: einheit.bis ?? null,
      typ,
      junktor: einheit.nr ? junktor(einheiten.filter((e) => e.nr), einheit.text) : null,
      elemente: elemente.sort((a, b) => a.von - b.von),
    });
  }

  return { saetze, abgelehnt, ...bilanz(saetze, anzahlLaeufe, nurSyntax) };
}

/* ─────────────────────────── Hilfen ─────────────────────────── */

function bestimmeTyp(pfad, syn, laeufe) {
  const zaehler = new Map();
  const zaehl = (t) => zaehler.set(t, (zaehler.get(t) || 0) + 1);
  for (const lauf of laeufe) {
    const s = (lauf.saetze || []).find((x) => x.pfad === pfad);
    if (s?.typ) zaehl(s.typ);
  }
  if (syn?.typ) zaehl(syn.typ); // Syntaxanalyse zählt als eine Stimme
  if (!zaehler.size) return syn?.typ || "aussage";
  return [...zaehler.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Dieselbe Textstelle in zwei Kategorien: die Kategorie mit mehr Stimmen gewinnt. */
function loeseWiderspruch(spannen, anzahlLaeufe) {
  const raus = [];
  for (const s of spannen) {
    const konflikt = raus.find((r) => r.art !== s.art && gleich(r.text, s.text));
    if (!konflikt) { raus.push(s); continue; }
    if (s.quellen.size > konflikt.quellen.size) {
      raus[raus.indexOf(konflikt)] = s;
    }
    // Bei Gleichstand behält der erste Eintrag den Platz — er kam aus dem Lauf
    // mit Temperatur 0 oder aus der Syntaxanalyse.
  }
  return raus;
}

function bilanz(saetze, anzahlLaeufe, nurSyntax) {
  const alle = saetze.flatMap((s) => s.elemente);
  if (!alle.length) {
    return { konfidenz: 0, status: "ohne_merkmale", markierbar: false, laeufe: anzahlLaeufe };
  }
  const mittel = alle.reduce((a, e) => a + e.konfidenz, 0) / alle.length;
  const einstimmig = anzahlLaeufe
    ? alle.filter((e) => e.stimmen === anzahlLaeufe).length / alle.length
    : null;
  const status = nurSyntax ? "syntaktisch"
    : mittel >= 0.75 && einstimmig >= 0.7 ? "konsens"
      : mittel >= 0.5 ? "mehrheit"
        : "uneinheitlich";
  return {
    konfidenz: Number(mittel.toFixed(3)),
    einstimmigkeit: einstimmig === null ? null : Number(einstimmig.toFixed(3)),
    status,
    markierbar: status !== "uneinheitlich",
    laeufe: anzahlLaeufe,
  };
}

/* ─────────────────────────── Prüfungsschema ─────────────────────────── */

/**
 * Baut aus den Rechtssätzen einen hierarchischen Prüfungsbaum.
 * Reihenfolge: Anwendungsbereich → Voraussetzungen → Ausnahmen → Rechtsfolge.
 */
export function baueSchema(saetze) {
  const tb = [];
  const ausn = [];
  const rf = [];

  for (const satz of saetze) {
    if (satz.typ === "anwendung") continue;
    for (const el of satz.elemente) {
      const eintrag = { t: el.text, pfad: el.pfad, konfidenz: el.konfidenz };
      if (el.art === "tb") tb.push({ ...eintrag, junktor: satz.junktor });
      else if (el.art === "ausn") ausn.push(eintrag);
      else rf.push(eintrag);
    }
  }

  const schema = [];
  let n = 0;
  const roemisch = ["I.", "II.", "III.", "IV.", "V.", "VI.", "VII.", "VIII."];

  if (tb.length) {
    const jk = tb.find((x) => x.junktor)?.junktor || (tb.length > 1 ? "und" : null);
    schema.push({
      n: roemisch[n++], art: "tb",
      t: tb.length === 1 ? "Voraussetzung" : (jk === "oder" ? "Voraussetzungen (eine genügt)" : "Voraussetzungen (kumulativ)"),
      junktor: jk,
      sub: tb.map((x, i) => ({ n: `${i + 1}.`, t: x.t, pfad: x.pfad, konfidenz: x.konfidenz })),
    });
  }
  if (ausn.length) {
    schema.push({
      n: roemisch[n++], art: "ausn", t: "Ausnahmen und Rückausnahmen",
      sub: ausn.map((x, i) => ({ n: `${i + 1}.`, t: x.t, pfad: x.pfad, konfidenz: x.konfidenz })),
    });
  }
  if (rf.length) {
    schema.push({
      n: roemisch[n++], art: "rf", t: "Rechtsfolge",
      sub: rf.map((x, i) => ({ n: `${i + 1}.`, t: x.t, pfad: x.pfad, konfidenz: x.konfidenz })),
    });
  }
  return schema;
}
