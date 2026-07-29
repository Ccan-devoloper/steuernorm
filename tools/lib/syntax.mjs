/**
 * syntax.mjs — deterministische Satzgliedanalyse für deutsche Normtexte.
 *
 * Ersetzt die alte Wortlisten-Heuristik (`RF_SIGNAL.exec`, Schnitt am ersten Verb).
 * Grundlage ist die Verbzweitstellung des deutschen Hauptsatzes: Das finite Verb
 * steht an zweiter Position; alles davor ist das Vorfeld und besteht aus GENAU EINEM
 * Satzglied. Damit lässt sich rein syntaktisch entscheiden, ob im Vorfeld die
 * Rechtsfolge steht (§ 2 SolzG: „Abgabepflichtig sind …") oder der Anwendungsfall
 * (§ 3 Abs. 2 SolzG: „Bei der Veranlagung zur Einkommensteuer ist …").
 *
 * Kein Modellaufruf, kein Netz, deterministisch und wiederholbar.
 */

/* ─────────────────────────── Wortmaterial ─────────────────────────── */

/** Finite Verbformen, die in Normtexten den Hauptsatz tragen. */
const FINIT = [
  "ist", "sind", "war", "waren", "sei", "seien",
  "wird", "werden", "wurde", "wurden",
  "hat", "haben", "hatte", "hatten",
  "kann", "können", "darf", "dürfen", "muss", "müssen", "soll", "sollen",
  "gilt", "gelten", "galt", "galten",
  "bleibt", "bleiben", "beträgt", "betragen", "bemisst", "bemessen",
  "unterliegt", "unterliegen", "entsteht", "entstehen", "erlischt", "erlöschen",
  "findet", "finden", "ergibt", "ergeben", "tritt", "treten", "steht", "stehen",
  "bedarf", "bedürfen", "erfolgt", "erfolgen", "endet", "enden", "beginnt", "beginnen",
  "richtet", "richten", "zählt", "zählen", "gehört", "gehören", "umfasst", "umfassen",
  "übersteigt", "übersteigen", "erhöht", "vermindert", "ermäßigt", "ändert", "ändern",
];
const FINIT_RE = new RegExp(`\\b(${FINIT.join("|")})\\b`, "gi");

/** Subjunktionen: leiten Nebensätze mit Verbletztstellung ein. */
const SUBJUNKTION = /\b(wenn|soweit|sofern|falls|weil|da|obwohl|damit|dass|ob|solange|sobald|bevor|nachdem|indem|während|insoweit|soweit nicht)\b/i;

/** Relativpronomen am Beginn eines eingeschobenen Nebensatzes. */
const RELATIV = /^(der|die|das|dem|den|des|dessen|deren|welche[rnms]?)\b/i;

/**
 * Prädikative im Vorfeld: Adjektive und Partizipien, die die RECHTSFOLGE tragen.
 * „Abgabepflichtig sind …", „Steuerfrei sind …", „Maßgebend ist …"
 */
const PRAEDIKATIV = /^(abgabepflichtig|steuerpflichtig|steuerfrei|steuerbar|umsatzsteuerfrei|einkommensteuerpflichtig|körperschaftsteuerpflichtig|gewerbesteuerpflichtig|erbschaftsteuerpflichtig|abzugsfähig|nicht abzugsfähig|maßgebend|maßgeblich|zulässig|unzulässig|erforderlich|anzuwenden|nicht anzuwenden|anzusetzen|abzuziehen|hinzuzurechnen|festzusetzen|zu erheben|nicht zu erheben|ausgeschlossen|befreit|begünstigt|verpflichtet|berechtigt|haftbar|zuständig|Bemessungsgrundlage|Bemessungsgrundlagen)\b/i;

/**
 * Vorfeld-Adverbiale, die den ANWENDUNGSFALL bezeichnen — also Tatbestand.
 * „Bei der Veranlagung …", „Beim Abzug vom laufenden Arbeitslohn …", „Im Falle des …"
 */
const KONDITIONAL_VORFELD = /^(bei|beim|im Fall(?:e)?|in den Fällen|in Fällen|für|auf|nach|mit|unter|zur|zum|von|vor|während|soweit|sofern|wenn|solange|über|durch|gegenüber|neben|anstelle|abweichend von|entsprechend|vorbehaltlich|ungeachtet|hinsichtlich|bezüglich|infolge|aufgrund|auf Grund|wegen|trotz|mangels|innerhalb|außerhalb|ab|bis|seit|je|pro|einmal|erstmals|letztmals)\b/i;

/** Ausnahmesignale. Bewusst OHNE bloßes „außer" — das trifft „außer Ansatz". */
const AUSNAHME = /\b(es sei denn|mit Ausnahme|ausgenommen|außer in|außer bei|außer wenn|außer für|abweichend von|dies gilt nicht|gilt nicht|ist nicht anzuwenden|sind nicht anzuwenden|findet keine Anwendung|entfällt|unbeschadet|vorbehaltlich|ungeachtet|soweit nicht|es sei)\b/i;

/** Verweisungsprädikate. */
const VERWEISUNG = /\b(entsprechend anzuwenden|sinngemäß|gilt sinngemäß|gelten sinngemäß|findet Anwendung|finden Anwendung|ist nicht anzuwenden|bleibt unberührt|bleiben unberührt|nach Maßgabe|gilt entsprechend|gelten entsprechend|ist anzuwenden|sind anzuwenden)\b/i;

/** Anwendungsvorschrift: zeitlicher Geltungsbereich einer Fassung. */
const ANWENDUNGSVORSCHRIFT = /(in der Fassung (des|der)|in der am .{4,30} geltenden Fassung).{0,200}?(anzuwenden|anwendbar)|erstmals (für den|im) Veranlagungszeitraum|letztmals (für den|im) Veranlagungszeitraum|ist ab dem Veranlagungszeitraum/i;

/** Fiktion. */
const FIKTION = /\b(gilt als|gelten als|wird .{0,40} behandelt|werden .{0,40} behandelt|steht .{0,30} gleich|stehen .{0,30} gleich)\b/i;

/** Definition. */
const DEFINITION = /\b(im Sinne (dieses Gesetzes|des|dieser Vorschrift)|ist|sind)\b.{0,80}\b(wenn|die|der|das)\b/i;
const DEFINITION_STARK = /\b(im Sinne dieses Gesetzes|bezeichnet den|bezeichnet die|Begriff)\b/i;

/** Rechenregel / Rundung. */
const RECHENREGEL = /\b(bleiben außer Ansatz|bleibt außer Ansatz|ist abzurunden|ist aufzurunden|auf volle|Bruchteile|abgerundet|aufgerundet|kaufmännisch gerundet)\b/i;

/** Tarif. */
const TARIF = /\b(beträgt|bemisst sich|Steuersatz|Zuschlagsatz|Prozent|vom Hundert|v\. H\.)\b/i;

/** Normgegenstand-Muster: bloßes Subjekt, das kein Tatbestandsmerkmal ist. */
const PRONOMEN = /^(er|sie|es|dieser|diese|dieses|derselbe|dasselbe|jener|dies|das|dazu|hierzu|darunter|hierunter|dabei|hierbei|davon|hiervon|darin|hierin|dafür|hierfür|dem|denen|deren|dessen|entsprechendes|gleiches|das Gleiche|Satz 1|Sätze 1)$/i;
const BLOSSES_SUBJEKT = /^(der|die|das|dieser|diese|dieses|ein|eine)\s+[A-ZÄÖÜ][\wäöüß-]*(\s+(auf|für|nach|über|zur|zum|des|der)\s+[\wäöüß§.\s-]{0,40})?$/i;

/* ─────────────────────────── Hilfen ─────────────────────────── */

const KLAMMER = /\([^()]*\)/g;

/** Kommas zwischen Ziffern („5,5") sind keine Klauselgrenzen — vor der Analyse neutralisieren. */
function zahlkommaSchuetzen(s) {
  return s.replace(/(\d),(\d)/g, "$1\u0001$2");
}

/** Ersetzt Nebensatz- und Klammerinhalte durch Platzhalter gleicher Länge. */
function maskiere(satz) {
  let m = zahlkommaSchuetzen(satz).replace(KLAMMER, (t) => "\u0000".repeat(t.length));

  // Eingeschobene und nachgestellte Nebensätze: ab Komma + Subjunktion/Relativpronomen
  // bis zum nächsten Komma auf gleicher Ebene.
  const teile = [...m.matchAll(/,\s*/g)].map((x) => x.index);
  for (let i = 0; i < teile.length; i++) {
    const start = teile[i];
    const rest = m.slice(start + 1).trimStart();
    if (!SUBJUNKTION.test(rest.split(/\s+/)[0] || "") && !RELATIV.test(rest)) continue;
    const ende = Math.min((teile[i + 1] ?? m.length) + 1, m.length);
    m = m.slice(0, start) + "\u0000".repeat(ende - start) + m.slice(ende);
  }
  return m;
}

/** Findet das finite Verb des Hauptsatzes. Liefert {index, form} oder null. */
export function finitesVerb(satz) {
  const maske = maskiere(satz);
  FINIT_RE.lastIndex = 0;
  let treffer;
  while ((treffer = FINIT_RE.exec(maske)) !== null) {
    if (maske[treffer.index] === "\u0000") continue;
    return { index: treffer.index, form: satz.slice(treffer.index, treffer.index + treffer[0].length) };
  }
  return null;
}

/** Beginnt der Satz mit dem finiten Verb? („Ist die Steuer … abgegolten, gilt …") */
export function verberst(satz) {
  const erstes = satz.trim().split(/\s+/)[0] || "";
  return FINIT.includes(erstes.toLowerCase().replace(/[^a-zäöüß]/g, ""));
}

/* ─────────────────────────── Normtyp ─────────────────────────── */

/**
 * Klassifiziert einen Rechtssatz syntaktisch. Der Typ steuert, WAS überhaupt
 * extrahiert werden darf — nicht umgekehrt wie bisher.
 */
export function normtyp(satz, kontext = {}) {
  // Normüberschrift als starker Hinweis: eine „Anwendungsvorschrift" enthält
  // durchgehend zeitlichen Geltungsbereich, auch wo der Satz das Muster nicht trifft.
  if (ANWENDUNGS_TITEL.test(kontext.normtitel || "")) return "anwendung";
  if (ANWENDUNGSVORSCHRIFT.test(satz)) return "anwendung";
  if (RECHENREGEL.test(satz)) return "rechenregel";
  if (FIKTION.test(satz)) return "fiktion";
  if (TARIF.test(satz) && /\d/.test(satz)) return "tarif";
  if (VERWEISUNG.test(satz) && !/\bwenn\b|\bsoweit\b/i.test(satz)) return "verweisung";
  if (DEFINITION_STARK.test(satz)) return "definition";
  if (verberst(satz) || SUBJUNKTION.test(satz)) return "konditional";
  const v = finitesVerb(satz);
  if (v) {
    const vorfeld = satz.slice(0, v.index).trim();
    if (KONDITIONAL_VORFELD.test(vorfeld)) return "konditional";
    if (PRAEDIKATIV.test(vorfeld)) return "konditional";
  }
  return "aussage";
}

const ANWENDUNGS_TITEL = /^(Anwendungsvorschrift|Anwendungsvorschriften|Zeitlicher Anwendungsbereich|Schlussvorschrift|Übergangsvorschrift|Übergangsregelung|Inkrafttreten|Sondervorschrift für die Anwendung)/i;

/** Normtypen, bei denen überhaupt keine Markierung erzeugt werden darf. */
export const NICHT_MARKIEREN = new Set(["anwendung"]);

/* ─────────────────────────── Vorfeldanalyse ─────────────────────────── */

/**
 * Zerlegt einen Rechtssatz in Tatbestand und Rechtsfolge — syntaktisch begründet.
 *
 * Rückgabe: { typ, vorfeldrolle, elemente: [{art, text, grund}] }
 *   art ∈ tb | rf | ausn | zeit | verwerfen
 *   grund dokumentiert die syntaktische Begründung und landet in der Annotation.
 */
export function zerlege(satz, kontext = {}) {
  const typ = normtyp(satz, kontext);
  const elemente = [];
  const merk = (art, text, grund) => {
    const t = String(text || "").trim().replace(/^[,;:]\s*/, "").replace(/[.,;:]$/, "");
    if (!gehaltvoll(t)) return;
    if (elemente.some((e) => e.text === t)) return;
    elemente.push({ art, text: t, grund });
  };

  if (typ === "anwendung") {
    return { typ, vorfeldrolle: null, elemente: [], hinweis: "Anwendungsvorschrift — keine Markierung." };
  }

  // Ausnahmeteile zuerst herauslösen, damit sie nicht als Tatbestand landen.
  const ausn = ausnahmeSpanne(satz);
  if (ausn) merk("ausn", ausn, "Ausnahmesignal im Satz");

  // Verberststellung: „Ist X …, gilt Y." → Bedingungssatz = Tatbestand
  if (verberst(satz)) {
    const komma = hauptKomma(satz);
    if (komma > 0) {
      merk("tb", satz.slice(0, komma), "Verberststellung: uneingeleiteter Bedingungssatz");
      merk("rf", satz.slice(komma + 1), "Nachfolgender Hauptsatz");
      return { typ, vorfeldrolle: "v1-bedingung", elemente };
    }
  }

  // Tarif- und Rechenregelsätze ohne Bedingungsteil sind vollständig Rechtsfolge.
  if ((typ === "tarif" || typ === "rechenregel") && !SUBJUNKTION.test(satz) && !verberst(satz)) {
    const v0 = finitesVerb(satz);
    const vf0 = v0 ? satz.slice(0, v0.index).trim() : "";
    if (v0 && vorfeldrolle(vf0) === "tb") merk("tb", vf0, "Anwendungsfall vor dem Tarifprädikat");
    merk("rf", v0 ? satz.slice(v0.index) : satz, `${typ === "tarif" ? "Tarif" : "Rechenregel"} — vollständig Rechtsfolge`);
    return { typ, vorfeldrolle: "tarifsatz", elemente };
  }

  // Katalogeintrag mit Doppelpunkt: „soweit X zu erheben ist: nach Y"
  const dp = doppelpunktTeilung(satz);
  if (dp) {
    merk("tb", dp.links, "Bedingungsteil vor dem Doppelpunkt");
    merk("rf", dp.rechts, "Anordnungsteil nach dem Doppelpunkt");
    return { typ, vorfeldrolle: "doppelpunkt", elemente };
  }

  // Eingeleiteter Konditionalsatz: „…, wenn/soweit …"
  const kond = konditionalSpanne(satz);
  if (kond) {
    merk("tb", kond.text, `Konditionalsatz mit „${kond.einleitung}"`);
    const rest = (satz.slice(0, kond.von) + " " + satz.slice(kond.bis)).replace(/\s+/g, " ").trim();
    const v = finitesVerb(rest);
    if (v) {
      const vf = rest.slice(0, v.index).trim();
      const nf = rest.slice(v.index).trim();
      const rolle = vorfeldrolle(vf);
      if (rolle === "rf") { merk("rf", vf, "Prädikativ im Vorfeld"); merk("tb", nf, "Nachfeld nach prädikativem Vorfeld"); }
      else if (rolle === "tb") { merk("tb", vf, "Konditionales Adverbial im Vorfeld"); merk("rf", nf, "Hauptsatzprädikat"); }
      else merk("rf", nf, "Hauptsatzprädikat (Vorfeld ist Normgegenstand)");
    } else if (rest.length > 3) {
      merk("rf", rest, "Hauptsatz nach vorangestelltem Bedingungssatz");
    }
    return { typ, vorfeldrolle: "konditionalsatz", elemente };
  }

  // Regelfall: Verbzweitstellung
  const v = finitesVerb(satz);
  if (!v) {
    merk(typ === "tarif" || typ === "rechenregel" ? "rf" : "tb", satz, "Kein finites Verb erkannt — Satz unzerlegt");
    return { typ, vorfeldrolle: null, elemente };
  }

  const vorfeld = satz.slice(0, v.index).trim();
  const nachfeld = satz.slice(v.index).trim();
  const rolle = vorfeldrolle(vorfeld);

  if (rolle === "rf") {
    merk("rf", vorfeld, "Prädikativ im Vorfeld → Rechtsfolge vorangestellt");
    // Das Nachfeld enthält den Rest des Hauptsatzes UND die Voraussetzungen.
    // Trennen am Beginn des ersten Nebensatzes, sonst das finite Verb abschneiden.
    const grenze = nebensatzBeginn(nachfeld);
    if (grenze > 0) {
      merk("rf", nachfeld.slice(0, grenze), "Rest des Hauptsatzes");
      merk("tb", nachfeld.slice(grenze), "Nebensatz trägt die Voraussetzungen");
    } else {
      merk("tb", ohneFinitesVerb(nachfeld), "Nachfeld trägt die Voraussetzungen");
    }
  } else if (rolle === "tb") {
    merk("tb", vorfeld, "Konditionales Adverbial im Vorfeld → Anwendungsfall");
    merk("rf", nachfeld, "Hauptsatzprädikat → Rechtsfolge");
  } else {
    // Vorfeld ist bloßer Normgegenstand: kein Merkmal, nur die Rechtsfolge bleibt.
    merk("rf", nachfeld, "Vorfeld ist Normgegenstand, kein Tatbestandsmerkmal");
  }

  return { typ, vorfeldrolle: rolle, elemente };
}

/** rf = Rechtsfolge im Vorfeld, tb = Anwendungsfall im Vorfeld, null = bloßes Subjekt. */
export function vorfeldrolle(vorfeld) {
  const v = vorfeld.trim();
  if (!v) return null;
  if (PRAEDIKATIV.test(v)) return "rf";
  if (KONDITIONAL_VORFELD.test(v)) return "tb";
  // Bloße Nominalphrase im Vorfeld ist das Satzsubjekt, nie ein Tatbestandsmerkmal.
  if (PRONOMEN.test(v)) return null;
  if (BLOSSES_SUBJEKT.test(v)) return null;
  if (/^[A-ZÄÖÜ]/.test(v) && v.split(/\s+/).length <= 3) return "rf";
  return "tb";
}

/**
 * Findet den Ausnahmeteil als MINIMALE Klausel um das Signal herum.
 * Bewusst eng: „mit Ausnahme des § 36a EStG" statt des halben Satzes.
 */
function ausnahmeSpanne(satz) {
  const m = AUSNAHME.exec(satz);
  if (!m) return null;
  const g = zahlkommaSchuetzen(satz);
  const grenzeVor = Math.max(g.lastIndexOf(";", m.index), g.lastIndexOf(",", m.index));
  const von = grenzeVor === -1 ? m.index : grenzeVor + 1;
  const kandidaten = [g.indexOf(";", m.index), g.indexOf(",", m.index), satz.length]
    .filter((i) => i > m.index + m[0].length);
  let bis = Math.min(...kandidaten, satz.length);

  // Nie über das finite Verb des Hauptsatzes hinaus, wenn die Ausnahme im Vorfeld steht.
  const v = finitesVerb(satz);
  if (v && v.index > m.index && v.index < bis) bis = v.index;

  const t = satz.slice(von, bis).replace(/[.,;]$/, "").trim();
  if (t.length < 6 || t.split(/\s+/).length > 28) return null;
  return t;
}

/** Findet einen eingeleiteten Konditionalsatz und seine Grenzen. */
function konditionalSpanne(satz) {
  const m = /(^|[,;]\s*)(wenn|soweit|sofern|falls|solange|solange nicht|soweit nicht)\s/i.exec(satz);
  if (!m) return null;
  const von = m.index + m[1].length;
  let bis;
  if (von === 0) {
    // Vorangestellter Bedingungssatz: endet am Komma vor dem Hauptsatz.
    bis = hauptKomma(satz);
    if (bis <= 8) bis = satz.length;
  } else {
    bis = satz.indexOf(";", von);
    if (bis === -1) bis = satz.length;
  }
  const text = satz.slice(von, bis).replace(/[.;]$/, "").trim();
  if (text.length < 8) return null;
  return { von, bis, text, einleitung: m[2].toLowerCase() };
}

/** Erstes Komma außerhalb von Klammern und Nebensätzen. */
function hauptKomma(satz) {
  const maske = maskiere(satz);
  for (let i = 0; i < maske.length; i++) if (maske[i] === ",") return i;
  return -1;
}

/** Enthält der Text überhaupt bedeutungstragendes Material? */
function gehaltvoll(t) {
  if (!t || t.length < 4) return false;
  const woerter = t.split(/\s+/).filter(Boolean);
  if (woerter.length === 1 && FINIT.includes(woerter[0].toLowerCase())) return false;
  const inhalt = t.toLowerCase().match(/[a-zäöüß]{4,}/g) || [];
  return inhalt.some((w) => !FINIT.includes(w) && !FUELLWORT.has(w));
}
const FUELLWORT = new Set([
  "diese", "dieser", "dieses", "diesem", "diesen", "einer", "eines", "einem", "einen",
  "oder", "sowie", "auch", "nach", "nicht", "dabei", "hierbei", "insoweit", "jeweils",
]);

/** „soweit … ist: nach …" — Doppelpunkt trennt Bedingung von Anordnung. */
function doppelpunktTeilung(satz) {
  const i = satz.indexOf(":");
  if (i < 8 || i > satz.length - 8) return null;
  const links = satz.slice(0, i).trim();
  const rechts = satz.slice(i + 1).trim();
  if (!/^(soweit|sofern|wenn|falls|bei|beim|in den Fällen|für)/i.test(links)) return null;
  if (rechts.split(/\s+/).length < 3) return null;
  return { links, rechts };
}

/** Position, an der im Text der erste Nebensatz beginnt (Komma + Einleitung). */
function nebensatzBeginn(text) {
  const m = /,\s*(wenn|soweit|sofern|falls|weil|da|obwohl|damit|dass|ob|solange|wo|der|die|das|dem|den|dessen|deren|welche[rnms]?)\s/i.exec(text);
  return m ? m.index + 1 : -1;
}

/** Schneidet ein führendes finites Verb ab („hat jemand dort" → „jemand dort"). */
function ohneFinitesVerb(text) {
  const w = text.trim().split(/\s+/);
  if (w.length > 1 && FINIT.includes(w[0].toLowerCase())) return w.slice(1).join(" ");
  return text;
}

/* ─────────────────────────── Junktoren ─────────────────────────── */

/**
 * Bestimmt, ob die Nummern einer Aufzählung kumulativ oder alternativ verknüpft sind.
 * Maßgeblich ist die Konjunktion vor dem letzten Glied; fehlt sie, gilt im
 * Steuerrecht bei Tatbestandskatalogen die alternative Lesart.
 */
export function junktor(einheiten, einleitung = "") {
  if (einheiten.length < 2) return null;
  const letzte = einheiten[einheiten.length - 1].text || "";
  const vorletzte = einheiten[einheiten.length - 2].text || "";
  if (/\bund\s*$/i.test(vorletzte) || /^und\b/i.test(letzte)) return "und";
  if (/\boder\s*$/i.test(vorletzte) || /^oder\b/i.test(letzte)) return "oder";
  if (/\bkumulativ\b|\bsämtliche\b|\ballen\b|\bfolgende Voraussetzungen\b/i.test(einleitung)) return "und";
  if (/\beine der\b|\beiner der\b|\bsoweit\b/i.test(einleitung)) return "oder";
  return "oder";
}

/* ─────────────────────────── Zeitangaben ─────────────────────────── */

const MONATE = "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";
export const ZEITANGABE = new RegExp(
  `(\\b\\d{1,2}\\.\\s?(?:${MONATE})\\s?\\d{4}\\b|\\bVeranlagungszeitraum\\s?\\d{4}\\b|\\bab\\s?\\d{4}\\b|\\bBGBl\\.|\\bBStBl\\.)`,
  "i",
);

/** Reine Zeit-/Fundstellenangabe ohne normativen Gehalt? */
export function istZeitangabe(text) {
  const ohne = text.replace(ZEITANGABE, "").replace(/[^\wäöüß]/gi, "").trim();
  return ZEITANGABE.test(text) && ohne.length < 12;
}
