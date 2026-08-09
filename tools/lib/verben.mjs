/**
 * verben.mjs — morphologische Erkennung finiter Verbformen im deutschen Normtext.
 *
 * Die bisherige Lösung war eine geschlossene Liste von rund sechzig Verbformen.
 * Sie deckt „ist", „sind", „gilt" ab und scheitert an allem anderen: In einer
 * Messung über den Gesamtbestand blieben 2 576 Rechtssätze (15 %) unzerlegt,
 * weil ihr finites Verb nicht auf der Liste stand — darunter Alltagsfälle wie
 *
 *   „Die Finanzbehörde BEDIENT sich der Beweismittel …"
 *   „Die Buchführungspflicht GEHT auf denjenigen über …"
 *   „FEHLT eine gemeinsame Aufsichtsbehörde, so TREFFEN die Behörden …"
 *
 * Eine Liste kann das nicht leisten: Das Deutsche bildet finite Formen produktiv.
 * Dieses Modul entscheidet stattdessen morphologisch und aus der Umgebung.
 *
 * Deterministisch, kein Modellaufruf, kein Netz.
 */

/* ─────────────────────── Geschlossene Klassen ─────────────────────── */

/**
 * Hilfs- und Modalverben. Sie sind unregelmäßig, treten in fast jedem Rechtssatz
 * auf und sind als finite Form eindeutig — hier bleibt die Liste richtig.
 */
export const AUXILIAR = new Set([
  "ist", "sind", "bin", "bist", "seid", "war", "waren", "warst", "wart",
  "sei", "seien", "wäre", "wären", "wär",
  "wird", "werden", "wirst", "werdet", "wurde", "wurden", "wurdest", "wurdet",
  "würde", "würden", "ward",
  "hat", "haben", "habe", "hast", "habt", "hatte", "hatten", "hattest", "hattet", "hätte", "hätten",
  "kann", "können", "kannst", "könnt", "konnte", "konnten", "könne", "könnte", "könnten",
  "darf", "dürfen", "darfst", "dürft", "durfte", "durften", "dürfe", "dürfte", "dürften",
  "muss", "müssen", "musst", "müsst", "musste", "mussten", "müsse", "müsste", "müssten",
  "soll", "sollen", "sollst", "sollt", "sollte", "sollten",
  "will", "wollen", "willst", "wollt", "wollte", "wollten",
  "mag", "mögen", "magst", "mögt", "mochte", "mochten", "möge", "möchte", "möchten",
]);

/**
 * Unregelmäßige Vollverben mit hoher Frequenz im Normtext, deren Form die
 * Morphologieregeln unten nicht sicher trifft (Umlaut, Ablaut, Kurzform).
 */
export const UNREGELMAESSIG = new Set([
  "gilt", "gelten", "galt", "galten", "gälte", "gälten",
  "geht", "gehen", "ging", "gingen",
  "steht", "stehen", "stand", "standen", "stünde", "stünden",
  "besteht", "bestehen", "bestand", "bestanden",
  "entsteht", "entstehen", "entstand", "entstanden",
  "versteht", "verstehen", "gesteht", "gestehen",
  "tritt", "treten", "trat", "traten",
  "fällt", "fallen", "fiel", "fielen",
  "trägt", "tragen", "trug", "trugen",
  "gibt", "geben", "gab", "gaben", "gäbe", "gäben",
  "nimmt", "nehmen", "nahm", "nahmen",
  "hält", "halten", "hielt", "hielten",
  "lässt", "lassen", "ließ", "ließen",
  "trifft", "treffen", "traf", "trafen",
  "greift", "greifen", "griff", "griffen",
  "bleibt", "bleiben", "blieb", "blieben",
  "läuft", "laufen", "lief", "liefen",
  "liegt", "liegen", "lag", "lagen",
  "gehört", "gehören", "beträgt", "betragen", "betrug", "betrugen",
  "erlischt", "erlöschen", "erlosch", "erloschen",
  "fehlt", "fehlen", "fehlte", "fehlten",
  "weiß", "wissen", "wusste", "wussten",
  "spricht", "sprechen", "sprach", "sprachen",
  "bricht", "brechen", "brach", "brachen",
  "nimmt", "übernimmt", "übernehmen", "unternimmt", "unternehmen",
  "erhält", "erhalten", "enthält", "enthalten", "verhält", "verhalten", "behält", "behalten",
  "vergibt", "vergeben", "ergibt", "ergeben", "begibt", "begeben", "übergibt", "übergeben",
  "unterliegt", "unterliegen", "unterlag", "unterlagen",
  "obliegt", "obliegen", "oblag", "oblagen",
  "bedarf", "bedürfen", "bedurfte", "bedurften",
  "misst", "messen", "maß", "maßen", "bemisst", "bemessen",
  "sieht", "sehen", "sah", "sahen", "absieht", "vorsieht", "ansieht",
  "zieht", "ziehen", "zog", "zogen", "abzieht", "unterzieht",
  "bezieht", "beziehen", "bezog", "bezogen", "entzieht", "entziehen",
  "schließt", "schließen", "schloss", "schlossen",
  "verbleibt", "verbleiben", "unterbleibt", "unterbleiben",
]);

/**
 * Wörter, die auf eine finite Endung auslauten, aber nie das finite Verb sind.
 * Ohne diese Sperre werden Adverbien, Präpositionen und Partikeln zu Verben.
 */
export const KEIN_VERB = new Set([
  // Präpositionen
  "mit", "seit", "zeit", "statt", "trotz", "während", "wegen", "gemäß", "laut", "samt",
  "nebst", "binnen", "mittels", "zwecks", "kraft", "dank", "entlang", "gegenüber",
  "innerhalb", "außerhalb", "oberhalb", "unterhalb", "diesseits", "jenseits",
  "aufgrund", "infolge", "anhand", "anstatt", "anstelle", "zugunsten", "zulasten",
  "vorbehaltlich", "unbeschadet", "ungeachtet", "hinsichtlich", "bezüglich", "betreffend",
  "einschließlich", "ausschließlich", "zuzüglich", "abzüglich", "vorbehalten",
  // Adverbien und Partikeln auf -t / -st / -en
  "nicht", "jetzt", "zuletzt", "erst", "zuerst", "meist", "zumeist", "fast", "sonst",
  "selbst", "gesamt", "insgesamt", "mindestens", "höchstens", "spätestens", "frühestens",
  "wenigstens", "zumindest", "bereits", "sogleich", "alsbald", "unverzüglich",
  "dennoch", "jedoch", "indessen", "dagegen", "hingegen", "übrigens", "gleichwohl",
  "häufig", "regelmäßig", "grundsätzlich", "ausnahmsweise", "entsprechend",
  "damit", "dabei", "davon", "dazu", "daran", "darauf", "darin", "darüber", "darunter",
  "hiermit", "hierbei", "hiervon", "hierzu", "hieran", "hierauf", "hierin", "hierüber",
  "wobei", "wovon", "wozu", "woran", "worauf", "worin", "worüber", "worunter",
  // Konjunktionen und Subjunktionen
  "denn", "wenn", "sondern", "sowie", "sofern", "soweit", "solange", "sobald", "seitgleich",
  "nachdem", "bevor", "indem", "obwohl", "obgleich", "wennschon", "falls", "damit",
  "insoweit", "insofern", "soweit", "wohingegen",
  // Determinierer und Pronomen auf -en / -em / -er / -es
  "den", "dem", "des", "der", "die", "das", "einen", "einem", "eines", "einer", "eine",
  "keinen", "keinem", "keines", "keiner", "keine", "kein",
  "seinen", "seinem", "seines", "seiner", "seine", "sein",
  "ihren", "ihrem", "ihres", "ihrer", "ihre", "ihr",
  "diesen", "diesem", "dieses", "dieser", "diese", "dies",
  "jenen", "jenem", "jenes", "jener", "jene",
  "jeden", "jedem", "jedes", "jeder", "jede", "jedweden", "jeglichen",
  "allen", "allem", "alles", "aller", "alle", "sämtlichen", "sämtliche",
  "welchen", "welchem", "welches", "welcher", "welche",
  "dessen", "deren", "denen", "derer", "denjenigen", "demjenigen", "desjenigen",
  "derselben", "denselben", "demselben", "desselben", "dieselben",
  "manchen", "manchem", "mancher", "manche", "solchen", "solchem", "solcher", "solche",
  "anderen", "anderem", "anderer", "andere", "anderes", "beiden", "beide", "beider",
  "mehreren", "mehrere", "einigen", "einige", "wenigen", "wenige", "vielen", "viele",
  "ihnen", "uns", "euch", "sich", "man", "wer", "wen", "wem", "was",
  // sonstige Adjektive und Ordinalzahlen, die als Kandidaten auftauchen
  "erstmals", "letztmals", "geltend", "betroffen", "berechtigt", "verpflichtet",
  "zuständig", "erforderlich", "zulässig", "unzulässig", "maßgebend", "maßgeblich",
]);

/**
 * Trennbare Verbpartikeln. „geht … über", „nimmt … ab": Die Partikel steht am
 * Satzende und gehört zum finiten Verb — sie ist selbst nie das finite Verb.
 */
export const PARTIKEL = new Set([
  "ab", "an", "auf", "aus", "bei", "ein", "mit", "nach", "vor", "zu", "zurück",
  "hinzu", "hervor", "voraus", "gegenüber", "entgegen", "zusammen", "fest", "frei",
  "gleich", "statt", "teil", "wahr", "weg", "wieder", "über", "unter", "um", "durch",
]);

/* ─────────────────────── Morphologie ─────────────────────── */

/** 3. Person Singular Präsens: Stamm + -t/-et. „bedient", „übernimmt", „erstattet". */
const PRAESENS_SG = /^[a-zäöüß]{2,}(?:e?t)$/;
/** 3. Person Plural Präsens und Infinitiv fallen zusammen: Stamm + -en. */
const PRAESENS_PL = /^[a-zäöüß]{2,}e?n$/;
/** Präteritum schwacher Verben: Stamm + -te/-ten. „bestimmte", „erstatteten". */
const PRAETERITUM = /^[a-zäöüß]{3,}te[n]?$/;
/** Partizip II mit ge-Präfix: „gezahlt", „gegeben", „angerechnet". */
const PARTIZIP_GE = /^(?:(?:an|ab|auf|aus|bei|ein|nach|vor|zu|über|unter|um|mit|durch|hinzu|fort|gleich|zurück|zusammen)?ge)[a-zäöüß]{2,}(?:t|en)$/;

/**
 * Kann das Wort ISOLIERT eine finite Verbform sein? Reine Formprüfung, ohne
 * Umgebung — die Umgebungsprüfung leistet `istFinitesVerb`.
 */
export function finiteForm(wort) {
  const w = wort.toLowerCase();
  if (AUXILIAR.has(w)) return "aux";
  if (UNREGELMAESSIG.has(w)) return "unregelmaessig";
  if (KEIN_VERB.has(w)) return null;
  if (w.length < 4) return null;
  if (PRAETERITUM.test(w)) return "praeteritum";
  if (PRAESENS_SG.test(w)) return "praesens-sg";
  if (PRAESENS_PL.test(w)) return "praesens-pl";
  return null;
}

/* ─────────────────────── Umgebungsprüfung ─────────────────────── */

/** Wortformen, nach denen eine Nominalphrase weiterläuft — dann ist das Wort ein Attribut. */
const DETERMINIERER = /^(der|die|das|des|dem|den|ein|eine|einer|eines|einem|einen|kein|keine|keiner|keines|keinem|keinen|dieser|diese|dieses|diesem|diesen|jener|jene|jenes|jeder|jede|jedes|jedem|jeden|aller|alle|alles|allem|allen|sein|seine|seiner|seines|seinem|seinen|ihr|ihre|ihrer|ihres|ihrem|ihren|solcher|solche|solches|solchem|solchen|anderer|andere|anderes|anderem|anderen|derselbe|dieselbe|dasselbe|derjenige|diejenige|dasjenige|welcher|welche|welches|welchem|welchen|mehrere|einige|sämtliche|beide)$/i;

/** Präpositionen: eröffnen eine Präpositionalphrase, in der Attribute stehen. */
const PRAEPOSITION = /^(in|an|auf|über|unter|vor|hinter|neben|zwischen|bei|mit|nach|von|vom|zu|zum|zur|aus|durch|für|gegen|ohne|um|bis|seit|ab|je|pro|am|im|beim|ans|aufs|ins|übers|unters|vors|gemäß|entsprechend|nebst|samt|binnen|kraft|laut|mittels|statt|trotz|während|wegen|innerhalb|außerhalb|aufgrund|infolge|anhand|anstelle|zugunsten|zulasten|vorbehaltlich|unbeschadet|ungeachtet|einschließlich|ausschließlich|zuzüglich|abzüglich|hinsichtlich|bezüglich)$/i;

/** Wörter, die typischerweise UNMITTELBAR auf ein finites Verb folgen. */
const NACH_VERB = /^(sich|es|sie|er|ihn|ihm|ihnen|nicht|auch|nur|noch|bereits|schon|stets|jeweils|insoweit|dabei|damit|davon|dazu|hierbei|so|dann|zudem|ferner|ebenfalls|weder|entweder|allein|lediglich|ausschließlich|grundsätzlich|regelmäßig|entsprechend|sinngemäß|unverzüglich|jährlich|monatlich|künftig|erstmals|letztmals)$/i;

const istGross = (w) => /^[A-ZÄÖÜ]/.test(w);

/**
 * Ist das Wort an Position `i` der Wortliste das finite Verb des Hauptsatzes?
 *
 * Die Formprüfung allein genügt nicht: „zuständigen", „genannten", „bestimmten"
 * tragen dieselbe Endung wie eine finite Pluralform. Sie unterscheiden sich durch
 * die Umgebung — ein Attribut steht INNERHALB einer Nominalphrase und wird von
 * einem Substantiv gefolgt, ein finites Verb nicht.
 */
export function istFinitesVerb(woerter, i) {
  const w = String(woerter[i] || "").replace(/[^\wäöüßÄÖÜ]/g, "");
  if (!w) return null;

  const art = finiteForm(w);
  if (!art) return null;

  const vorher = String(woerter[i - 1] || "").replace(/[^\wäöüßÄÖÜ]/g, "");
  const nachher = String(woerter[i + 1] || "").replace(/[^\wäöüßÄÖÜ]/g, "");

  // Großschreibung außerhalb des Satzanfangs ist ein Substantiv, kein Verb.
  if (i > 0 && istGross(w) && !AUXILIAR.has(w.toLowerCase())) return null;

  // Am Satzanfang ist die Großschreibung uninformativ. Verberststellung gibt es
  // im Normtext nur mit Hilfs-, Modal- und den geläufigen unregelmäßigen Verben
  // („Ist …", „Werden …", „Fehlt …"). Eine produktiv gebildete Form an erster
  // Stelle ist dagegen praktisch immer ein großgeschriebenes Substantiv:
  // „Vermögen und Einkünfte … werden zugerechnet" — „Vermögen" ist kein Verb.
  if (i === 0 && istGross(w) && art !== "aux" && art !== "unregelmaessig") {
    // Ausnahme: Bei Verberststellung folgt dem Verb unmittelbar sein Subjekt,
    // also ein Determinierer oder Pronomen — „WENDET EINE Körperschaft … zu,
    // darf sie …". Ein Substantiv am Satzanfang wird dagegen von einer
    // Konjunktion oder einem weiteren Substantiv gefolgt.
    const v1 = art === "praesens-sg" && nachher
      && (DETERMINIERER.test(nachher) || /^(sich|er|sie|es|man|jemand)$/i.test(nachher));
    if (!v1) return null;
  }

  // „zu erheben", „zu entrichten" — Infinitiv mit zu, nie finit. Nur INFINITIVE
  // sind gemeint: In „… Mittel einer Körperschaft ZU, darf sie …" ist „zu" die
  // abgetrennte Verbpartikel des Bedingungssatzes, und „darf" bleibt finit.
  if (vorher.toLowerCase() === "zu" && /en$/.test(w.toLowerCase())) return null;

  // Partizip II ist nie das finite Verb („ist … gezahlt worden"). Die ge-Form
  // allein trägt das aber nicht: „genügt", „gewährt", „gestattet", „gelangt"
  // sind finite Vollverben mit ge-Stamm. Unterscheidungsmerkmal ist die
  // Verbklammer — ein Partizip setzt ein voranstehendes Hilfs- oder Modalverb
  // voraus, das die Klammer überhaupt erst öffnet. Ohne ein solches ist die
  // ge-Form das finite Verb des Satzes („Als Beschlagnahme GENÜGT das Verbot").
  if (PARTIZIP_GE.test(w.toLowerCase()) && !UNREGELMAESSIG.has(w.toLowerCase())) {
    const klammerOffen = woerter
      .slice(0, i)
      .some((x) => AUXILIAR.has(String(x).toLowerCase().replace(/[^\wäöüß]/g, "")));
    if (klammerOffen) return null;
  }

  // Hilfs- und Modalverben sind eindeutig; die Attributprobe entfällt.
  if (art === "aux") return art;

  // Attributprobe: Steht das Wort in einer Nominalphrase, ist es ein Adjektiv.
  //   „die fachlich ZUSTÄNDIGEN Aufsichtsbehörden" → Attribut (Substantiv folgt)
  //   „so TREFFEN die Aufsichtsbehörden" → Verb (Determinierer folgt)
  if (/(?:en|em|er|es|e)$/.test(w.toLowerCase()) && !/(?:t|te|ten)$/.test(w.toLowerCase())) {
    if (nachher && istGross(nachher)) return null;                    // Substantiv folgt
    if (nachher && /(?:en|em|er|es|e)$/i.test(nachher) && !NACH_VERB.test(nachher)
        && !DETERMINIERER.test(nachher) && !PRAEPOSITION.test(nachher)) return null;
  }

  // Ein Attribut wird von einem Determinierer oder einer Präposition eingeleitet
  // und schließt mit einem Substantiv ab. Folgt dagegen ein Determinierer, eine
  // Präposition, ein Pronomen oder eine Negation, liegt ein Verb vor.
  const folgtNP = nachher && (DETERMINIERER.test(nachher) || PRAEPOSITION.test(nachher) || NACH_VERB.test(nachher));
  const stehtInNP = vorher && (DETERMINIERER.test(vorher) || PRAEPOSITION.test(vorher));
  if (stehtInNP && !folgtNP && nachher && istGross(nachher)) return null;

  return art;
}

/**
 * Findet das finite Verb in einer Wortliste und liefert seinen Wortindex.
 * `ab` erlaubt es, hinter einem bereits gefundenen Verb weiterzusuchen.
 */
export function findeFinit(woerter, ab = 0) {
  for (let i = ab; i < woerter.length; i++) {
    const art = istFinitesVerb(woerter, i);
    if (art) return { i, art, form: woerter[i] };
  }
  return null;
}

/**
 * Steht das Wort am Satzende und schließt es die Verbklammer?
 * „werden dem Stifter … ZUGERECHNET", „ist … ZU ERHEBEN".
 */
export function istKlammerschluss(wort, vorwort = "") {
  const w = String(wort || "").toLowerCase().replace(/[^\wäöüß]/g, "");
  if (!w) return false;
  if (PARTIKEL.has(w)) return true;
  if (PARTIZIP_GE.test(w)) return true;
  if (String(vorwort).toLowerCase() === "zu" && /en$/.test(w)) return true;
  if (/^[a-zäöüß]*zu[a-zäöüß]+en$/.test(w)) return true;                 // „anzuwenden"
  if (/^(?:be|er|ent|ver|zer|emp|miss|über|unter|durch)[a-zäöüß]{2,}(?:t|en)$/.test(w)) return true;
  return false;
}
