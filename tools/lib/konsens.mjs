import {
  eindeutig,
  hashText,
  passtZuLogik,
  RF_SIGNAL,
  sauberePhrase,
  satzSegmente,
  textDerNorm,
} from "./text.mjs";

const NORMATIV = new Set([
  "rule",
  "definition",
  "fiction",
  "obligation",
  "prohibition",
  "permission",
  "entitlement",
  "calculation",
  "procedure",
  "competence",
]);

function schema(tb, rf, ausnahmen) {
  const schritte = [];
  let nummer = 1;
  for (const text of tb) schritte.push({ n: `${nummer++}.`, t: text, art: "tb" });
  for (const text of ausnahmen) schritte.push({ n: `${nummer++}.`, t: `Ausnahme: ${text}`, art: "tb" });
  for (const text of rf) schritte.push({ n: `${nummer++}.`, t: text, art: "rf" });
  return schritte.slice(0, 30);
}

function kuerzen(spannen, volltext) {
  return spannen
    .filter((phrase, index, alle) => !alle.some((andere, j) => j < index && andere.length < phrase.length && phrase.includes(andere)))
    .sort((a, b) => volltext.indexOf(a) - volltext.indexOf(b))
    .slice(0, 24);
}

function modellKonfidenz(ki) {
  const wert = Number(ki?.konfidenz);
  return Number.isFinite(wert) ? Math.max(0, Math.min(1, wert)) : 0;
}

export function konsensAnnotation({ norm, logik, ki, quellen, gesetz, modell, pipelineVersion, minQuellen }) {
  const volltext = textDerNorm(norm);
  const erreichbar = quellen.filter((quelle) => quelle.erreichbar);
  if (erreichbar.length < minQuellen) {
    throw new Error(`${gesetz.abk}: nur ${erreichbar.length} unabhängige Referenzen erreichbar`);
  }

  const erlaubteIds = new Set(erreichbar.map((quelle) => quelle.id));
  const support = eindeutig((ki?.quellen_support || []).map(String).filter((id) => erlaubteIds.has(id)));
  if (ki && support.length < minQuellen) {
    throw new Error(`${gesetz.abk} ${norm.enbez}: KI nennt nur ${support.length} stützende Referenzen`);
  }
  if (ki && ki.quellen_konsens !== true) {
    throw new Error(`${gesetz.abk} ${norm.enbez}: kein überschneidender Vier-Quellen-Konsens`);
  }

  const kiKonfidenz = modellKonfidenz(ki);
  const kiTb = eindeutig((ki?.tb || []).map((p) => sauberePhrase(p, volltext)).filter(Boolean));
  const kiRf = eindeutig((ki?.rf || []).map((p) => sauberePhrase(p, volltext)).filter(Boolean));
  const kiAusnahmen = eindeutig((ki?.ausnahmen || []).map((p) => sauberePhrase(p, volltext)).filter(Boolean));

  const tbUeberschneidung = kiTb.filter((p) => passtZuLogik(p, logik.tb));
  const rfUeberschneidung = kiRf.filter((p) => passtZuLogik(p, logik.rf));
  const ausnahmeUeberschneidung = kiAusnahmen.filter((p) => passtZuLogik(p, logik.ausnahmen));
  const kiAlleinZulaessig = kiKonfidenz >= 0.9 && support.length >= minQuellen;

  let tb = eindeutig([
    ...logik.tb.map((p) => sauberePhrase(p, volltext)).filter(Boolean),
    ...tbUeberschneidung,
    ...(kiAlleinZulaessig ? kiTb : []),
  ]);
  let rf = eindeutig([
    ...logik.rf.map((p) => sauberePhrase(p, volltext)).filter(Boolean),
    ...rfUeberschneidung,
    ...(kiAlleinZulaessig ? kiRf : []),
  ]);
  let ausnahmen = eindeutig([
    ...logik.ausnahmen.map((p) => sauberePhrase(p, volltext)).filter(Boolean),
    ...ausnahmeUeberschneidung,
    ...(kiAlleinZulaessig ? kiAusnahmen : []),
  ]);

  tb = kuerzen(tb, volltext);
  rf = kuerzen(rf, volltext);
  ausnahmen = kuerzen(ausnahmen, volltext);

  let klassifikation = ki?.klassifikation || logik.klassifikation;
  if (tb.length && rf.length && klassifikation === "no_classic_rule") klassifikation = "rule";

  if (NORMATIV.has(klassifikation)) {
    if (!tb.length && rf.length) {
      const satz = satzSegmente(volltext).find((teil) => teil.includes(rf[0]));
      const signal = satz && RF_SIGNAL.exec(satz);
      if (signal?.index > 1) {
        const phrase = satz.slice(0, signal.index).trim().replace(/[,:;]$/, "");
        if (volltext.includes(phrase)) tb = [phrase];
      }
    }
    if (!rf.length && tb.length) {
      const satz = satzSegmente(volltext).find((teil) => teil.includes(tb[0]));
      const signal = satz && RF_SIGNAL.exec(satz);
      if (signal) {
        const phrase = satz.slice(signal.index).trim();
        if (volltext.includes(phrase)) rf = [phrase];
      }
    }
  }

  const ueberschneidung = Math.min(
    1,
    (tbUeberschneidung.length + rfUeberschneidung.length + ausnahmeUeberschneidung.length) /
      Math.max(1, kiTb.length + kiRf.length + kiAusnahmen.length),
  );
  const quellenFaktor = Math.min(1, support.length / Math.max(minQuellen, 5));
  const konfidenz = Number(
    (kiKonfidenz * 0.5 + logik.staerke * 0.25 + ueberschneidung * 0.15 + quellenFaktor * 0.1).toFixed(3),
  );
  const hatRegel = tb.length > 0 && rf.length > 0;
  const verwendeteQuellen = erreichbar.filter((quelle) => support.includes(quelle.id));

  return {
    tb,
    rf,
    ausnahmen,
    hinweis: hatRegel
      ? `Automatisch aus Normtext, Regellogik und ${support.length} ausdrücklich stützenden Referenzen abgeleitet. Konfidenz ${(konfidenz * 100).toFixed(0)} %. Keine Rechtsberatung.`
      : `Automatisch als „${klassifikation}“ klassifiziert; keine vollständige klassische Tatbestand-Rechtsfolge-Struktur erkannt. ${support.length} stützende Referenzen, Konfidenz ${(konfidenz * 100).toFixed(0)} %.`,
    schema: schema(tb, rf, ausnahmen),
    klassifikation,
    status: hatRegel ? "automatisch_konsens" : "automatisch_klassifiziert",
    konfidenz,
    text_hash: hashText(volltext),
    pipeline_version: pipelineVersion,
    modell: ki ? modell : "nur-regellogik",
    konsens_methode: "ki_logik_quellen",
    quellen_konsens: ki?.quellen_konsens === true,
    quellen: verwendeteQuellen.map((quelle) => ({
      id: quelle.id,
      typ: quelle.typ,
      titel: quelle.titel,
      herausgeber: quelle.herausgeber,
      url: quelle.url,
    })),
    quellen_support: support,
    begruendung_kurz:
      typeof ki?.begruendung_kurz === "string"
        ? ki.begruendung_kurz.slice(0, 240)
        : "Regelbasierte, textnahe Zuordnung ohne Modellfreigabe.",
    aktualisiert: new Date().toISOString(),
  };
}
