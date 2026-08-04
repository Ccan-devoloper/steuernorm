#!/usr/bin/env node
import fs from "node:fs";

const pfad = "index.html";
let html = fs.readFileSync(pfad, "utf8");

const link = '    <a class="faelle-link" href="faelle.html">Fälle &amp; Lösungen</a>\n';
if (!html.includes('href="faelle.html"')) {
  const marke = '    <span class="marke">steuernorm<small>Textausgabe</small></span>\n';
  if (!html.includes(marke)) throw new Error("Markenanker in index.html nicht gefunden");
  html = html.replace(marke, marke + link);
}

if (!html.includes(".faelle-link{")) {
  const marker = "  .suchfeld{flex:1 1 200px;min-width:140px;border:0;border-bottom:1px solid var(--linie);\n";
  if (!html.includes(marker)) throw new Error("CSS-Anker in index.html nicht gefunden");
  const css =
    '  .faelle-link{border:1px solid var(--linie);border-radius:999px;text-decoration:none;padding:5px 11px;\\n' +
    '    font-size:12px;color:var(--gedeckt);white-space:nowrap}\\n' +
    '  .faelle-link:hover{border-color:var(--linie-stark);color:var(--tinte)}\\n';
  html = html.replace(marker, css + marker);
}

fs.writeFileSync(pfad, html);
console.log("index.html: Link zur Fallsammlung eingebaut.");
