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

import { AUXILIAR, UNREGELMAESSIG, istFinitesVerb, istKlammerschluss } from "./verben.mjs";
import { ausnahmeSpannen, ausnahmeAbziehen, DEROGATION } from "./ausnahmen.mjs";

/**
 * Finite Verbformen werden seit Fassung 5 morphologisch bestimmt (verben.mjs).
 * Diese Liste bleibt nur noch für die Stellen erhalten, an denen eine
 * ZEICHENKETTENPRÜFUNG auf die geläufigsten Formen genügt — etwa beim Erkennen
 * des Nebensatzendes. Sie ist ausdrücklich nicht mehr die Erkennungsgrundlage.
 */
const FINIT = [...AUXILIAR, ...UNREGELMAESSIG];
const FINIT_SET = new Set(FINIT);

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
const DEFINITION_STARK = /\b(im Sinne dieses Gesetzes|im Sinne dieser Vorschrift|bezeichnet den|bezeichnet die|Begriff)\b/i;

/** „Familienstiftungen sind Stiftungen, bei denen …" — Legaldefinition. */
const DEFINITION_MUSTER = /^([A-ZÄÖÜ][\wäöüß-]*(?:\s+(?:und|oder)\s+[A-ZÄÖÜ]?[\wäöüß-]+)?)\s+(ist|sind)\s+(.{12,})/;

/** „Den Stiftungen stehen sonstige Zweckvermögen … gleich." — Gleichstellung. */
const GLEICHSTELLUNG = /\b(steh(?:t|en)\b[\s\S]{5,120}\bgleich|gleichgestellt|gleich\s*\.?\s*$)/i;

/** Rechenregel / Rundung. */
const RECHENREGEL = /\b(bleiben außer Ansatz|bleibt außer Ansatz|ist abzurunden|ist aufzurunden|auf volle|Bruchteile|abgerundet|aufgerundet|kaufmännisch gerundet)\b/i;

/** Tarif. */
const TARIF = /\b(beträgt|bemisst sich|Steuersatz|Zuschlagsatz|Prozent|vom Hundert|v\. H\.)\b/i;

/** Normgegenstand-Muster: bloßes Subjekt, das kein Tatbestandsmerkmal ist. */
const PRONOMEN = /^(er|sie|es|dieser|diese|dieses|derselbe|dasselbe|jener|dies|das|dazu|hierzu|darunter|hierunter|dabei|hierbei|davon|hiervon|darin|hierin|dafür|hierfür|dem|denen|deren|dessen|entsprechendes|gleiches|das Gleiche|Satz 1|Sätze 1)$/i;
const BLOSSES_SUBJEKT = /^(der|die|das|dieser|diese|dieses|ein|eine)\s+[A-ZÄÖÜ][\wäöüß-]*(\s+(auf|für|nach|über|zur|zum|des|der)\s+[\wäöüß§.\s-]{0,40})?$/i;

/* ─────────────────────── Satzklammer (Verbklammer) ─────────────────────── */

/**
 * Der deutsche Hauptsatz bildet eine Klammer: Das finite Verb steht an zweiter
 * Stelle, der nicht-finite Teil ganz am Ende.
 *
 *   „Vermögen und Einkünfte … WERDEN dem Stifter … entsprechend ihrem Anteil ZUGERECHNET."
 *
 * Wer nur am finiten Verb schneidet, verliert die eigentliche Rechtsfolge. Deshalb
 * wird der Klammerschluss eigens gesucht; die Rechtsfolge besteht dann aus ZWEI
 * Textstücken, die zusammengehören.
 */

/** Partizip II und Infinitivkonstruktionen, die einen Klammerschluss bilden. */
const KLAMMERSCHLUSS = new RegExp(
  "(?:^|\\s)("
  + "zu\\s+[a-zäöüß]+en"                                  // „zu erheben", „zu entrichten"
  + "|[a-zäöüß]*zu[a-zäöüß]+en"                            // „anzuwenden", „abzuziehen"
  + "|ge[a-zäöüß]{2,}(?:t|en)"                              // „gezahlt", „gegeben"
  + "|(?:an|ab|auf|aus|bei|ein|nach|vor|zu|über|unter|um|mit|fort|hinzu|gleich)"
  + "ge[a-zäöüß]{2,}(?:t|en)"                               // „zugerechnet", „angerechnet"
  + "|(?:be|er|ent|ver|zer|emp|miss)[a-zäöüß]{2,}(?:t|en)"  // „erhoben", „vermindert"
  + "|gleich|gleichgestellt|unberührt|maßgebend|anzusetzen|außer\\s+Ansatz"
  + ")\\s*$",
  "i",
);

/** Finite Hilfs- und Modalverben, die eine Klammer eröffnen können. */
const KLAMMER_AUF = /\b(wird|werden|wurde|wurden|ist|sind|war|waren|hat|haben|hatte|hatten|kann|können|darf|dürfen|muss|müssen|soll|sollen|bleibt|bleiben|steht|stehen|gilt|gelten)\b/i;

/**
 * Findet den Klammerschluss eines Rechtssatzes.
 * @returns {{von:number, text:string}|null}
 */
export function klammerschluss(satz, abVerb = 0) {
  const rumpf = satz.replace(/[.;]\s*$/, "");
  if (!KLAMMER_AUF.test(rumpf.slice(abVerb, abVerb + 40))) return null;

  // Nebensätze und Klammerzusätze ausblenden: Der Klammerschluss gehört zum
  // HAUPTSATZ und steht am Ende von dessen Material, nicht am Satzende.
  const maske = maskiere(rumpf);
  let ende = maske.length;
  while (ende > 0 && (maske[ende - 1] === "\u0000" || /[\s,;]/.test(maske[ende - 1]))) ende--;
  if (ende <= abVerb + 3) return null;

  const hauptsatz = rumpf.slice(0, ende);
  const treffer = KLAMMERSCHLUSS.exec(hauptsatz);
  if (!treffer) return null;

  const von = treffer.index + (treffer[0].length - treffer[1].length);
  if (von <= abVerb + 3) return null;
  const text = rumpf.slice(von, ende).trim();
  if (!text || text.split(/\s+/).length > 4) return null;
  return { von, bis: ende, text };
}

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

/**
 * Zerlegt einen Text in Wörter mit ihrer Zeichenposition. `maskiere` erhält die
 * Länge des Textes, deshalb passen die Positionen aus dem maskierten Text
 * unverändert auf das Original.
 */
function woerterMitOrt(text) {
  const raus = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) raus.push({ wort: m[0], von: m.index });
  return raus;
}

const MASKE = "\u0000";

/**
 * Findet das finite Verb des Hauptsatzes. Liefert {index, form, art} oder null.
 *
 * Seit Fassung 5 morphologisch statt über eine geschlossene Wortliste: Die Liste
 * ließ 15 % aller Rechtssätze unzerlegt, weil das Deutsche finite Formen
 * produktiv bildet („bedient", „übernimmt", „erlässt", „fallen").
 *
 * @param {string} satz
 * @param {string|null} vorgabeMaske  bereits maskierter Text gleicher Länge
 */
export function finitesVerb(satz, vorgabeMaske = null) {
  // Ausgeblendete Bereiche werden zu LEERRAUM, nicht bloß zu Platzhalterzeichen.
  // Das Nullbyte ist selbst ein Nicht-Leerzeichen: „bestimmt, ob …" ergab damit
  // das Einzeltoken „bestimmt\u0000\u0000…", das die Prüfung nie erreichte —
  // das finite Verb unmittelbar vor einem Nebensatz blieb unsichtbar.
  const maske = (vorgabeMaske ?? maskiere(satz)).replaceAll(MASKE, " ");
  const sichtbar = woerterMitOrt(maske);
  if (!sichtbar.length) return null;

  const formen = sichtbar.map((w) => satz.slice(w.von, w.von + w.wort.length));
  // Der Satzanfang zählt nur, wenn das erste sichtbare Wort auch am Textanfang
  // steht — sonst führt die Großschreibungsregel für Position 0 in die Irre.
  const amAnfang = sichtbar[0].von <= satz.length - satz.trimStart().length;
  const liste = amAnfang ? formen : ["\u0000", ...formen];
  const versatz = amAnfang ? 0 : 1;

  for (let i = 0; i < formen.length; i++) {
    const art = istFinitesVerb(liste, i + versatz);
    if (art) return { index: sichtbar[i].von, form: formen[i], art };
  }
  return null;
}

/** Wie finitesVerb, aber auf einem bereits maskierten Text (Nullbytes = ausgeblendet). */
export function finitesVerbAusserhalb(maskiert) {
  return finitesVerb(maskiert, maskiere(maskiert));
}

/** Beginnt der Satz mit dem finiten Verb? („Ist die Steuer … abgegolten, gilt …") */
export function verberst(satz) {
  const erstes = (satz.trim().split(/\s+/)[0] || "").toLowerCase().replace(/[^a-zäöüß]/g, "");
  // Verberststellung gibt es im Normtext praktisch nur mit Hilfs-, Modal- und
  // den geläufigen unregelmäßigen Verben. Eine produktiv gebildete Form am
  // Satzanfang ist dagegen fast immer ein großgeschriebenes Substantiv
  // („Vermögen und Einkünfte … werden zugerechnet").
  return FINIT_SET.has(erstes);
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
  if (GLEICHSTELLUNG.test(satz)) return "gleichstellung";
  if (FIKTION.test(satz)) return "fiktion";
  if (TARIF.test(satz) && /\d/.test(satz)) return "tarif";
  if (VERWEISUNG.test(satz) && !/\bwenn\b|\bsoweit\b/i.test(satz)) return "verweisung";
  if (DEFINITION_STARK.test(satz)) return "definition";
  // „Steuerfrei sind die Umsätze …" trifft das Definitionsmuster, ist aber keine
  // Legaldefinition: Im Vorfeld steht das Prädikativ und damit die RECHTSFOLGE.
  // Ohne diesen Vorrang wird „Steuerfrei" zum Definiendum erklärt.
  if (DEFINITION_MUSTER.test(satz) && !SUBJUNKTION.test(satz.slice(0, 24))
      && !PRAEDIKATIV.test(satz)) return "definition";
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
function zerlegeRoh(satz, kontext = {}) {
  const typ = normtyp(satz, kontext);
  const elemente = [];
  /**
   * Element aus mehreren, im Text auseinanderliegenden Stücken.
   * Jedes Stück ist für sich wörtlich; nur die Anzeige wird zusammengefügt.
   * Nötig für die Satzklammer („werden … zugerechnet") und für Rechtsfolgen,
   * die von einem eingeschobenen Bedingungssatz unterbrochen werden.
   */
  const merkTeile = (art, stuecke, grund) => {
    const teile = stuecke.map(saubere).filter(gehaltvoll);
    if (!teile.length) return;
    if (teile.length === 1) { merk(art, teile[0], grund); return; }
    if (elemente.some((e) => e.art === art && e.text === teile[0])) return;
    elemente.push({
      art, text: teile[0], teile,
      anzeige: teile.join(" … "),
      grund: `${grund} (mehrteilig)`,
    });
  };
  const merkKlammer = (art, erstes, zweites, grund) => merkTeile(art, [erstes, zweites], grund);

  const merk = (art, text, grund) => {
    const t = saubere(text);
    if (!gehaltvoll(t)) return;
    if (elemente.some((e) => e.text === t)) return;
    elemente.push({ art, text: t, grund });
  };

  if (typ === "anwendung") {
    return { typ, vorfeldrolle: null, elemente: [], hinweis: "Anwendungsvorschrift — keine Markierung." };
  }

  // Aufzählungsglied: Nummern und Buchstaben sind elliptisch. Ihr Prädikat steht
  // im Einleitungssatz („Steuerliche Nebenleistungen sind: 1. Verspätungszuschläge
  // …"), im Glied selbst fehlt es. Ohne eigenen Zweig landeten diese 1 937 Glieder
  // in der Auffangregel „Kein finites Verb erkannt" — richtig markiert, aber mit
  // einer Begründung, die den Sachverhalt verfehlt.
  if (kontext.ebene === "nr" && !finitesVerb(satz)) {
    const rolle = katalogRolle(kontext.einleitung || "");
    merk(rolle, satz, `Aufzählungsglied ${kontext.nr || ""}`.trim()
      + ` — ${rolle === "rf" ? "Anordnungsvariante" : "Merkmalsvariante"} des Einleitungssatzes`);
    return { typ, vorfeldrolle: "katalog", elemente };
  }

  // Ausnahmeteile zuerst herauslösen, damit sie nicht als Tatbestand landen.
  // Seit Fassung 5 werden ALLE Ausnahmen eines Rechtssatzes gefunden, nach
  // Bauform unterschieden und von Vorrangregeln getrennt (ausnahmen.mjs).
  const hauptverb = finitesVerb(satz);
  for (const a of ausnahmeSpannen(satz, { verbIndex: hauptverb ? hauptverb.index : -1 })) {
    merk("ausn", a.text, a.grund);
  }

  // Verberststellung: „Ist X …, gilt Y." → Bedingungssatz = Tatbestand
  if (verberst(satz)) {
    const komma = v1Grenze(satz);
    if (komma > 0) {
      merk("tb", satz.slice(0, komma), "Verberststellung: uneingeleiteter Bedingungssatz");
      merk("rf", satz.slice(komma + 1), "Nachfolgender Hauptsatz");
      return { typ, vorfeldrolle: "v1-bedingung", elemente };
    }
  }

  // Legaldefinition: „Familienstiftungen sind Stiftungen, bei denen …"
  // Der definierte Begriff ist weder Tatbestand noch Rechtsfolge, sondern
  // eine eigene Kategorie. Die Merkmale dahinter sind Tatbestandsmerkmale.
  if (typ === "definition") {
    const m = DEFINITION_MUSTER.exec(satz);
    if (m) {
      merk("def", m[1], "Definiendum vor dem Kopulaverb");
      merk("tb", m[3], "Definiens — Merkmale des Begriffs");
      return { typ, vorfeldrolle: "definiendum", elemente };
    }
  }

  // Gleichstellung: „Den Stiftungen stehen sonstige Zweckvermögen … gleich."
  if (typ === "gleichstellung") {
    const v0 = finitesVerb(satz);
    if (v0) {
      const k0 = klammerschluss(satz, v0.index);
      merk("tb", satz.slice(v0.index + v0.form.length, k0 ? k0.von : satz.length),
        "Gleichgestellter Gegenstand");
      const rf = k0
        ? { text: satz.slice(0, v0.index + v0.form.length), zweit: k0.text }
        : { text: satz.slice(0, v0.index + v0.form.length), zweit: null };
      merkKlammer("rf", rf.text, rf.zweit, "Gleichstellungsanordnung");
      return { typ, vorfeldrolle: "gleichstellung", elemente };
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
  // Alles wird am ORIGINALSATZ gerechnet, damit jedes Teilstück wörtlich bleibt
  // und die Positionsanker später stimmen.
  const kond = konditionalSpanne(satz);
  if (kond) {
    merk("tb", kond.text, `Konditionalsatz mit „${kond.einleitung}"`);

    // Finites Verb des Hauptsatzes, Bedingungssatz ausgeblendet
    const ohne = satz.slice(0, kond.von) + "\u0000".repeat(kond.bis - kond.von) + satz.slice(kond.bis);
    const vh = finitesVerbAusserhalb(ohne);
    if (vh) {
      const vorfeldRoh = satz.slice(0, vh.index);
      const vf = saubere(vorfeldRoh.replace(/\u0000+/g, " "));
      const rolle = vorfeldrolle(vf);
      const kl = klammerschluss(ohne, vh.index);
      const ende = kl ? kl.bis : satz.length;

      // Stücke der Rechtsfolge: vom finiten Verb bis zum Ende, ohne den Bedingungssatz
      const stuecke = [];
      let pos = vh.index;
      if (kond.von > pos && kond.von < ende) {
        stuecke.push(satz.slice(pos, kond.von));
        pos = kond.bis;
      }
      if (pos < ende) stuecke.push(satz.slice(pos, ende));

      if (rolle === "rf") {
        merk("rf", vf, "Prädikativ im Vorfeld");
        merkTeile("tb", stuecke, "Nachfeld trägt die Voraussetzungen");
      } else if (rolle === "tb") {
        if (vf) merk("tb", vf, "Konditionales Adverbial im Vorfeld");
        merkTeile("rf", stuecke, "Hauptsatzprädikat");
      } else {
        merkTeile("rf", stuecke, "Hauptsatzprädikat (Vorfeld ist Normgegenstand)");
      }
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

  // Satzklammer: „werden … zugerechnet". Ohne diesen Schritt geht die
  // eigentliche Rechtsfolge am Satzende verloren.
  const klammer = klammerschluss(satz, v.index);

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
    if (klammer) merkKlammer("rf", satz.slice(v.index, klammer.von), klammer.text, "Hauptsatzprädikat");
    else merk("rf", nachfeld, "Hauptsatzprädikat → Rechtsfolge");
  } else {
    // Vorfeld ist bloßer Normgegenstand: kein Merkmal, nur die Rechtsfolge bleibt.
    if (klammer) merkKlammer("rf", satz.slice(v.index, klammer.von), klammer.text, "Hauptsatzprädikat");
    else merk("rf", nachfeld, "Vorfeld ist Normgegenstand, kein Tatbestandsmerkmal");
  }

  return { typ, vorfeldrolle: rolle, elemente };
}

/* ─────────────────────── Entflechtung der Spannen ─────────────────────── */

/**
 * Rangfolge bei Überlappung. Die spezifischere Kategorie behält die Zeichen,
 * die allgemeinere wird um sie beschnitten.
 *
 * Eine Ausnahme ist immer aus einer Regel herausgeschnitten — sie gewinnt gegen
 * beide Regelkategorien. Ein Tatbestand ist enger gefasst als eine Rechtsfolge,
 * die im Regelfall der gesamte Resttext ab dem finiten Verb ist.
 */
const RANG = { ausn: 3, def: 2, tb: 1, rf: 0 };

/**
 * Öffentliche Zerlegung: erst die syntaktische Analyse, dann die Entflechtung.
 *
 * Ohne den zweiten Schritt liegen zwei Kategorien auf denselben Zeichen. Im
 * Bestand betraf das 467 Spannen; das Frontend verodert die Klassen dann zu
 * `mark.tb.rf` und zeigt einen Farbverlauf, der nichts bedeutet.
 */
export function zerlege(satz, kontext = {}) {
  const roh = zerlegeRoh(satz, kontext);
  return { ...roh, elemente: entflechte(roh.elemente || [], satz) };
}

/**
 * Bringt die Spannen eines Rechtssatzes in eine überschneidungsfreie Lage.
 * Jedes Element behält seinen Wortlaut; nur die von einer höherrangigen
 * Kategorie beanspruchten Zeichen werden abgezogen.
 */
function entflechte(elemente, satz) {
  // 1. Jede Spanne im Rechtssatz verorten. Der Cursor verhindert, dass eine
  //    wiederholte Wendung auf die erste statt auf die gemeinte Stelle trifft.
  const verortet = [];
  for (const e of elemente) {
    const stuecke = e.teile ?? [e.text];
    const orte = [];
    let ab = 0;
    for (const st of stuecke) {
      let i = satz.indexOf(st, ab);
      if (i === -1) i = satz.indexOf(st);
      if (i === -1) continue;
      orte.push({ von: i, bis: i + st.length });
      ab = i + st.length;
    }
    if (orte.length) verortet.push({ ...e, orte });
  }

  // 2. Von hoch nach niedrig: Jede Spanne wird um alle bereits vergebenen
  //    Zeichen höheren Ranges beschnitten.
  const sortiert = [...verortet].sort((a, b) => (RANG[b.art] ?? 0) - (RANG[a.art] ?? 0));
  const vergeben = [];
  const raus = [];

  for (const e of sortiert) {
    const stuecke = e.orte.flatMap((o) => ausnahmeAbziehen(o, vergeben));
    const unversehrt = stuecke.length === e.orte.length
      && stuecke.every((o, k) => o.von === e.orte[k].von && o.bis === e.orte[k].bis);
    const texte = stuecke
      .map((o) => saubere(satz.slice(o.von, o.bis)))
      .filter((x) => gehaltvoll(x) && (unversehrt || keinSplitter(x)));
    if (!texte.length) continue;

    // Nur die tatsächlich behaltenen Zeichen sperren — sonst beansprucht eine
    // Spanne Bereiche, die sie nach dem Abzug gar nicht mehr abdeckt.
    for (const o of stuecke) vergeben.push(o);

    const gekuerzt = texte.join(" ") !== (e.teile ?? [e.text]).join(" ");
    if (texte.length === 1) {
      raus.push({
        art: e.art, text: texte[0], anzeige: null, teile: null,
        grund: gekuerzt ? `${e.grund} (um Ausnahme gekürzt)` : e.grund,
      });
    } else {
      raus.push({
        art: e.art, text: texte[0], teile: texte,
        anzeige: texte.join(" … "),
        grund: gekuerzt ? `${e.grund} (um Ausnahme gekürzt)` : e.grund,
      });
    }
  }

  // 3. In Lesereihenfolge zurückgeben.
  const platz = (e) => satz.indexOf((e.teile ?? [e.text])[0]);
  return raus.sort((a, b) => platz(a) - platz(b));
}

/**
 * Grenze zwischen vorangestelltem Bedingungssatz und Hauptsatz bei
 * Verberststellung.
 *
 *   „Werden Einkünfte … dadurch gemindert, dass er … zugrunde legt, …,
 *    SIND seine Einkünfte … anzusetzen."
 *
 * Das erste Komma taugt dafür nicht: Es steht hier vor „dass" und damit mitten
 * im Bedingungssatz. Maßgeblich ist das Komma, hinter dem der Hauptsatz beginnt
 * — erkennbar daran, dass dort „so" oder das finite Verb steht, weil das
 * Vorfeld schon vom Bedingungssatz besetzt ist.
 */
function v1Grenze(satz) {
  const kommas = [...satz.matchAll(/,/g)].map((m) => m.index);
  for (const k of kommas) {
    const rest = satz.slice(k + 1).trimStart();
    const erstes = (rest.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-zäöüß]/g, "");
    if (erstes === "so" || erstes === "dann") return k;
    // Der Hauptsatz nach einem vorangestellten Nebensatz beginnt mit dem
    // finiten Verb. Nur die geschlossenen Klassen zählen — eine produktive
    // Form wäre hier zu unsicher.
    if (FINIT_SET.has(erstes) && k > 8) return k;
  }
  return hauptKomma(satz);
}

/**
 * Welche Rolle nehmen die Glieder einer Aufzählung ein?
 *
 * Sie füllen die Leerstelle, die der Einleitungssatz offen lässt. Steht dort
 * eine Anordnung — ein Modalverb oder eine Infinitivkonstruktion mit „zu" —,
 * sind die Glieder Rechtsfolgenvarianten:
 *
 *   „Das Finanzamt kann anordnen, dass … : 1. …, 2. …"        → Anordnung
 *   „Steuerliche Nebenleistungen sind: 1. Verspätungszuschläge" → Merkmale
 *
 * Im Zweifel gilt die Merkmalslesart: Kataloge des Steuerrechts zählen
 * überwiegend Tatbestandsvarianten auf.
 */
function katalogRolle(einleitung) {
  const e = String(einleitung || "");
  if (!e) return "tb";
  if (/\b(kann|können|darf|dürfen|muss|müssen|soll|sollen|ist zu|sind zu|hat zu|haben zu)\b/i.test(e)
      && !/\b(sind|ist)\s*:?\s*$/i.test(e.trim())) return "rf";
  return "tb";
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
    // Eingeschobener Bedingungssatz: Er endet an dem Komma, das auf sein
    // eigenes finites Verb folgt (Verbletztstellung im Nebensatz).
    bis = nebensatzEnde(satz, von);
    if (bis === -1) {
      bis = satz.indexOf(";", von);
      if (bis === -1) bis = satz.length;
    }
  }
  const text = satz.slice(von, bis).replace(/[.;]$/, "").trim();
  if (text.length < 8) return null;
  return { von, bis, text, einleitung: m[2].toLowerCase() };
}

/**
 * Ende eines eingeschobenen Nebensatzes: das Komma nach seinem finiten Verb.
 * „…, wenn er unbeschränkt steuerpflichtig IST, sonst …" → nach „ist".
 */
function nebensatzEnde(satz, von) {
  const rest = satz.slice(von);
  const kommas = [...rest.matchAll(/,/g)].map((m) => m.index);
  for (const k of kommas) {
    const davor = rest.slice(Math.max(0, k - 40), k).trim().split(/\s+/);
    const letztes = (davor[davor.length - 1] || "").toLowerCase().replace(/[^a-zäöüß]/g, "");
    if (FINIT.includes(letztes) && k > 8) return von + k;
  }
  return -1;
}

/** Erstes Komma außerhalb von Klammern und Nebensätzen. */
function hauptKomma(satz) {
  const maske = maskiere(satz);
  for (let i = 0; i < maske.length; i++) if (maske[i] === ",") return i;
  return -1;
}

function saubere(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/,\s*,+/g, ",")
    .replace(/\s+([,;.])/g, "$1")
    .trim()
    .replace(/^[,;:]\s*/, "")
    // Korrelat am Beginn des Hauptsatzes: „…, SO treffen die Behörden …".
    // Es verweist nur auf den Bedingungssatz zurück und trägt nichts bei.
    .replace(/^(so|dann|sodann)\s+(?=[a-zäöüß])/i, "")
    .replace(/[.,;:]$/, "")
    // hängende Konjunktion am Ende („… anzuwenden, wenn")
    .replace(/[,;]?\s+(wenn|soweit|sofern|falls|und|oder|sowie|dass)$/i, "")
    .trim();
}

/** Bloße Fundstellenangabe ohne eigenen Merkmalsgehalt: „Satz 1", „Absatz 2". */
const NUR_STELLE = /^(?:§+\s*\d+[a-z]?|(?:satz|sätze|absatz|absätze|nummer|nrn?\.?|buchstabe|halbsatz|alternative)\s*\d*[a-z]?)(?:\s*(?:und|bis|sowie|,)\s*\d+[a-z]?)*$/i;

/**
 * Nach dem Abzug einer Ausnahme bleiben mitunter Reststücke übrig, die
 * syntaktisch korrekt aus der Regel geschnitten und als Merkmal trotzdem
 * wertlos sind — „Satz 1", „und der". Kurze, aber vollständige Anordnungen
 * („ist zulässig", „entsteht nicht") müssen dagegen erhalten bleiben.
 */
function keinSplitter(t) {
  const roh = String(t).trim();
  if (NUR_STELLE.test(roh)) return false;
  return roh.split(/\s+/).filter(Boolean).length >= 2;
}

/** Enthält der Text überhaupt bedeutungstragendes Material? */
function gehaltvoll(t) {
  if (!t || t.length < 4) return false;
  const woerter = t.split(/\s+/).filter(Boolean);
  if (woerter.length === 1 && FINIT_SET.has(woerter[0].toLowerCase())) return false;
  // „entsteht nicht", „gilt nicht": Verb plus Verneinung ist eine vollständige
  // Rechtsfolge, auch wenn beide Wörter für sich genommen Funktionswörter sind.
  // Ohne diese Ausnahme fiel die Regel weg und nur ihre Ausnahme blieb stehen.
  if (woerter.length >= 2 && /\b(nicht|kein[e]?[nmrs]?|nie|niemals)\b/i.test(t)
      && woerter.some((w) => FINIT_SET.has(w.toLowerCase()))) return true;
  const inhalt = t.toLowerCase().match(/[a-zäöüß]{4,}/g) || [];
  return inhalt.some((w) => !FINIT_SET.has(w) && !FUELLWORT.has(w));
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
