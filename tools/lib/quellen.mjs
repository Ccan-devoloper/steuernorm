import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dekodiere, eindeutig } from "./text.mjs";

const SEITEN_CACHE = new Map();

function kanonischeUrl(url) {
  const u = new URL(url);
  u.hash = "";
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  return u.toString();
}

function stripHtml(html) {
  return dekodiere(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

async function laden(url, versuch = 1) {
  const key = kanonischeUrl(url);
  if (SEITEN_CACHE.has(key)) return SEITEN_CACHE.get(key);

  const arbeit = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const antwort = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "steuernorm-ki-annotation/2.0 (+https://github.com/Ccan-devoloper/steuernorm)",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
        },
      });
      if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
      return await antwort.text();
    } catch (fehler) {
      if (versuch < 3) {
        await new Promise((resolve) => setTimeout(resolve, 800 * versuch));
        return laden(url, versuch + 1);
      }
      throw fehler;
    } finally {
      clearTimeout(timer);
    }
  })();

  SEITEN_CACHE.set(key, arbeit);
  try {
    return await arbeit;
  } catch (fehler) {
    SEITEN_CACHE.delete(key);
    throw fehler;
  }
}

function token(text) {
  return (text.toLowerCase().match(/[a-zäöüß]{4,}/g) || []).slice(0, 10);
}

function ausschnitt(text, abk, titel) {
  const normal = text.replace(/\s+/g, " ");
  const teile = [];
  for (const wort of [abk, ...token(titel)]) {
    let start = 0;
    for (let i = 0; i < 3; i++) {
      const position = normal.toLowerCase().indexOf(String(wort).toLowerCase(), start);
      if (position < 0) break;
      teile.push(normal.slice(Math.max(0, position - 500), Math.min(normal.length, position + 1100)));
      start = position + String(wort).length;
    }
  }
  if (!teile.length) teile.push(normal.slice(0, 2500));
  return eindeutig(teile).join("\n…\n").slice(0, 7000);
}

export async function ladeQuellen(config, gesetz, wurzel) {
  const cacheOrdner = path.join(wurzel, ".cache", "quellen");
  await mkdir(cacheOrdner, { recursive: true });

  const fach = config.gesetze[gesetz.abk];
  if (!fach) throw new Error(`Keine Quellenkonfiguration für ${gesetz.abk}`);

  const offiziell = {
    id: "amtlicher-text",
    typ: "gesetz",
    herausgeber: "Bundesministerium der Justiz / Bundesamt für Justiz; XML-Spiegel: QuantLaw",
    titel: `${gesetz.titel} – amtlicher Normtext`,
    url: `https://www.gesetze-im-internet.de/${fach.slug}/`,
    erreichbar: true,
    gewicht: 1,
    ausschnitt: `${gesetz.abk}: ${gesetz.titel}. Die im Analyseauftrag enthaltenen Normtexte stammen aus dieser Referenz.`,
  };

  const kandidaten = [...config.gemeinsame_quellen, fach.fachquelle].filter(Boolean);
  const gesehen = new Set([kanonischeUrl(offiziell.url)]);
  const liste = [];
  for (const quelle of kandidaten) {
    const key = kanonischeUrl(quelle.url);
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    liste.push({ ...quelle, url: key });
  }

  const ergebnis = [offiziell];
  for (const quelle of liste) {
    try {
      const seite = stripHtml(await laden(quelle.url));
      if (seite.length < 80) throw new Error("kein auswertbarer Text");
      ergebnis.push({
        ...quelle,
        erreichbar: true,
        ausschnitt: ausschnitt(seite, gesetz.abk, gesetz.titel),
      });
    } catch (fehler) {
      console.warn(`Quelle nicht erreichbar ${gesetz.abk}/${quelle.id}: ${fehler.message}`);
      ergebnis.push({ ...quelle, erreichbar: false, fehler: fehler.message, ausschnitt: "" });
    }
  }

  await writeFile(
    path.join(cacheOrdner, `${gesetz.abk.toLowerCase()}.json`),
    JSON.stringify({ geladen: new Date().toISOString(), quellen: ergebnis }, null, 2),
  );
  return ergebnis;
}
