/**
 * Erzeugt die kuratierten Annotationen unter annotations/.
 * Getrennt vom Gesetzestext, damit die Aktualisierung der Texte
 * die Markierungen nicht überschreibt.
 *
 * tb = Tatbestandsmerkmal, rf = Rechtsfolge.
 * Die Zeichenketten müssen wörtlich im amtlichen Text vorkommen und
 * dürfen keine Satzgrenze überschreiten. tools/pruefen.mjs meldet Treffer.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ZIEL = path.join(path.resolve(import.meta.dirname, ".."), "annotations");

const A = {};

A.EStG = {
  "1": {
    tb: ["Natürliche Personen, die im Inland einen Wohnsitz oder ihren gewöhnlichen Aufenthalt haben"],
    rf: ["sind unbeschränkt einkommensteuerpflichtig"],
    hinweis:
      "Wohnsitz und gewöhnlicher Aufenthalt sind in §§ 8, 9 AO definiert. Unbeschränkte Steuerpflicht heißt Welteinkommensprinzip; korrigiert wird erst über die Doppelbesteuerungsabkommen.",
    schema: [
      { n: "I.", t: "Natürliche Person", art: "tb", sub: ["Keine Körperschaft, sonst KStG", "Beginn mit Geburt, Ende mit Tod"] },
      { n: "II.", t: "Wohnsitz (§ 8 AO) oder gewöhnlicher Aufenthalt (§ 9 AO)", art: "tb", sub: ["Wohnung innehaben unter Umständen, die auf Beibehalten schließen lassen", "Gewöhnlicher Aufenthalt: mehr als sechs Monate zusammenhängend"] },
      { n: "III.", t: "Belegenheit im Inland (§ 1 Abs. 1 Satz 2)", art: "tb" },
      { n: "IV.", t: "Ergebnis: unbeschränkte Steuerpflicht", art: "rf", sub: ["Welteinkommen unterliegt der Einkommensteuer", "Sonst Prüfung von § 1 Abs. 4 i. V. m. § 49"] },
    ],
  },
  "2": {
    tb: ["während seiner unbeschränkten Einkommensteuerpflicht", "Einkünfte aus Gewerbebetrieb", "Einkünfte aus nichtselbständiger Arbeit"],
    rf: ["Der Einkommensteuer unterliegen"],
    hinweis:
      "§ 2 gibt das Ermittlungsschema vor: Einkünfte je Einkunftsart, Summe der Einkünfte, Gesamtbetrag der Einkünfte, Einkommen, zu versteuerndes Einkommen. Fehlt eine Einkunftsart, ist der Zufluss nicht steuerbar.",
    schema: [
      { n: "I.", t: "Zuordnung zu einer der sieben Einkunftsarten", art: "tb", sub: ["Gewinneinkünfte: §§ 13, 15, 18", "Überschusseinkünfte: §§ 19, 20, 21, 22", "Ohne Einkunftsart keine Steuerbarkeit"] },
      { n: "II.", t: "Einkünfteermittlung", art: "tb", sub: ["Gewinn nach §§ 4 ff.", "Überschuss der Einnahmen über die Werbungskosten, §§ 8, 9"] },
      { n: "III.", t: "Summe und Gesamtbetrag der Einkünfte", art: "rf", sub: ["Altersentlastungsbetrag, Entlastungsbetrag für Alleinerziehende"] },
      { n: "IV.", t: "Einkommen", art: "rf", sub: ["Abzug von Sonderausgaben (§§ 10 ff.) und außergewöhnlichen Belastungen (§§ 33 ff.)"] },
      { n: "V.", t: "Zu versteuerndes Einkommen als Bemessungsgrundlage", art: "rf", sub: ["Freibeträge nach § 32", "Tarif § 32a"] },
    ],
  },
  "4": {
    tb: ["Aufwendungen, die durch den Betrieb veranlasst sind"],
    rf: ["Betriebsausgaben sind die Aufwendungen"],
    hinweis:
      "Die Veranlassung wird wertend bestimmt; maßgeblich ist der auslösende Moment. Bei gemischten Aufwendungen Aufteilung nach objektivierbaren Kriterien. Abzugsverbote in § 4 Abs. 5 und § 12.",
    schema: [
      { n: "I.", t: "Aufwendung: Abfluss von Gütern in Geld oder Geldeswert", art: "tb" },
      { n: "II.", t: "Betriebliche Veranlassung", art: "tb", sub: ["Objektiver Zusammenhang mit dem Betrieb", "Subjektiv Förderung des Betriebs", "Gemischte Veranlassung: Aufteilung, sonst Abzugsverbot"] },
      { n: "III.", t: "Kein Abzugsverbot", art: "tb", sub: ["§ 4 Abs. 5: Geschenke, Bewirtung, Gästehäuser", "§ 4h Zinsschranke, § 12 EStG"] },
      { n: "IV.", t: "Ergebnis: Gewinnminderung", art: "rf", sub: ["Zeitpunkt nach § 4 Abs. 3 i. V. m. § 11 oder nach Bilanzrecht"] },
    ],
  },
  "9": {
    tb: ["Aufwendungen zur Erwerbung, Sicherung und Erhaltung der Einnahmen"],
    rf: ["Werbungskosten sind"],
    hinweis:
      "Werbungskosten und Betriebsausgaben werden nach ständiger Rechtsprechung gleich ausgelegt (Veranlassungsprinzip). Die Abgrenzung zur privaten Lebensführung erfolgt über § 12 Nr. 1.",
    schema: [
      { n: "I.", t: "Aufwendung", art: "tb" },
      { n: "II.", t: "Veranlassung durch eine Überschusseinkunftsart", art: "tb", sub: ["Zusammenhang mit §§ 19, 20, 21, 22", "Vorweggenommen und nachträglich möglich"] },
      { n: "III.", t: "Keine Kosten der privaten Lebensführung (§ 12 Nr. 1)", art: "tb" },
      { n: "IV.", t: "Ergebnis: Abzug bei der jeweiligen Einkunftsart", art: "rf", sub: ["Sonst Pauschbetrag nach § 9a"] },
    ],
  },
  "15": {
    tb: [
      "selbständige nachhaltige Betätigung",
      "mit der Absicht, Gewinn zu erzielen",
      "Beteiligung am allgemeinen wirtschaftlichen Verkehr",
      "weder als Ausübung von Land- und Forstwirtschaft noch als Ausübung eines freien Berufs noch als eine andere selbständige Arbeit anzusehen ist",
    ],
    rf: ["ist Gewerbebetrieb"],
    hinweis:
      "Ungeschriebenes negatives Merkmal: Überschreiten der privaten Vermögensverwaltung. Hauptfälle sind der gewerbliche Grundstückshandel (Drei-Objekt-Grenze) und der gewerbliche Wertpapierhandel.",
    schema: [
      { n: "I.", t: "Selbständigkeit", art: "tb", sub: ["Unternehmerrisiko und Unternehmerinitiative", "Abgrenzung zu § 19 über die Weisungsgebundenheit"] },
      { n: "II.", t: "Nachhaltigkeit", art: "tb", sub: ["Wiederholungsabsicht genügt"] },
      { n: "III.", t: "Gewinnerzielungsabsicht", art: "tb", sub: ["Streben nach Totalgewinn", "Fehlt sie: Liebhaberei, keine Einkunftsart"] },
      { n: "IV.", t: "Beteiligung am allgemeinen wirtschaftlichen Verkehr", art: "tb", sub: ["Leistungsangebot an einen unbestimmten Personenkreis"] },
      { n: "V.", t: "Negativabgrenzung", art: "tb", sub: ["Keine Land- und Forstwirtschaft (§ 13)", "Kein freier Beruf, keine selbständige Arbeit (§ 18)", "Ungeschrieben: keine private Vermögensverwaltung"] },
      { n: "VI.", t: "Ergebnis: Einkünfte aus Gewerbebetrieb", art: "rf", sub: ["Gewinnermittlung §§ 4 ff.", "Zusätzlich Gewerbesteuerpflicht nach § 2 GewStG"] },
    ],
  },
  "19": {
    tb: ["Gehälter, Löhne, Gratifikationen, Tantiemen und andere Bezüge und Vorteile"],
    rf: ["Zu den Einkünften aus nichtselbständiger Arbeit gehören"],
    hinweis:
      "Arbeitslohn ist jeder Vorteil, der durch das Dienstverhältnis veranlasst ist. Abgrenzung zur Selbständigkeit über Weisungsgebundenheit und Eingliederung; Leistungen im ganz überwiegend eigenbetrieblichen Interesse sind kein Arbeitslohn.",
    schema: [
      { n: "I.", t: "Dienstverhältnis", art: "tb", sub: ["Weisungsgebundenheit, Eingliederung, kein Unternehmerrisiko (§ 1 LStDV)"] },
      { n: "II.", t: "Zufluss eines Vorteils in Geld oder Geldeswert (§ 8)", art: "tb" },
      { n: "III.", t: "Veranlassung durch das Dienstverhältnis", art: "tb", sub: ["Kein ganz überwiegend eigenbetriebliches Interesse des Arbeitgebers", "Keine Steuerbefreiung nach § 3"] },
      { n: "IV.", t: "Ergebnis: Einkünfte aus nichtselbständiger Arbeit", art: "rf", sub: ["Erhebung im Abzugsweg, §§ 38 ff.", "Werbungskosten § 9, mindestens Pauschbetrag § 9a"] },
    ],
  },
  "21": {
    tb: ["Vermietung und Verpachtung von unbeweglichem Vermögen"],
    rf: ["Einkünfte aus Vermietung und Verpachtung sind"],
    hinweis:
      "Bei auf Dauer angelegter Vermietung von Wohnraum wird die Einkünfteerzielungsabsicht typisierend unterstellt. Subsidiarität nach § 21 Abs. 3: Zugehörigkeit zu einer anderen Einkunftsart geht vor.",
    schema: [
      { n: "I.", t: "Überlassung zur Nutzung gegen Entgelt", art: "tb", sub: ["Unbewegliches Vermögen, Sachinbegriffe, Rechte, Forderungen"] },
      { n: "II.", t: "Einkünfteerzielungsabsicht", art: "tb", sub: ["Bei Dauervermietung von Wohnraum typisierend unterstellt", "Prüfung bei Ferienwohnungen und verbilligter Überlassung (§ 21 Abs. 2)"] },
      { n: "III.", t: "Keine vorrangige Einkunftsart (§ 21 Abs. 3)", art: "tb" },
      { n: "IV.", t: "Ergebnis: Überschusseinkünfte", art: "rf", sub: ["Werbungskosten einschließlich AfA (§ 7)", "Zufluss- und Abflussprinzip § 11"] },
    ],
  },
  "23": {
    tb: ["bei denen der Zeitraum zwischen Anschaffung und Veräußerung nicht mehr als zehn Jahre beträgt"],
    rf: ["Private Veräußerungsgeschäfte"],
    hinweis:
      "Maßgeblich sind die obligatorischen Verpflichtungsgeschäfte, nicht Auflassung oder Grundbucheintragung. Ausgenommen sind zu eigenen Wohnzwecken genutzte Objekte; die Freigrenze steht in § 23 Abs. 3.",
    schema: [
      { n: "I.", t: "Wirtschaftsgut im Privatvermögen", art: "tb", sub: ["Vorrang der §§ 13, 15, 18 und des § 20 Abs. 2"] },
      { n: "II.", t: "Anschaffung und Veräußerung", art: "tb", sub: ["Entgeltlicher Erwerb und entgeltliche Übertragung", "Bei unentgeltlichem Erwerb Zurechnung nach § 23 Abs. 1 Satz 3"] },
      { n: "III.", t: "Fristwahrung", art: "tb", sub: ["Grundstücke: zehn Jahre", "Andere Wirtschaftsgüter: ein Jahr", "Stichtag ist jeweils das schuldrechtliche Geschäft"] },
      { n: "IV.", t: "Keine Ausnahme wegen Nutzung zu eigenen Wohnzwecken", art: "tb" },
      { n: "V.", t: "Ergebnis: sonstige Einkünfte nach § 22 Nr. 2", art: "rf", sub: ["Ermittlung nach § 23 Abs. 3", "Freigrenze und beschränkte Verlustverrechnung beachten"] },
    ],
  },
};

A.UStG = {
  "1": {
    tb: [
      "die Lieferungen und sonstigen Leistungen, die ein Unternehmer im Inland gegen Entgelt im Rahmen seines Unternehmens ausführt",
      "die Einfuhr von Gegenständen im Inland",
      "der innergemeinschaftliche Erwerb im Inland gegen Entgelt",
    ],
    rf: ["Der Umsatzsteuer unterliegen die folgenden Umsätze"],
    hinweis:
      "Fünf Merkmale, die in der Klausur nacheinander abzuarbeiten sind. Erst danach folgen Steuerbefreiung (§ 4), Bemessungsgrundlage (§ 10), Steuersatz (§ 12) und Entstehung (§ 13).",
    schema: [
      { n: "I.", t: "Lieferung oder sonstige Leistung", art: "tb", sub: ["Lieferung: Verschaffung der Verfügungsmacht (§ 3 Abs. 1)", "Sonstige Leistung: alles Übrige (§ 3 Abs. 9)"] },
      { n: "II.", t: "Unternehmer", art: "tb", sub: ["§ 2 Abs. 1: selbständig, nachhaltig, Einnahmeerzielungsabsicht"] },
      { n: "III.", t: "Im Rahmen des Unternehmens", art: "tb", sub: ["Abgrenzung zur Privatsphäre", "Sonst unentgeltliche Wertabgabe, § 3 Abs. 1b, Abs. 9a"] },
      { n: "IV.", t: "Im Inland", art: "tb", sub: ["Ort der Lieferung §§ 3 Abs. 5a bis 8", "Ort der sonstigen Leistung §§ 3a, 3b, 3e, 3g"] },
      { n: "V.", t: "Gegen Entgelt", art: "tb", sub: ["Leistungsaustausch: unmittelbarer Zusammenhang zwischen Leistung und Gegenleistung", "Kein Entgelt bei echtem Schadensersatz oder echtem Zuschuss"] },
      { n: "VI.", t: "Ergebnis: steuerbarer Umsatz", art: "rf", sub: ["Anschluss: steuerpflichtig oder nach § 4 befreit"] },
    ],
  },
  "2": {
    tb: ["wer eine gewerbliche oder berufliche Tätigkeit selbstständig ausübt", "jede nachhaltige Tätigkeit zur Erzielung von Einnahmen"],
    rf: ["Unternehmer ist"],
    hinweis:
      "Der umsatzsteuerliche Unternehmerbegriff ist weiter als der ertragsteuerliche Gewerbebetrieb: Gewinnerzielungsabsicht ist gerade nicht erforderlich, Einnahmeerzielungsabsicht genügt.",
    schema: [
      { n: "I.", t: "Selbständigkeit", art: "tb", sub: ["Negativabgrenzung § 2 Abs. 2 Nr. 1 für Arbeitnehmer", "Organschaft § 2 Abs. 2 Nr. 2"] },
      { n: "II.", t: "Nachhaltigkeit", art: "tb", sub: ["Wiederholte Tätigkeit oder Wiederholungsabsicht", "Gesamtbild der Verhältnisse"] },
      { n: "III.", t: "Einnahmeerzielungsabsicht", art: "tb", sub: ["Gewinnerzielungsabsicht ausdrücklich entbehrlich"] },
      { n: "IV.", t: "Ergebnis: Unternehmereigenschaft", art: "rf", sub: ["Steuerbarkeit der Ausgangsumsätze", "Berechtigung zum Vorsteuerabzug nach § 15"] },
    ],
  },
  "15": {
    tb: ["die gesetzlich geschuldete Steuer für Lieferungen und sonstige Leistungen, die von einem anderen Unternehmer für sein Unternehmen ausgeführt worden sind"],
    rf: ["Der Unternehmer kann die folgenden Vorsteuerbeträge abziehen"],
    hinweis:
      "Der Abzug ist ausgeschlossen, soweit die Eingangsleistung für steuerfreie Ausgangsumsätze verwendet wird (§ 15 Abs. 2), es sei denn, § 15 Abs. 3 greift ein. Spätere Nutzungsänderung führt zur Berichtigung nach § 15a.",
    schema: [
      { n: "I.", t: "Unternehmereigenschaft des Leistungsempfängers", art: "tb" },
      { n: "II.", t: "Leistung eines anderen Unternehmers für das Unternehmen", art: "tb", sub: ["Zuordnungsentscheidung bei gemischt genutzten Gegenständen", "Mindestens zehn Prozent unternehmerische Nutzung"] },
      { n: "III.", t: "Gesetzlich geschuldete Steuer", art: "tb", sub: ["Kein Abzug bei unrichtigem Steuerausweis, § 14c Abs. 1"] },
      { n: "IV.", t: "Ordnungsgemäße Rechnung (§§ 14, 14a)", art: "tb", sub: ["Pflichtangaben § 14 Abs. 4"] },
      { n: "V.", t: "Kein Ausschluss nach § 15 Abs. 2", art: "tb", sub: ["Rückausnahme § 15 Abs. 3", "Bei teilweiser Verwendung Aufteilung nach § 15 Abs. 4"] },
      { n: "VI.", t: "Ergebnis: Abzug im Besteuerungszeitraum des Leistungsbezugs", art: "rf" },
    ],
  },
};

A.AO = {
  "8": {
    tb: ["wo er eine Wohnung unter Umständen innehat, die darauf schließen lassen, dass er die Wohnung beibehalten und benutzen wird"],
    rf: ["Einen Wohnsitz hat jemand dort"],
    hinweis:
      "Rein objektiver Begriff: es kommt auf die tatsächlichen Verhältnisse an, nicht auf den Willen oder die melderechtliche Anmeldung. Mehrere Wohnsitze sind möglich.",
    schema: [
      { n: "I.", t: "Wohnung: zum Wohnen geeignete Räume", art: "tb", sub: ["Bescheidene Ausstattung genügt, kein Mittelpunkt der Lebensinteressen nötig"] },
      { n: "II.", t: "Innehaben: tatsächliche Verfügungsmacht", art: "tb" },
      { n: "III.", t: "Umstände, die auf Beibehalten und Benutzen schließen lassen", art: "tb", sub: ["Regelmäßige Nutzung, nicht nur gelegentliche Besuche"] },
      { n: "IV.", t: "Ergebnis: Wohnsitz im Sinne der Steuergesetze", art: "rf", sub: ["Anknüpfung für § 1 Abs. 1 EStG, § 19 AO"] },
    ],
  },
  "38": {
    tb: ["sobald der Tatbestand verwirklicht ist, an den das Gesetz die Leistungspflicht knüpft"],
    rf: ["Die Ansprüche aus dem Steuerschuldverhältnis entstehen"],
    hinweis:
      "Entstehung (§ 38), Festsetzung (§ 155) und Fälligkeit (§ 220) trennen. Der Steuerbescheid setzt den Anspruch nur fest, er begründet ihn nicht.",
    schema: [
      { n: "I.", t: "Anspruch aus dem Steuerschuldverhältnis (§ 37 Abs. 1)", art: "tb", sub: ["Steueranspruch, Haftungsanspruch, Erstattungsanspruch"] },
      { n: "II.", t: "Verwirklichung des gesetzlichen Tatbestands", art: "tb", sub: ["Einkommensteuer: Ablauf des Veranlagungszeitraums, § 36 Abs. 1 EStG", "Umsatzsteuer: Ablauf des Voranmeldungszeitraums, § 13 UStG"] },
      { n: "III.", t: "Ergebnis: Anspruch entsteht kraft Gesetzes", art: "rf", sub: ["Unabhängig von der Kenntnis der Finanzbehörde", "Anknüpfungspunkt für § 170 Abs. 1"] },
    ],
  },
  "42": {
    tb: ["wenn eine unangemessene rechtliche Gestaltung gewählt wird", "die beim Steuerpflichtigen oder einem Dritten im Vergleich zu einer angemessenen Gestaltung zu einem gesetzlich nicht vorgesehenen Steuervorteil führt"],
    rf: ["so, wie er bei einer den wirtschaftlichen Vorgängen angemessenen rechtlichen Gestaltung entsteht"],
    hinweis:
      "§ 42 ist subsidiär: speziellere Missbrauchsvorschriften gehen vor (§ 42 Abs. 1 Satz 2). Die bloße Wahl des steuergünstigeren Weges ist noch kein Missbrauch.",
    schema: [
      { n: "I.", t: "Kein Vorrang einer Spezialvorschrift", art: "tb" },
      { n: "II.", t: "Unangemessene Gestaltung", art: "tb", sub: ["Umständlich, kompliziert, gekünstelt", "Ein verständiger Dritter würde sie ohne Steuervorteil nicht wählen"] },
      { n: "III.", t: "Gesetzlich nicht vorgesehener Steuervorteil", art: "tb" },
      { n: "IV.", t: "Keine beachtlichen außersteuerlichen Gründe", art: "tb", sub: ["Nachweislast beim Steuerpflichtigen"] },
      { n: "V.", t: "Ergebnis: Besteuerung nach der angemessenen Gestaltung", art: "rf" },
    ],
  },
  "169": {
    tb: ["soweit eine Steuer hinterzogen", "soweit sie leichtfertig verkürzt worden ist"],
    rf: ["Eine Steuerfestsetzung sowie ihre Aufhebung oder Änderung sind nicht mehr zulässig, wenn die Festsetzungsfrist abgelaufen ist"],
    hinweis:
      "Immer im Dreischritt prüfen: Beginn (§ 170, regelmäßig mit Anlaufhemmung), Dauer (§ 169 Abs. 2), Ablaufhemmung (§ 171). Nach Fristablauf erlöschen die Ansprüche, § 47.",
    schema: [
      { n: "I.", t: "Fristbeginn (§ 170)", art: "tb", sub: ["Grundsatz: Ablauf des Entstehungsjahres", "Anlaufhemmung bis zur Abgabe der Erklärung, längstens drei Jahre"] },
      { n: "II.", t: "Fristdauer (§ 169 Abs. 2)", art: "tb", sub: ["Regelfall vier Jahre", "Zehn Jahre bei Hinterziehung, fünf bei leichtfertiger Verkürzung"] },
      { n: "III.", t: "Ablaufhemmung (§ 171)", art: "tb", sub: ["Außenprüfung Abs. 4, Einspruch Abs. 3a, Steuerstrafverfahren Abs. 5"] },
      { n: "IV.", t: "Ergebnis: Festsetzung zulässig oder ausgeschlossen", art: "rf" },
    ],
  },
  "173": {
    tb: ["soweit Tatsachen oder Beweismittel nachträglich bekannt werden, die zu einer höheren Steuer führen", "kein grobes Verschulden daran trifft, dass die Tatsachen oder Beweismittel erst nachträglich bekannt werden"],
    rf: ["Steuerbescheide sind aufzuheben oder zu ändern"],
    hinweis:
      "Tatsache ist jeder Lebensvorgang, der Merkmal eines Steuertatbestands ist, nicht aber eine Rechtsansicht. Maßgeblich für die Kenntnis ist der Zeitpunkt der abschließenden Zeichnung der Verfügung.",
    schema: [
      { n: "I.", t: "Steuerbescheid oder gleichgestellter Bescheid", art: "tb" },
      { n: "II.", t: "Tatsache oder Beweismittel", art: "tb", sub: ["Keine Rechtsauffassung, keine Schlussfolgerung"] },
      { n: "III.", t: "Nachträgliches Bekanntwerden", art: "tb", sub: ["Existenz bereits bei Erlass des Bescheids", "Unkenntnis der zuständigen Stelle im Zeitpunkt der Zeichnung"] },
      { n: "IV.", t: "Steuerliche Auswirkung", art: "tb", sub: ["Nr. 1 höhere Steuer", "Nr. 2 niedrigere Steuer und kein grobes Verschulden"] },
      { n: "V.", t: "Keine Änderungssperre", art: "tb", sub: ["Festsetzungsverjährung §§ 169 ff.", "Treu und Glauben bei verletzter Ermittlungspflicht", "§ 173 Abs. 2 nach Außenprüfung"] },
      { n: "VI.", t: "Ergebnis: gebundene Änderung, kein Ermessen", art: "rf" },
    ],
  },
};

A.KStG = {
  "8": {
    tb: ["Auch verdeckte Gewinnausschüttungen"],
    rf: ["mindern das Einkommen nicht"],
    hinweis:
      "Die verdeckte Gewinnausschüttung ist gesetzlich nicht definiert. Nach ständiger Rechtsprechung: Vermögensminderung oder verhinderte Vermögensmehrung, veranlasst durch das Gesellschaftsverhältnis, Auswirkung auf das Einkommen, kein Zusammenhang mit einer offenen Ausschüttung.",
    schema: [
      { n: "I.", t: "Vermögensminderung oder verhinderte Vermögensmehrung", art: "tb", sub: ["Vergleich mit dem Ergebnis ohne die Maßnahme"] },
      { n: "II.", t: "Veranlassung durch das Gesellschaftsverhältnis", art: "tb", sub: ["Fremdvergleich: ordentlicher und gewissenhafter Geschäftsleiter", "Beim beherrschenden Gesellschafter zusätzlich klare, im Voraus getroffene, zivilrechtlich wirksame Vereinbarung"] },
      { n: "III.", t: "Auswirkung auf die Höhe des Einkommens", art: "tb" },
      { n: "IV.", t: "Kein Zusammenhang mit einer offenen Ausschüttung", art: "tb" },
      { n: "V.", t: "Ergebnis: außerbilanzielle Hinzurechnung", art: "rf", sub: ["Beim Gesellschafter Kapitalertrag nach § 20 Abs. 1 Nr. 1 Satz 2 EStG", "Korrespondenzprinzip § 32a KStG"] },
    ],
  },
};

A.GewStG = {
  "2": {
    tb: ["jeder stehende Gewerbebetrieb, soweit er im Inland betrieben wird", "ein gewerbliches Unternehmen im Sinne des Einkommensteuergesetzes"],
    rf: ["Der Gewerbesteuer unterliegt"],
    hinweis:
      "Objektsteuercharakter: besteuert wird der Betrieb, nicht die Person. Kapitalgesellschaften gelten stets und in vollem Umfang als Gewerbebetrieb (§ 2 Abs. 2 Satz 1).",
    schema: [
      { n: "I.", t: "Gewerbebetrieb", art: "tb", sub: ["Kraft Tätigkeit: § 15 Abs. 2 EStG", "Kraft Rechtsform: § 2 Abs. 2", "Kraft wirtschaftlichen Geschäftsbetriebs: § 2 Abs. 3"] },
      { n: "II.", t: "Stehender Betrieb", art: "tb", sub: ["Abgrenzung zum Reisegewerbe, § 35a"] },
      { n: "III.", t: "Betriebsstätte im Inland (§ 12 AO)", art: "tb" },
      { n: "IV.", t: "Ergebnis: sachliche Gewerbesteuerpflicht", art: "rf", sub: ["Gewerbeertrag § 7, Hinzurechnungen § 8, Kürzungen § 9", "Freibetrag § 11, Anrechnung § 35 EStG"] },
    ],
  },
  "7": {
    tb: ["der nach den Vorschriften des Einkommensteuergesetzes oder des Körperschaftsteuergesetzes zu ermittelnde Gewinn aus dem Gewerbebetrieb"],
    rf: ["Gewerbeertrag ist"],
    hinweis:
      "Ausgangsgröße ist der einkommen- oder körperschaftsteuerliche Gewinn; die gewerbesteuerlichen Korrekturen folgen erst über §§ 8 und 9.",
    schema: [
      { n: "I.", t: "Gewinn aus Gewerbebetrieb nach EStG oder KStG", art: "tb" },
      { n: "II.", t: "Hinzurechnungen (§ 8)", art: "tb", sub: ["Entgelte für Schulden, Mieten, Pachten, Lizenzen", "Freibetrag von 200.000 Euro auf die Summe"] },
      { n: "III.", t: "Kürzungen (§ 9)", art: "tb", sub: ["1,2 Prozent des Einheitswerts des Grundbesitzes", "Erweiterte Kürzung für Grundstücksunternehmen, § 9 Nr. 1 Satz 2", "Schachtelbeteiligungen § 9 Nr. 2a"] },
      { n: "IV.", t: "Ergebnis: Gewerbeertrag", art: "rf", sub: ["Verlustabzug § 10a, Freibetrag § 11, Messbetrag und Hebesatz § 16"] },
    ],
  },
};

A.ErbStG = {
  "1": {
    tb: ["der Erwerb von Todes wegen", "die Schenkungen unter Lebenden"],
    rf: ["Der Erbschaftsteuer (Schenkungsteuer) unterliegen"],
    hinweis:
      "§ 1 nennt die vier Steuertatbestände. Konkretisiert werden sie in § 3 (Erwerb von Todes wegen) und § 7 (Schenkung unter Lebenden).",
    schema: [
      { n: "I.", t: "Steuerbarer Vorgang (§ 1 Abs. 1)", art: "tb", sub: ["Erwerb von Todes wegen, § 3", "Schenkung unter Lebenden, § 7", "Zweckzuwendung, Ersatzerbschaftsteuer"] },
      { n: "II.", t: "Persönliche Steuerpflicht (§ 2)", art: "tb", sub: ["Unbeschränkt bei Inländereigenschaft", "Sonst beschränkt auf Inlandsvermögen, § 121 BewG"] },
      { n: "III.", t: "Bereicherung und Bewertung", art: "tb", sub: ["§ 10 steuerpflichtiger Erwerb", "Bewertung nach BewG, Verschonung §§ 13a, 13b"] },
      { n: "IV.", t: "Ergebnis: Steuer nach Klasse und Tarif", art: "rf", sub: ["Steuerklasse § 15, Freibeträge § 16, Tarif § 19"] },
    ],
  },
  "7": {
    tb: ["jede freigebige Zuwendung unter Lebenden, soweit der Bedachte durch sie auf Kosten des Zuwendenden bereichert wird"],
    rf: ["Als Schenkungen unter Lebenden gelten"],
    hinweis:
      "Erforderlich sind objektiv eine unentgeltliche Bereicherung und subjektiv der Wille zur Freigebigkeit. Bei gemischten Schenkungen wird nur der unentgeltliche Teil erfasst.",
    schema: [
      { n: "I.", t: "Zuwendung: Vermögensverschiebung", art: "tb" },
      { n: "II.", t: "Bereicherung des Bedachten auf Kosten des Zuwendenden", art: "tb", sub: ["Objektive Unentgeltlichkeit", "Bei gemischter Schenkung Aufteilung"] },
      { n: "III.", t: "Wille zur Freigebigkeit", art: "tb", sub: ["Kenntnis der Unentgeltlichkeit genügt"] },
      { n: "IV.", t: "Ergebnis: steuerpflichtiger Erwerb", art: "rf", sub: ["Entstehung § 9 Abs. 1 Nr. 2 mit Ausführung der Zuwendung", "Zusammenrechnung nach § 14"] },
    ],
  },
};

A.GrEStG = {
  "1": {
    tb: ["ein Kaufvertrag oder ein anderes Rechtsgeschäft, das den Anspruch auf Übereignung begründet"],
    rf: ["Der Grunderwerbsteuer unterliegen"],
    hinweis:
      "Besteuert wird das Verpflichtungsgeschäft, nicht die Auflassung. Ergänzungstatbestände erfassen Anteilsübertragungen an grundbesitzenden Gesellschaften.",
    schema: [
      { n: "I.", t: "Inländisches Grundstück (§ 2)", art: "tb", sub: ["Grundstücke im Sinne des BGB, Erbbaurechte, Gebäude auf fremdem Boden"] },
      { n: "II.", t: "Erwerbsvorgang (§ 1)", art: "tb", sub: ["Abs. 1 Nr. 1: Verpflichtungsgeschäft", "Abs. 2a bis 3a: Anteilsübertragungen an grundbesitzenden Gesellschaften"] },
      { n: "III.", t: "Keine Ausnahme von der Besteuerung", art: "tb", sub: ["§ 3 persönliche Befreiungen, insbesondere Verwandtschaft", "§§ 5, 6 Übergang auf und von Gesamthand"] },
      { n: "IV.", t: "Ergebnis: Steuer nach Gegenleistung", art: "rf", sub: ["Bemessungsgrundlage §§ 8, 9", "Steuersatz landesrechtlich, § 11"] },
    ],
  },
};

A.FGO = {
  "40": {
    tb: ["wenn der Kläger geltend macht", "in seinen Rechten verletzt zu sein"],
    rf: ["Durch Klage kann die Aufhebung"],
    hinweis:
      "§ 40 regelt Klagearten und Klagebefugnis. Vor der Klage steht regelmäßig das Vorverfahren nach § 44; die Frist ergibt sich aus § 47.",
    schema: [
      { n: "I.", t: "Finanzrechtsweg (§ 33)", art: "tb" },
      { n: "II.", t: "Statthafte Klageart (§ 40 Abs. 1)", art: "tb", sub: ["Anfechtungsklage gegen Verwaltungsakte", "Verpflichtungsklage bei Ablehnung oder Unterlassen", "Allgemeine Leistungs- und Feststellungsklage (§ 41)"] },
      { n: "III.", t: "Klagebefugnis (§ 40 Abs. 2)", art: "tb", sub: ["Möglichkeit einer eigenen Rechtsverletzung"] },
      { n: "IV.", t: "Erfolglos abgeschlossenes Vorverfahren (§ 44)", art: "tb", sub: ["Ausnahme Sprungklage § 45, Untätigkeitsklage § 46"] },
      { n: "V.", t: "Klagefrist (§ 47) und Form (§ 64)", art: "tb", sub: ["Ein Monat nach Bekanntgabe der Einspruchsentscheidung"] },
      { n: "VI.", t: "Ergebnis: zulässige Klage", art: "rf", sub: ["Anschließend Begründetheit: Rechtswidrigkeit und Rechtsverletzung, § 100"] },
    ],
  },
};

A.BewG = {
  "9": {
    tb: ["der im gewöhnlichen Geschäftsverkehr nach der Beschaffenheit des Wirtschaftsgutes bei einer Veräußerung zu erzielen wäre"],
    rf: ["der gemeine Wert zugrunde zu legen"],
    hinweis:
      "Der gemeine Wert ist der Auffangmaßstab des Bewertungsrechts. Ungewöhnliche oder persönliche Verhältnisse bleiben außer Betracht.",
    schema: [
      { n: "I.", t: "Kein vorrangiger besonderer Wertmaßstab", art: "tb", sub: ["Grundbesitzwerte §§ 176 ff., Betriebsvermögen §§ 95 ff."] },
      { n: "II.", t: "Gewöhnlicher Geschäftsverkehr", art: "tb", sub: ["Erzielbarer Einzelveräußerungspreis"] },
      { n: "III.", t: "Ungewöhnliche und persönliche Verhältnisse bleiben unberücksichtigt", art: "tb", sub: ["Verfügungsbeschränkungen aus persönlichen Gründen zählen nicht"] },
      { n: "IV.", t: "Ergebnis: gemeiner Wert als Bemessungsgrundlage", art: "rf" },
    ],
  },
};

A.GrStG = {
  "2": {
    tb: ["die Betriebe der Land- und Forstwirtschaft", "die Grundstücke"],
    rf: ["Steuergegenstand ist der inländische Grundbesitz"],
    hinweis:
      "Die Grundsteuer knüpft an den Grundbesitz an. Seit der Reform richtet sich die Bewertung nach dem Siebenten Abschnitt des BewG, teils mit abweichenden Landesmodellen.",
    schema: [
      { n: "I.", t: "Inländischer Grundbesitz", art: "tb", sub: ["Betrieb der Land- und Forstwirtschaft, Grundsteuer A", "Grundstück, Grundsteuer B"] },
      { n: "II.", t: "Keine Steuerbefreiung (§§ 3 bis 8)", art: "tb" },
      { n: "III.", t: "Grundsteuerwert und Steuermesszahl", art: "tb", sub: ["Bewertung nach BewG oder Landesrecht", "Messbetrag §§ 13 ff."] },
      { n: "IV.", t: "Ergebnis: Steuer nach Hebesatz der Gemeinde (§ 25)", art: "rf" },
    ],
  },
};

const inhalt = Object.entries(A);
await mkdir(ZIEL, { recursive: true });
for (const [abk, normen] of inhalt) {
  await writeFile(
    path.join(ZIEL, `${abk.toLowerCase()}.json`),
    JSON.stringify({ abk, normen }, null, 1),
    "utf8"
  );
}
console.log(
  `${inhalt.length} Dateien, ${inhalt.reduce((a, [, n]) => a + Object.keys(n).length, 0)} annotierte Normen`
);
