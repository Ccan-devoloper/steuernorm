/**
 * modell.mjs — Anbindung an die Gemini-API (Google AI Studio) mit MEHRFACH-SAMPLING.
 *
 * GitHub Models wurde am 30.07.2026 vollständig abgeschaltet. Statt eines
 * kostenpflichtigen Ersatzes (OpenAI direkt) nutzt dieses Modul den DAUERHAFT
 * KOSTENLOSEN Zugang von Google AI Studio: kein Zahlungsmittel nötig, keine
 * Kartenprüfung, kein Ablaufdatum. Google veröffentlicht dafür einen zu OpenAI
 * kompatiblen Endpunkt (https://generativelanguage.googleapis.com/v1beta/openai),
 * der dasselbe Nachrichten- und Antwortformat spricht wie GitHub Models zuvor —
 * geändert haben sich nur Endpunkt, Modellnamen und die Art des Schlüssels.
 *
 * WICHTIGE EINSCHRÄNKUNG DER KOSTENLOSEN STUFE, die diesen Umbau von der
 * OpenAI-Fassung unterscheidet: Die Freistufe begrenzt nicht nur, wie schnell
 * angefragt werden darf (RPM), sondern auch, wie oft INSGESAMT PRO TAG (RPD).
 * Dieses Modul hält deshalb selbst eine Mindestpause zwischen zwei Anfragen ein
 * (siehe `MINDESTABSTAND_MS`) und behandelt eine wiederholte 429-Antwort als
 * Tagesgrenze, nicht als kurze Störung — der Lauf bricht dann kontrolliert ab
 * und der geplante Tageslauf setzt am nächsten Tag fort (siehe annotieren.mjs).
 * Außerdem kann Google Prompts der Freistufe zur Modellverbesserung verwenden;
 * bei öffentlichem Gesetzestext ist das unproblematisch, aber erwähnenswert.
 *
 * Der entscheidende Unterschied zur bisherigen Fassung: Jede Norm wird k-mal
 * unabhängig analysiert (unterschiedliche Temperatur, optional unterschiedliche
 * Modelle). Als gesichert gilt nur, was in mindestens `KONSENS_ANTEIL` der Läufe
 * gleich herauskommt. Damit tritt die Übereinstimmung mehrerer Läufe an die Stelle
 * der menschlichen Durchsicht — und die Konfidenz misst etwas Reales statt der
 * Selbsteinschätzung eines einzelnen Laufs.
 *
 * Zusätzlich läuft eine GEGENPROBE: Ein zweiter Aufruf bekommt nur die extrahierten
 * Spannen ohne die erste Begründung und muss unabhängig entscheiden, ob eine Spanne
 * Voraussetzung oder Folge ist. Weicht sie ab, wird die Spanne verworfen.
 */

/* ── Anbieter ─────────────────────────────────────────────────────────
   Der Endpunkt stand als feste Zeichenkette hier. Das band die ganze Pipeline
   an Google, obwohl nichts daran googlespezifisch ist: Gesprochen wird der zu
   OpenAI kompatible Dialekt, den mehrere Anbieter bereitstellen. Ein Wechsel
   ist damit eine Umgebungsvariable und kein Commit — und man kann zwei
   Anbieter an denselben 45 Normen gegeneinander messen.

     KI_ENDPUNKT=https://api.anthropic.com/v1
     KI_SCHLUESSEL=…

   `KI_OHNE_SCHEMA=1` schaltet den Antwortzwang über `response_format` ab.
   Google trägt ihn; wer ihn nicht trägt, antwortet mit HTTP 400 auf das Feld
   und nicht auf den Inhalt. Das Schema steht dann nur in der Anweisung, und
   die Antwort wird wie bisher nachgeprüft — schwächer, aber nicht blind. */
const BASIS = (process.env.KI_ENDPUNKT || "https://generativelanguage.googleapis.com/v1beta/openai")
  .replace(/\/+$/, "");
export const ENDPUNKT = `${BASIS}/chat/completions`;
export const MODELLLISTE = `${BASIS}/models`;
const SCHEMA_ZWANG = process.env.KI_OHNE_SCHEMA !== "1";
const TIMEOUT_MS = 90_000;

/**
 * Welche Modelle dieser Schlüssel wirklich benutzen darf.
 *
 * WARUM DAS SEIN MUSS. Ein fest eingetragener Modellname überlebt keinen
 * Zeitraum: Google zieht Modelle zurück und benennt sie um, ohne Ankündigung.
 * Die API antwortet dann mit HTTP 404 („models/… is not found for API version
 * v1beta") — derselben Zahl, die auch ein falscher Pfad liefert, und einer
 * ganz anderen als bei einem ungültigen Schlüssel (400 oder 403). Wer das
 * nicht auseinanderhält, sucht den Fehler beim Schlüssel und findet ihn nie.
 *
 * Der Aufruf ist billig und zählt nicht gegen das Tageskontingent für
 * Generierungen.
 *
 * @returns {Promise<string[]>} Modellkennungen, kürzeste zuerst
 */
export async function verfuegbareModelle(token) {
  const antwort = await fetch(MODELLLISTE, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!antwort.ok) {
    const text = (await antwort.text().catch(() => "")).slice(0, 300);
    throw new Error(`Modellliste nicht abrufbar (HTTP ${antwort.status}). ${text}`);
  }
  const daten = await antwort.json();
  return (daten.data || [])
    .map((m) => String(m.id || "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort();
}

/**
 * Antwortet dieses Modell wirklich?
 *
 * WARUM DAS NICHT AUS DER LISTE HERVORGEHT. Die Modellliste sagt, was
 * existiert — nicht, was dieser Schlüssel aufrufen darf. `gemini-2.5-flash`
 * steht dort und antwortet trotzdem mit
 *
 *     404 This model models/gemini-2.5-flash is no longer available to new users.
 *
 * Ein Modell kann also gelistet und zugleich für neue Schlüssel gesperrt sein.
 * Diese Unterscheidung kennt nur der Aufruf selbst, deshalb wird gefragt:
 * ein Token, einmal je Modell, vor dem ersten Normlauf.
 *
 * @returns {Promise<{ ok: boolean, status: number, meldung: string }>}
 */
export async function modellAntwortet(token, modell) {
  try {
    const antwort = await fetch(ENDPUNKT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modell,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (antwort.ok) return { ok: true, status: 200, meldung: "" };
    const text = (await antwort.text().catch(() => "")).slice(0, 200);
    /* Die eigentliche Auskunft steckt im Text, nicht in der Zahl: „no longer
       available to new users" ist etwas anderes als ein Tippfehler im Namen. */
    const grund = /"message":\s*"([^"]+)"/.exec(text)?.[1] || text;
    return { ok: false, status: antwort.status, meldung: grund };
  } catch (fehler) {
    return { ok: false, status: 0, meldung: fehler.message };
  }
}

/* Sonderzwecke, die für die Normanalyse nicht in Frage kommen: Einbettung,
   Bild, Sprache, Robotik, Rechnersteuerung, Übersetzung, Werkzeugvarianten. */
const SONDERZWECK = /embedding|image|vision|tts|audio|live|robotics|computer-use|omni|translate|customtools|thinking/;

/** „gemini-3.6-flash" → 3.6. Aliasse tragen keine Zahl. */
function fassung(kennung) {
  const treffer = /^gemini-(\d+(?:\.\d+)?)-/.exec(kennung);
  return treffer ? Number(treffer[1]) : -1;
}

/**
 * Modelle nach Eignung ordnen — beste zuerst.
 *
 * DREI GRUPPEN, in dieser Reihenfolge:
 *
 *   1. Feste Endfassungen (gemini-3.6-flash)
 *   2. Aliasse (gemini-flash-latest)
 *   3. Vorschauen (…-preview)
 *
 * Warum der Alias NICHT vorn steht, obwohl er immer aktuell ist: Er wandert.
 * Der Annotationsbericht hält fest, mit welchem Modell eine Zuordnung
 * entstanden ist — bei `gemini-flash-latest` sagt dieser Eintrag nichts, weil
 * dahinter heute ein anderes Modell steht als morgen. Für einen Bestand, der
 * seine Herkunft belegen soll, ist ein wandernder Name wertlos. Der Alias
 * bleibt als Auffangnetz, wenn keine feste Fassung antwortet.
 *
 * Innerhalb der Gruppen: Fassung absteigend, Vollfassung vor `-lite`. Ohne
 * diese Ordnung gewann die reine Zeichenkettensortierung — und lieferte
 * `gemini-omni-flash-preview` als Ersatz für ein Flash-Modell.
 */
export function modelleOrdnen(verfuegbar, familie = "flash") {
  const rang = (m) => [
    /preview/.test(m) ? 2 : (fassung(m) < 0 ? 1 : 0),   // Endfassung, Alias, Vorschau
    -fassung(m),                                        // jüngste zuerst
    /-lite/.test(m) ? 1 : 0,                            // voll vor lite
  ];
  return verfuegbar
    .filter((m) => m.startsWith("gemini-") && !SONDERZWECK.test(m)
      && (m.includes(familie) || /-latest$/.test(m)))
    .filter((m) => (familie === "pro" ? /pro/.test(m) : !/pro/.test(m)))
    .sort((a, b) => {
      const ra = rang(a), rb = rang(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return a.localeCompare(b);
    });
}

/**
 * Gewünschte Modelle gegen die tatsächlich verfügbaren abgleichen.
 *
 * Ohne Wunsch werden die zwei bestgeeigneten Flash-Modelle gewählt. Das ist
 * die wartungsfreie Voreinstellung: Ein fest eingetragener Name überlebt
 * keinen längeren Zeitraum, und genau daran ist der Lauf gescheitert.
 *
 * Ersetzt wird nie stillschweigend — jeder Tausch steht im Ergebnis.
 *
 * @returns {{ modelle: string[], ersetzt: Array<{ gewuenscht: string, statt: string|null }> }}
 */
export function modelleAbgleichen(gewuenscht, verfuegbar) {
  const flash = modelleOrdnen(verfuegbar, "flash");
  if (!gewuenscht.length) {
    /* Ohne Wunsch die zwei besten VOLLEN Flash-Modelle: `-lite` ist schwächer,
       und zwei Modelle sind hier nicht Redundanz, sondern Messinstrument —
       zwei getrennte Modelle irren seltener übereinstimmend als eines zweimal.
       Reicht es nicht für zwei, wird mit `-lite` aufgefüllt. */
    const voll = flash.filter((m) => !/-lite/.test(m));
    return { modelle: [...voll, ...flash.filter((m) => /-lite/.test(m))].slice(0, 2), ersetzt: [] };
  }

  const da = new Set(verfuegbar);
  const modelle = [];
  const ersetzt = [];

  for (const wunsch of gewuenscht) {
    if (da.has(wunsch)) { modelle.push(wunsch); continue; }
    const geordnet = /pro/.test(wunsch) ? modelleOrdnen(verfuegbar, "pro") : flash;
    const statt = geordnet.find((m) => !modelle.includes(m)) || null;
    ersetzt.push({ gewuenscht: wunsch, statt });
    if (statt) modelle.push(statt);
  }
  return { modelle, ersetzt };
}


/**
 * Mindestabstand zwischen zwei Anfragen. Gemini begrenzt die Freistufe je nach
 * Modell auf ungefähr 10–15 Anfragen pro Minute; die genaue Zahl schwankt und
 * wird von Google ohne Vorankündigung angepasst. 6500 ms (≈ 9,2 Anfragen/min)
 * ist bewusst vorsichtig gewählt — lieber langsamer als ständig 429-Fehler.
 * Überschreibbar über die Umgebungsvariable KI_MINDESTABSTAND_MS.
 */
const MINDESTABSTAND_MS = Number(globalThis.process?.env?.KI_MINDESTABSTAND_MS) || 6_500;
let LETZTE_ANFRAGE = 0;

async function pausiere() {
  const warten = MINDESTABSTAND_MS - (Date.now() - LETZTE_ANFRAGE);
  if (warten > 0) await new Promise((r) => setTimeout(r, warten));
  LETZTE_ANFRAGE = Date.now();
}

export class ModellKontingentErschoepft extends Error {}
export class ModellBudgetErschoepft extends Error {}
/** Tageskontingent der Freistufe erreicht. Erbt bewusst von ModellBudgetErschoepft,
 *  damit jede Stelle, die auf einen kontrollierten Gesamtabbruch reagiert, das
 *  automatisch mit erfasst — auch ohne dort eigens geändert zu werden. */
export class ModellTageslimitErschoepft extends ModellBudgetErschoepft {}
/** Das angeforderte Modell gibt es nicht (mehr). Erbt aus demselben Grund von
 *  ModellBudgetErschoepft: Weiterlaufen hat keinen Zweck, jeder weitere Aufruf
 *  scheiterte identisch. */
export class ModellNichtVorhanden extends ModellBudgetErschoepft {}
/**
 * DIESES Modell ist am Kontingent — andere sind es womöglich nicht.
 *
 * Erbt bewusst NICHT von ModellBudgetErschoepft: Die Freistufe zählt je Modell
 * getrennt. Ein erschöpftes gemini-3.6-flash sagt nichts über
 * gemini-2.5-flash-lite. Der Aufrufer wechselt deshalb das Modell, statt den
 * ganzen Lauf zu beenden; erst wenn alle stehen, ist der Tag vorbei.
 */
export class ModellPauseNoetig extends Error {
  constructor(modell, meldung){ super(meldung); this.modell = modell; }
}

/** Modelle, die in diesem Lauf am Kontingent sind. */
const ERSCHOEPFT = new Set();
export const erschoepfteModelle = () => [...ERSCHOEPFT];

/* ─────────────────────────── Systemvorgaben ─────────────────────────── */

const SYSTEM_EXTRAKTION = `Du zerlegst deutsche Steuerrechtsnormen in Tatbestand und Rechtsfolge. Du erteilst keine Rechtsberatung und gibst ausschließlich valides JSON zurück.

GRUNDREGEL DER DEUTSCHEN SYNTAX
Im Hauptsatz steht das finite Verb an zweiter Stelle. Was davor steht (Vorfeld), ist genau ein Satzglied. Prüfe für jeden Rechtssatz zuerst, WAS im Vorfeld steht:
- Prädikatives Adjektiv oder Partizip ("Abgabepflichtig sind …", "Steuerfrei sind …", "Maßgebend ist …") → das Vorfeld ist die RECHTSFOLGE, das Nachfeld enthält die Voraussetzungen.
- Konditionales Adverbial ("Bei der Veranlagung …", "Beim Abzug vom Arbeitslohn …", "Im Falle des …") → das Vorfeld ist der TATBESTAND (Anwendungsfall).
- Bloßes Satzsubjekt, das den Normgegenstand nennt ("Der Solidaritätszuschlag", "Die Steuer") → KEIN Merkmal, gar nicht erfassen.
- Verberststellung ("Ist die Steuer abgegolten, gilt …") → der vorangestellte Teil ist ein uneingeleiteter Bedingungssatz, also TATBESTAND.

NORMTYPEN
Nicht jede Vorschrift hat Tatbestand und Rechtsfolge. Ordne jedem Rechtssatz genau einen Typ zu:
konditional | tarif | definition | fiktion | verweisung | rechenregel | anwendung | aussage
- tarif: setzt nur einen Satz oder Betrag fest. Hat KEINEN eigenen Tatbestand. tb bleibt leer.
- anwendung: zeitlicher Geltungsbereich einer Fassung ("… ist erstmals für den Veranlagungszeitraum 2026 anzuwenden"). Gib WEDER tb NOCH rf zurück, beide Listen leer.
- rechenregel: Rundung und Ähnliches. Vollständig Rechtsfolge.
- verweisung: ordnet die Anwendung anderer Vorschriften an.

HARTE ANFORDERUNGEN
1. Jede Spanne ist eine wörtliche, zusammenhängende Teilzeichenkette GENAU DES Rechtssatzes, dem du sie zuordnest. Nicht aus einem anderen Absatz.
2. Keine Spanne beginnt mit einem Monatsnamen, einer Konjunktion oder einem Satzzeichen.
3. Keine Spanne besteht nur aus einer Fundstelle (BGBl., BStBl.) oder einer Datumsangabe.
4. Keine Spanne umfasst mehr als 45 Wörter. Zerlege stattdessen.
5. Ausnahmen ("mit Ausnahme", "es sei denn", "abweichend von") gehören in ausnahmen, nicht in tb.
6. Bei Aufzählungen: gib jede Nummer einzeln zurück und setze junktor auf "und" (kumulativ) oder "oder" (alternativ).

BELEGSTELLEN
Wenn dir Auszüge aus einer amtlichen Verwaltungsanweisung (AEAO, UStAE, EStR/EStH, KStR, GewStR) oder Leitsätze der Rechtsprechung vorgelegt werden, gilt:
- Benennt die Verwaltungsauffassung ein Tatbestandsmerkmal ausdrücklich, richte dich danach, auch wenn der syntaktische Vorschlag etwas anderes nahelegt.
- Trage in "belege" die Fundstelle EXAKT so ein, wie sie im vorgelegten Beleg steht (Feld "fundstelle"). Erfinde keine Fundstellen. Findest du keine passende Belegstelle, lass die Liste leer.
- Enthält der Beleg eine ausformulierte Prüfungsreihenfolge, richte die Reihenfolge deiner Merkmale danach aus.

Begründe jede Zuordnung in einem Satz über das Satzglied, nicht über den Inhalt.`;

const SYSTEM_GEGENPROBE = `Du bekommst einen Rechtssatz aus einem deutschen Steuergesetz und einzelne wörtliche Ausschnitte daraus. Entscheide für jeden Ausschnitt UNABHÄNGIG, ob er
- eine Voraussetzung der Norm beschreibt (tb),
- eine Rechtswirkung anordnet (rf),
- eine Ausnahme oder Rückausnahme ist (ausn),
- oder gar kein normatives Merkmal ist (kein).

Achte besonders auf vorangestellte Rechtsfolgen: In "Abgabepflichtig sind natürliche Personen …" ist "Abgabepflichtig" die Rechtsfolge und "natürliche Personen …" die Voraussetzung.

Antworte ausschließlich mit valider JSON. Keine Begründung, keine Markdown-Blöcke.`;

/* ─────────────────────────── Antwortschemata ─────────────────────────── */

const TYPEN = ["konditional", "tarif", "definition", "fiktion", "verweisung", "rechenregel", "anwendung", "aussage"];

const SCHEMA_EXTRAKTION = {
  name: "normzerlegung",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      saetze: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            pfad: { type: "string" },
            typ: { type: "string", enum: TYPEN },
            vorfeld: { type: "string", enum: ["rechtsfolge", "tatbestand", "normsubjekt", "verberst", "keines"] },
            junktor: { type: "string", enum: ["und", "oder", "keiner"] },
            tb: { type: "array", items: { type: "string" } },
            rf: { type: "array", items: { type: "string" } },
            ausnahmen: { type: "array", items: { type: "string" } },
            belege: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { text: { type: "string" }, fundstelle: { type: "string" } },
                required: ["text", "fundstelle"],
              },
            },
            begruendung: { type: "string", maxLength: 200 },
          },
          required: ["pfad", "typ", "vorfeld", "junktor", "tb", "rf", "ausnahmen", "belege", "begruendung"],
        },
      },
    },
    required: ["saetze"],
  },
};

const SCHEMA_GEGENPROBE = {
  name: "gegenprobe",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      urteile: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            i: { type: "integer" },
            art: { type: "string", enum: ["tb", "rf", "ausn", "kein"] },
          },
          required: ["i", "art"],
        },
      },
    },
    required: ["urteile"],
  },
};

/* ─────────────────────────── Aufruf ─────────────────────────── */

export async function einAufruf({ system, nutzer, schema, modell, temperatur, token, budget }) {
  if (budget && budget.verbraucht >= budget.maximum) {
    throw new ModellBudgetErschoepft(`Budget von ${budget.maximum} Modellaufrufen erschöpft`);
  }
  if (budget) budget.verbraucht++;

  const body = {
    model: modell,
    messages: [
      { role: "system", content: system },
      { role: "user", content: nutzer },
    ],
    temperature: temperatur,
    max_tokens: 6_000,
    response_format: SCHEMA_ZWANG
      ? { type: "json_schema", json_schema: schema }
      : { type: "json_object" },
  };

  let folge429 = 0;   // aufeinanderfolgende 429-Antworten TROTZ Wartezeit

  for (let versuch = 1; versuch <= 5; versuch++) {
    await pausiere();   // Mindestabstand zur letzten Anfrage einhalten (RPM-Grenze)
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), TIMEOUT_MS);
    let antwort, text;
    try {
      antwort = await fetch(ENDPUNKT, {
        method: "POST",
        signal: abbruch.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      text = await antwort.text();
    } catch (fehler) {
      clearTimeout(uhr);
      if (versuch >= 3) throw new ModellKontingentErschoepft(`Netzfehler: ${fehler.message}`);
      await warte(2_000 * versuch);
      continue;
    }
    clearTimeout(uhr);

    if (antwort.ok) {
      try {
        const roh = JSON.parse(text);
        const inhalt = roh.choices?.[0]?.message?.content ?? "";
        return JSON.parse(String(inhalt).replace(/^```json\s*|```\s*$/g, "").trim());
      } catch (fehler) {
        if (versuch >= 3) throw new ModellKontingentErschoepft(`Ungültige Antwort: ${fehler.message}`);
        await warte(2_000 * versuch);
        continue;
      }
    }

    if (antwort.status === 429) {
      folge429++;
      /* WAS 429 HIER WIRKLICH HEISST. Die Freistufe begrenzt zweierlei:
         Anfragen pro Minute und pro Tag. Beides antwortet mit 429 und
         derselben Meldung („You exceeded your current quota"). Die bisherige
         Regel — zwei 429 hintereinander gelten als Tagesende — hielt die
         MINUTENgrenze für das Tagesende und beendete den Lauf nach 24
         Aufrufen, obwohl eine Minute Warten gereicht hätte.

         Gewartet wird jetzt ansteigend: 30 s, 90 s, 240 s. Erst wenn auch vier
         Minuten nichts ändern, ist es keine Minutengrenze mehr — dann gilt
         DIESES Modell als erschöpft und der Aufrufer nimmt das nächste. Die
         Freistufe zählt je Modell getrennt. */
      const stufen = [30_000, 90_000, 240_000];
      const warten = Number(antwort.headers.get("retry-after") || 0) * 1_000
        || stufen[folge429 - 1];
      if (!warten) {
        ERSCHOEPFT.add(modell);
        throw new ModellPauseNoetig(modell,
          `${modell}: Kontingent erschöpft, auch nach vier Minuten Pause (HTTP 429). ${text.slice(0, 120)}`);
      }
      await warte(warten);
      continue;
    }
    /* 404 ist NICHT „Kontingent erschöpft" und NICHT „Schlüssel falsch".
       Ein ungültiger Schlüssel antwortet mit 400 oder 403. 404 heißt: Diesen
       Modellnamen gibt es unter dieser API-Fassung nicht — meist, weil Google
       ihn zurückgezogen hat. Die alte Meldung sprach von Kontingent und
       schickte damit in die falsche Richtung. */
    if (antwort.status === 404) {
      throw new ModellNichtVorhanden(
        `Modell „${modell}" gibt es unter dieser API-Fassung nicht (HTTP 404). `
        + "Das liegt nicht am Schlüssel — ein ungültiger antwortet mit 400 oder 403. "
        + "Verfügbare Modelle zeigt: node tools/modelle-zeigen.mjs. "
        + text.slice(0, 150),
      );
    }
    if ((antwort.status === 400 || antwort.status === 422) && body.response_format) {
      /* Abwärts über die Stufen: json_schema → json_object → gar keine Vorgabe.
         Vorher wurde immer nur auf `json_object` gesetzt; war auch das nicht
         genehm, schickte die Schleife viermal denselben abgelehnten Aufruf.
         Das fällt erst bei einem anderen Anbieter auf — Google trägt beide. */
      if (body.response_format.type === "json_schema") body.response_format = { type: "json_object" };
      else delete body.response_format;
      continue;
    }
    throw new ModellKontingentErschoepft(`HTTP ${antwort.status}: ${text.slice(0, 200)}`);
  }
  throw new ModellKontingentErschoepft("Alle Versuche erschöpft");
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Belege auf ein promptfreundliches Maß bringen. */
function belegeFuerPrompt(belege) {
  if (!belege) return null;
  const verwaltung = (belege.verwaltung || []).slice(0, 3).map((b) => ({
    fundstelle: b.fundstelle, quelle: b.quelle, text: String(b.text || "").slice(0, 1_800),
  }));
  const leitsaetze = (belege.rechtsprechung || []).filter((e) => e.leitsatz).slice(0, 4).map((e) => ({
    fundstelle: [e.gericht, e.az, e.datum].filter(Boolean).join(" "), text: e.leitsatz,
  }));
  if (!verwaltung.length && !leitsaetze.length) return null;
  return { verwaltungsauffassung: verwaltung, leitsaetze };
}

/* ─────────────────────────── Öffentliche API ─────────────────────────── */

/**
 * Analysiert eine Norm k-mal unabhängig.
 * @returns {Array} k Antworten der Form { saetze: [...] }
 */
export async function extrahiereMehrfach({ gesetz, norm, einheiten, vorschlag, belege, modelle, laeufe, token, budget }) {
  const nutzer = JSON.stringify({
    gesetz: { abk: gesetz.abk, titel: gesetz.titel },
    norm: { enbez: norm.enbez, titel: norm.titel, gegenstand: gesetz.titel },
    rechtssaetze: einheiten.map((e) => ({ pfad: e.pfad, text: e.text })),
    syntaktischer_vorschlag: vorschlag,
    belege: belegeFuerPrompt(belege),
    aufgabe: "Prüfe den syntaktischen Vorschlag gegen die Belegstellen und korrigiere ihn, wo er falsch liegt. Übernimm ihn nicht ungeprüft.",
  });

  const antworten = [];
  /* Reihum über die Modelle, erschöpfte übersprungen. Steht eines am
     Kontingent, ist der Tag nicht vorbei — die Freistufe zählt je Modell. */
  const offen = () => modelle.filter((m) => !ERSCHOEPFT.has(m));
  for (let i = 0; i < laeufe; i++) {
    const verfuegbar = offen();
    if (!verfuegbar.length) {
      if (antworten.length) break;
      throw new ModellTageslimitErschoepft(
        `Alle Modelle am Kontingent: ${modelle.join(", ")}. Der Lauf setzt am nächsten Tag fort.`);
    }
    const modell = verfuegbar[i % verfuegbar.length];
    const temperatur = i === 0 ? 0 : 0.35;
    try {
      antworten.push(await einAufruf({
        system: SYSTEM_EXTRAKTION, nutzer, schema: SCHEMA_EXTRAKTION,
        modell, temperatur, token, budget,
      }));
    } catch (fehler) {
      /* Ein erschöpftes Modell kostet einen Durchgang, nicht den Lauf: Der
         Zähler geht zurück, damit derselbe Durchgang mit dem nächsten Modell
         wiederholt wird. */
      if (fehler instanceof ModellPauseNoetig){ i--; continue; }
      if (fehler instanceof ModellBudgetErschoepft) throw fehler;
      if (antworten.length === 0) throw fehler;
      break; // mit weniger Läufen weiterarbeiten, Konfidenz sinkt entsprechend
    }
  }
  return antworten;
}

/**
 * Gegenprobe: kategorisiert vorgelegte Spannen ohne Kenntnis der ersten Begründung.
 * @returns {Map<number,string>} Index → art
 */
export async function gegenprobe({ satztext, spannen, modell, modelle, token, budget }) {
  if (!spannen.length) return new Map();
  const nutzer = JSON.stringify({
    rechtssatz: satztext,
    ausschnitte: spannen.map((s, i) => ({ i, text: s.text })),
  });

  /* Dieselbe Rotation wie im Mehrfachlauf: Ein Modell am Kontingent kostet die
     Gegenprobe nicht, solange ein anderes antwortet. */
  const kette = (modelle && modelle.length ? modelle : [modell])
    .filter((m) => m && !ERSCHOEPFT.has(m));
  if (!kette.length) throw new ModellTageslimitErschoepft("Alle Modelle am Kontingent.");

  let letzter = null;
  for (const m of kette) {
    try {
      const antwort = await einAufruf({
        system: SYSTEM_GEGENPROBE, nutzer, schema: SCHEMA_GEGENPROBE,
        modell: m, temperatur: 0, token, budget,
      });
      return new Map((antwort.urteile || []).map((u) => [u.i, u.art]));
    } catch (fehler) {
      if (!(fehler instanceof ModellPauseNoetig)) throw fehler;
      letzter = fehler;
    }
  }
  throw letzter || new ModellTageslimitErschoepft("Alle Modelle am Kontingent.");
}
