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
import { junktor, verberst } from "./syntax.mjs";

const ARTEN = ["tb", "rf", "ausn", "def"];

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
export function fuehreZusammen({ einheiten, syntax, laeufe, gegenproben = new Map(), belege = null, kontext }) {
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
      verberst: syn?.vorfeldrolle === "v1-bedingung" || verberst(einheit.text),
      /* Aufzählungsglied: Das Prädikat steht im Einleitungssatz, das Glied
         besteht vollständig aus dem Merkmal. Der Wächter gegen „ganzer Satz
         als ein Merkmal" darf hier nicht greifen — siehe validatoren.mjs. */
      katalog: syn?.vorfeldrolle === "katalog",
    };

    // 1. Kandidaten sammeln: Modell (je Lauf) + Syntaxanalyse als ein weiterer Stimmgeber
    const stimmen = new Map(); // schluessel → { art, text, quellen:Set, gruende:[] }
    const stimmeAbgeben = (art, text, quelle, grund, teile = null, anzeige = null) => {
      const t = normText(text);
      if (!t) return;
      let ziel = null;
      for (const [, v] of stimmen) if (v.art === art && gleich(v.text, t)) { ziel = v; break; }
      if (!ziel) {
        ziel = { art, text: t, teile: teile ?? null, anzeige: anzeige ?? null, quellen: new Set(), gruende: [] };
        stimmen.set(schluessel(art, t), ziel);
      }
      if (teile && !ziel.teile) { ziel.teile = teile; ziel.anzeige = anzeige; }
      // längere, vollständigere Fassung bevorzugen
      if (t.length > ziel.text.length && t.length <= ziel.text.length * 1.6) ziel.text = t;
      ziel.quellen.add(quelle);
      if (grund) ziel.gruende.push(grund);
    };

    const belegVorschlaege = new Map();   // normalisierter Spannentext → Fundstelle
    for (const [k, lauf] of laeufe.entries()) {
      const satz = (lauf.saetze || []).find((s) => s.pfad === einheit.pfad);
      if (!satz) continue;
      for (const b of satz.belege || []) {
        const fund = pruefeBeleg(b, belege);
        if (fund) belegVorschlaege.set(normText(b.text).toLowerCase(), fund);
      }
      for (const art of ARTEN) {
        const feld = art === "ausn" ? "ausnahmen" : art;
        for (const text of satz[feld] || []) stimmeAbgeben(art, text, `modell#${k}`, satz.begruendung);
      }
    }
    for (const el of syn.elemente || []) {
      stimmeAbgeben(el.art, el.text, "syntax", el.grund, el.teile ?? null, el.anzeige ?? null);
    }

    // 2. Veto der Validatoren
    const geprueft = [];
    for (const s of stimmen.values()) {
      // Mehrteilige Elemente: jedes Stück muss für sich bestehen.
      const stuecke = s.teile ?? [s.text];
      let grund = null;
      for (const stueck of stuecke) {
        grund = pruefeSpanne({ art: s.art, text: stueck, grund: s.gruende[0] }, ctx);
        if (grund) break;
      }
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
      const beleg = belegVorschlaege.get(normText(s.text).toLowerCase()) ?? null;
      // Ein amtlicher Beleg hebt die Konfidenz, ersetzt aber keine Übereinstimmung.
      const belegBonus = beleg ? 0.12 : 0;
      const konfidenz = Math.min(
        1,
        (nurSyntax ? 0.6 * syntaxStuetze : (0.55 * anteil + 0.25 * syntaxStuetze + 0.20 * gegen)) * guete(s, ctx)
          + belegBonus,
      );
      const basis = einheit.von ?? 0;
      const stuecke = s.teile ?? [s.text];
      const teileMitOrt = [];
      let suchAb = 0;
      for (const stueck of stuecke) {
        const i = einheit.text.indexOf(stueck, suchAb);
        const treffer = i === -1 ? einheit.text.indexOf(stueck) : i;
        if (treffer === -1) continue;
        teileMitOrt.push({ text: stueck, von: basis + treffer, laenge: stueck.length });
        suchAb = treffer + stueck.length;
      }
      return {
        art: s.art,
        text: s.text,
        anzeige: s.anzeige ?? null,
        teile: teileMitOrt.length > 1 ? teileMitOrt : null,
        pfad: einheit.pfad,
        von: teileMitOrt[0]?.von ?? basis + Math.max(0, einheit.text.indexOf(s.text)),
        laenge: s.text.length,
        konfidenz: Number(konfidenz.toFixed(3)),
        stimmen: modellStimmen(s),
        laeufe: anzahlLaeufe,
        syntax: Boolean(syntaxStuetze),
        gegenprobe: s.gegenprobe,
        beleg,
        grund: s.gruende[0] || null,
      };
    });

    saetze.push({
      pfad: einheit.pfad,
      von: einheit.von ?? null,
      bis: einheit.bis ?? null,
      typ,
      /* Wird mitgeschrieben, weil die Nachprüfung (tools/pruefen.mjs) dieselben
         Spannen ein zweites Mal durch `pruefeSpanne` schickt. Sie hat die
         Syntaxanalyse nicht zur Hand und wüsste sonst nicht, dass dieser
         Rechtssatz ein Aufzählungsglied ist — zwei Wächter greifen dort
         berechtigterweise nicht. Ohne diesen Eintrag meldete die strenge
         Prüfung 405 Fehler für Spannen, die richtig sind. */
      ...(ctx.katalog ? { katalog: true } : {}),
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
  const belegt = alle.filter((e) => e.beleg).length;
  const belegquote = belegt / alle.length;
  const status = nurSyntax ? "syntaktisch"
    : belegquote >= 0.4 && mittel >= 0.7 ? "belegt"
      : mittel >= 0.75 && einstimmig >= 0.7 ? "konsens"
        : mittel >= 0.5 ? "mehrheit"
          : "uneinheitlich";
  return {
    konfidenz: Number(mittel.toFixed(3)),
    einstimmigkeit: einstimmig === null ? null : Number(einstimmig.toFixed(3)),
    status,
    belegquote: Number(belegquote.toFixed(3)),
    markierbar: status !== "uneinheitlich",
    laeufe: anzahlLaeufe,
  };
}

/**
 * Prüft eine vom Modell genannte Fundstelle gegen die tatsächlich vorgelegten Belege.
 * Das ist die Antwort auf den zweiten Fehlertyp der Stanford-Untersuchung: Aussagen,
 * die inhaltlich stimmen mögen, aber mit einer Quelle belegt werden, die das nicht
 * hergibt. Was nicht wörtlich vorlag, wird verworfen.
 */
function pruefeBeleg(vorschlag, belege) {
  if (!belege || !vorschlag?.fundstelle) return null;
  const gesucht = normText(vorschlag.fundstelle).toLowerCase();
  if (gesucht.length < 4) return null;

  for (const b of belege.verwaltung || []) {
    const fund = normText(b.fundstelle).toLowerCase();
    if (fund === gesucht || fund.includes(gesucht) || gesucht.includes(fund)) {
      return { art: "verwaltung", quelle: b.quelle, fundstelle: b.fundstelle, url: b.url };
    }
  }
  for (const e of belege.rechtsprechung || []) {
    const kennung = normText([e.gericht, e.az, e.datum].filter(Boolean).join(" ")).toLowerCase();
    if (!kennung) continue;
    if (kennung.includes(gesucht) || gesucht.includes(kennung)
      || (e.az && gesucht.includes(normText(e.az).toLowerCase()))) {
      return { art: "rechtsprechung", quelle: e.quelle, fundstelle: [e.gericht, e.az].filter(Boolean).join(" "), url: e.url };
    }
  }
  return null;   // erfundene Fundstelle
}

/* ─────────────────────────── Prüfungsschema ─────────────────────────── */

/**
 * Baut aus den Rechtssätzen einen hierarchischen Prüfungsbaum.
 * Reihenfolge: Anwendungsbereich → Voraussetzungen → Ausnahmen → Rechtsfolge.
 */
export function baueSchema(saetze) {
  // Ein Prüfungsschema, das alle Absätze in einen Topf wirft, ist unbrauchbar:
  // § 15 AStG hätte dann 20 „kumulative Voraussetzungen" quer über neun Absätze,
  // die einander gar nicht bedingen. Deshalb wird JE ABSATZ ein eigener Block
  // gebaut; die Absätze stehen nebeneinander, nicht untereinander.
  const bloecke = new Map();

  for (const satz of saetze) {
    if (satz.typ === "anwendung") continue;
    if (!satz.elemente.length) continue;
    const absatz = absatzAus(satz.pfad);
    if (!bloecke.has(absatz)) {
      bloecke.set(absatz, { absatz, typen: new Map(), tb: [], rf: [], ausn: [], def: [], junktor: null });
    }
    const b = bloecke.get(absatz);
    b.typen.set(satz.typ, (b.typen.get(satz.typ) || 0) + 1);
    if (satz.junktor && !b.junktor) b.junktor = satz.junktor;

    for (const el of satz.elemente) {
      const eintrag = {
        t: el.anzeige || el.text,
        pfad: el.pfad,
        konfidenz: el.konfidenz,
        beleg: el.beleg ?? null,
        mehrteilig: Boolean(el.teile),
      };
      if (b[el.art]) b[el.art].push(eintrag);
    }
  }

  const schema = [];
  for (const b of bloecke.values()) {
    const typ = [...b.typen.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "aussage";
    const schritte = [];
    const roemisch = ["I.", "II.", "III.", "IV.", "V."];
    let i = 0;

    if (b.def.length) {
      schritte.push({
        n: roemisch[i++], art: "def", t: "Begriffsbestimmung",
        sub: b.def.map((x, k) => ({ n: `${k + 1}.`, ...x })),
      });
    }
    if (b.tb.length) {
      const jk = b.junktor || (b.tb.length > 1 ? "und" : null);
      schritte.push({
        n: roemisch[i++], art: "tb",
        t: b.def.length ? "Merkmale des Begriffs"
          : b.tb.length === 1 ? "Voraussetzung"
            : jk === "oder" ? "Voraussetzungen (eine genügt)" : "Voraussetzungen (kumulativ)",
        junktor: b.def.length ? null : jk,
        sub: b.tb.map((x, k) => ({ n: `${k + 1}.`, ...x })),
      });
    }
    if (b.ausn.length) {
      schritte.push({
        n: roemisch[i++], art: "ausn", t: "Ausnahmen und Rückausnahmen",
        sub: b.ausn.map((x, k) => ({ n: `${k + 1}.`, ...x })),
      });
    }
    if (b.rf.length) {
      schritte.push({
        n: roemisch[i++], art: "rf", t: "Rechtsfolge",
        sub: b.rf.map((x, k) => ({ n: `${k + 1}.`, ...x })),
      });
    }
    if (!schritte.length) continue;

    schema.push({ absatz: b.absatz, typ, rolle: ROLLE[typ] ?? null, schritte });
  }

  return schema;
}

/** Kurze Charakterisierung, was der Absatz überhaupt tut. */
const ROLLE = {
  konditional: "Voraussetzungen und Rechtsfolge",
  definition: "Begriffsbestimmung",
  gleichstellung: "Gleichstellung",
  fiktion: "Fiktion",
  tarif: "Bemessung und Satz",
  verweisung: "Verweisung",
  rechenregel: "Rechenregel",
  aussage: "Anordnung",
};

function absatzAus(pfad) {
  const m = /^Abs\. (\d+[a-z]?)/.exec(String(pfad || ""));
  return m ? `Abs. ${m[1]}` : "";
}
