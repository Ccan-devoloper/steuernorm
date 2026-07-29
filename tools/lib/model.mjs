import { textDerNorm } from "./text.mjs";

const API = "https://models.github.ai/inference/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(30_000, Number(process.env.MODELL_TIMEOUT_MS || 120_000));

export class ModellBudgetErschoepft extends Error {
  constructor(message = "Modellaufruf-Budget erschöpft") {
    super(message);
    this.name = "ModellBudgetErschoepft";
  }
}

export class ModellKontingentErschoepft extends Error {
  constructor(message = "GitHub-Models-Kontingent erschöpft") {
    super(message);
    this.name = "ModellKontingentErschoepft";
  }
}

const SYSTEM = `Du analysierst deutsches Steuerrecht als strukturierter Informationsextraktor. Du erteilst keine Rechtsberatung.
Gib ausschließlich valides JSON zurück. Jede Phrase in tb, rf und ausnahmen muss eine wörtliche, zusammenhängende Teilzeichenkette aus dem gelieferten Normtext sein. Tatbestand sind Voraussetzungen, Adressaten, Gegenstände, Handlungen, Zeit-/Ortselemente und negative Voraussetzungen. Rechtsfolge sind Rechtswirkungen, Pflichten, Verbote, Erlaubnisse, Ansprüche, Fiktionen, Definitionsergebnisse, Berechnungs- und Verfahrensfolgen. Erfasse mehrere Regeln, liefere aber deduplizierte Span-Listen. Klassifiziere jede Norm als rule, definition, fiction, obligation, prohibition, permission, entitlement, calculation, procedure, competence, reference_only oder no_classic_rule.
Quellen dienen zur Plausibilisierung. Nenne in quellen_support nur IDs von Referenzen, deren gelieferter Ausschnitt die Einordnung materiell stützt. Setze quellen_konsens nur dann auf true, wenn mehrere unterschiedliche Referenzen zu einem überschneidenden Ergebnis für die konkrete Norm führen. Der amtliche Normtext darf als eine Referenz zählen. Wenn die Referenzen die konkrete Norm nicht unmittelbar stützen, setze quellen_konsens auf false und nenne nur die tatsächlich stützenden IDs. Bei Unklarheit senke konfidenz. Keine Markdown-Codeblöcke.`;

const KLASSEN = [
  "rule", "definition", "fiction", "obligation", "prohibition", "permission",
  "entitlement", "calculation", "procedure", "competence", "reference_only", "no_classic_rule",
];

const ANTWORT_SCHEMA = {
  name: "steuernorm_annotation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      normen: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            klassifikation: { type: "string", enum: KLASSEN },
            tb: { type: "array", items: { type: "string" } },
            rf: { type: "array", items: { type: "string" } },
            ausnahmen: { type: "array", items: { type: "string" } },
            konfidenz: { type: "number", minimum: 0, maximum: 1 },
            quellen_support: { type: "array", items: { type: "string" } },
            quellen_konsens: { type: "boolean" },
            begruendung_kurz: { type: "string", maxLength: 240 },
          },
          required: [
            "id", "klassifikation", "tb", "rf", "ausnahmen", "konfidenz",
            "quellen_support", "quellen_konsens", "begruendung_kurz",
          ],
        },
      },
    },
    required: ["normen"],
  },
};

function nutzer(gesetz, batch, quellen) {
  return JSON.stringify({
    gesetz: { abk: gesetz.abk, titel: gesetz.titel },
    referenzen: quellen.filter((q) => q.erreichbar).map((q) => ({
      id: q.id,
      typ: q.typ,
      herausgeber: q.herausgeber,
      titel: q.titel,
      url: q.url,
      ausschnitt: q.ausschnitt.slice(0, 900),
    })),
    normen: batch.map(({ norm, logik }) => ({
      id: String(norm.id),
      enbez: norm.enbez,
      titel: norm.titel,
      text: textDerNorm(norm),
      logik_vorschlag: logik,
    })),
  });
}

function antwortInhalt(json) {
  const inhalt = json.choices?.[0]?.message?.content;
  if (!inhalt) throw new Error("Modellantwort ohne Inhalt");
  return JSON.parse(inhalt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
}

function budgetVerbrauchen(budget) {
  if (!budget) return;
  const maximum = Number(budget.maximum);
  if (Number.isFinite(maximum) && budget.verbraucht >= maximum) {
    throw new ModellBudgetErschoepft(`Tagesbudget von ${maximum} Modellaufrufen erreicht`);
  }
  budget.verbraucht++;
}

/** Timeout umfasst Verbindungsaufbau UND das vollständige Lesen des Antwort-Streams. */
async function fetchMitTimeout(body, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Modell-Request-Timeout")), REQUEST_TIMEOUT_MS);
  try {
    const antwort = await fetch(API, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify(body),
    });
    const antworttext = await antwort.text();
    return { antwort, antworttext };
  } finally {
    clearTimeout(timer);
  }
}

async function roherAufruf({ gesetz, batch, quellen, token, modell, budget }) {
  const body = {
    model: modell,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: nutzer(gesetz, batch, quellen) },
    ],
    temperature: 0.1,
    max_tokens: 5_000,
    response_format: { type: "json_schema", json_schema: ANTWORT_SCHEMA },
  };

  let formatStufe = 0;
  let rateVersuche = 0;
  let netzVersuche = 0;
  for (let versuch = 1; versuch <= 6; versuch++) {
    budgetVerbrauchen(budget);
    let antwort;
    let antworttext;
    try {
      ({ antwort, antworttext } = await fetchMitTimeout(body, token));
    } catch (fehler) {
      netzVersuche++;
      const detail = fehler?.name === "AbortError"
        ? `Timeout nach ${REQUEST_TIMEOUT_MS / 1000}s`
        : (fehler?.message || String(fehler));
      if (rateVersuche > 0) {
        throw new ModellKontingentErschoepft(`Netzwerkabbruch nach GitHub-Models-429: ${detail}`);
      }
      if (netzVersuche < 3) {
        const warten = 3_000 * netzVersuche;
        console.warn(`Modellantwort abgebrochen (${detail}); vollständiger neuer Versuch in ${warten / 1_000}s`);
        await new Promise((resolve) => setTimeout(resolve, warten));
        continue;
      }
      throw new ModellKontingentErschoepft(`GitHub Models wiederholt nicht erreichbar: ${detail}`);
    }

    if (antwort.ok) {
      try {
        return antwortInhalt(JSON.parse(antworttext));
      } catch (fehler) {
        netzVersuche++;
        if (netzVersuche < 3) {
          const warten = 3_000 * netzVersuche;
          console.warn(`Unvollständige oder ungültige Modellantwort (${fehler.message}); neuer Versuch in ${warten / 1_000}s`);
          await new Promise((resolve) => setTimeout(resolve, warten));
          continue;
        }
        throw new ModellKontingentErschoepft(`GitHub Models lieferte wiederholt keine vollständige JSON-Antwort: ${fehler.message}`);
      }
    }

    const fehlertext = antworttext;
    if ((antwort.status === 400 || antwort.status === 422) && formatStufe < 2) {
      formatStufe++;
      body.response_format = formatStufe === 1 ? { type: "json_object" } : undefined;
      if (!body.response_format) delete body.response_format;
      continue;
    }
    if (antwort.status === 429) {
      rateVersuche++;
      const retryAfter = Number(antwort.headers.get("retry-after") || 0);
      if (retryAfter > 120 || rateVersuche >= 2) {
        throw new ModellKontingentErschoepft(`GitHub Models 429: ${fehlertext.slice(0, 300)}`);
      }
      const warten = Math.max(60_000, retryAfter * 1_000);
      console.warn(`Modell 429; neuer Versuch in ${Math.round(warten / 1_000)}s`);
      await new Promise((resolve) => setTimeout(resolve, warten));
      continue;
    }
    if (antwort.status >= 500 && versuch < 6) {
      const warten = Math.min(90_000, 2_000 * 2 ** (versuch - 1));
      console.warn(`Modell ${antwort.status}; neuer Versuch in ${warten / 1_000}s`);
      await new Promise((resolve) => setTimeout(resolve, warten));
      continue;
    }
    throw new Error(`GitHub Models ${antwort.status}: ${fehlertext.slice(0, 500)}`);
  }
  throw new ModellKontingentErschoepft("GitHub Models nach mehreren Versuchen nicht erreichbar");
}

export async function modellAufruf(args) {
  const antwort = await roherAufruf(args);
  const vorhandene = new Map((antwort?.normen || []).map((eintrag) => [String(eintrag.id), eintrag]));
  const erwartet = args.batch.map((eintrag) => String(eintrag.norm.id));

  for (const eintrag of args.batch) {
    const id = String(eintrag.norm.id);
    if (vorhandene.has(id)) continue;
    console.warn(`Modellantwort fehlt für ${id}; Einzelwiederholung`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const einzelAntwort = await roherAufruf({ ...args, batch: [eintrag] });
    const treffer = (einzelAntwort?.normen || []).find((ausgabe) => String(ausgabe.id) === id);
    if (!treffer) throw new Error(`Modellantwort fehlt nach Einzelwiederholung für ${id}`);
    vorhandene.set(id, treffer);
  }

  return { normen: erwartet.map((id) => vorhandene.get(id)) };
}
