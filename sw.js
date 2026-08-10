/**
 * sw.js — Offlinezugriff.
 *
 * Die Gesetzestexte liegen als statische JSON-Dateien vor; das Frontend lädt
 * sie über `fetch`. Ohne Netz war die Seite bisher vollständig unbenutzbar,
 * obwohl sich der Bestand seit dem letzten Besuch nicht geändert hat.
 *
 * ES WIRD NICHT ALLES VORAB GELADEN. Der Gesamtbestand umfasst rund 30 MB
 * Annotationen (allein `estg.json` gut 9 MB). Sie beim ersten Aufruf über eine
 * Mobilverbindung zu ziehen, wäre eine Zumutung und würde den Speicher vieler
 * Geräte sprengen. Vorab kommt deshalb nur das Gerüst; jedes Gesetz wird beim
 * ersten Lesen abgelegt und ist danach offline verfügbar.
 *
 * Strategie je Art der Anfrage:
 *
 *   Seitenaufruf   Netz zuerst, sonst die abgelegte Seite.
 *   Daten (JSON)   Ablage zuerst, im Hintergrund erneuern
 *                  („stale-while-revalidate"). Der Leser wartet nie auf das
 *                  Netz; die nächste Ansicht hat den frischen Stand. Für
 *                  Gesetzestexte, die sich täglich höchstens einmal ändern,
 *                  ist das der richtige Tausch.
 *
 * Die Fassung im Namen der Ablage ist der Schalter: Wird sie erhöht, räumt
 * `activate` alle älteren Ablagen weg.
 */

const FASSUNG = "steuernorm-v7-arbeitsplatz";
const GERUEST = `${FASSUNG}-geruest`;
const INHALTE = `${FASSUNG}-inhalte`;

/* Das Nötigste, um überhaupt etwas anzuzeigen. Alles Weitere kommt beim Lesen. */
const GRUNDBESTAND = [
  "./",
  "./index.html",
  "./schriften/schriften.css",
  "./data/index.json",
  "./data/verweise.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const ablage = await caches.open(GERUEST);
    // Einzeln statt addAll: Ein fehlender Eintrag darf die Einrichtung nicht
    // scheitern lassen — sonst bleibt gar nichts abgelegt.
    await Promise.all(GRUNDBESTAND.map(async (pfad) => {
      try { await ablage.add(new Request(pfad, { cache: "reload" })); }
      catch (fehler) { /* diese Datei eben nicht */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen
      .filter((n) => n.startsWith("steuernorm-") && n !== GERUEST && n !== INHALTE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/** Gesetzestexte und Annotationen — alles, was beim Lesen nachgeladen wird. */
function istInhalt(url) {
  return /\/(data|annotations|belege|struktur|verwaltung)\/[^/]+\.json$/.test(url.pathname)
    || /\/schriften\/[^/]+\.(woff2|css)$/.test(url.pathname);
}

self.addEventListener("fetch", (e) => {
  const anfrage = e.request;
  if (anfrage.method !== "GET") return;

  const url = new URL(anfrage.url);
  // Fremde Herkunft (etwa der Link auf gesetze-im-internet.de) bleibt unberührt.
  if (url.origin !== self.location.origin) return;

  if (anfrage.mode === "navigate") {
    e.respondWith((async () => {
      try {
        return await fetch(anfrage);
      } catch (fehler) {
        const ablage = await caches.open(GERUEST);
        return (await ablage.match("./index.html"))
          || (await ablage.match("./"))
          || new Response("Offline und keine abgelegte Fassung vorhanden.", {
            status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
      }
    })());
    return;
  }

  if (!istInhalt(url)) return;

  e.respondWith((async () => {
    const ablage = await caches.open(INHALTE);
    const abgelegt = await ablage.match(anfrage);

    const ausDemNetz = fetch(anfrage).then((antwort) => {
      if (antwort && antwort.ok) ablage.put(anfrage, antwort.clone());
      return antwort;
    }).catch(() => null);

    // Liegt etwas vor, wird es sofort ausgeliefert; die Erneuerung läuft weiter.
    if (abgelegt) {
      e.waitUntil(ausDemNetz);
      return abgelegt;
    }
    const frisch = await ausDemNetz;
    return frisch || new Response(JSON.stringify({ fehler: "offline" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  })());
});
