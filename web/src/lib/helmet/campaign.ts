import { encode } from "uqr";

/**
 * The helmet campaign (`/helmet`, user request 2026-09-12): ISI-certified helmets for Bengaluru's
 * bike-taxi passengers, bought in bulk and handed to the drivers as the pillion's helmet, paid for
 * by UPI. Everything the page states lives here — the payment address, the amounts offered, the
 * figures with their sources, the steps — so the copy is one list and the page only lays it out.
 *
 * The UPI id is the campaign's PUBLIC payment address: it is printed on the page and encoded in its
 * QR code by design. A UPI id can only receive money; it is not a credential (the support mailbox
 * and the moderator passphrase, which are, live in the environment and never here).
 */
export const UPI_ID = "7338425455@fam";
/** Payee name for the `pn` parameter (mandatory in the UPI linking spec); UPI apps show the bank's verified name beside it. Short, so the QR code stays coarse enough to scan from a screen. */
export const PAYEE_NAME = "theTraffic";
/** The note that appears on the payer's statement. */
export const TRANSACTION_NOTE = "Helmet campaign";
/** Quick-pick amounts in rupees; "Any amount" leaves the sum to the payer's app. */
export const AMOUNTS: readonly number[] = [200, 500, 1000, 2000];
/** UPI's usual per-transaction ceiling; anything above is left to the app rather than encoded. */
export const AMOUNT_MAX = 100_000;

/** A virtual payment address: `handle@bank`, URL-safe characters only. */
export function isUpiId(v: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,254}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(v);
}

/** A whole number of rupees within UPI's ceiling, else null (no `am` parameter). */
export function validAmount(a: number | null | undefined): number | null {
  return typeof a === "number" && Number.isInteger(a) && a > 0 && a <= AMOUNT_MAX ? a : null;
}

/**
 * The query every payment link carries, per NPCI's linking spec: `pa`, `pn` and `cu` always, `am`
 * only for a chosen amount, `tn` as the note. The id is URL-safe as it stands and is left unencoded —
 * a `%40` in `pa` trips some apps.
 */
export function upiQuery(amount: number | null, id: string = UPI_ID): string {
  const am = validAmount(amount);
  const parts = [`pa=${id}`, `pn=${encodeURIComponent(PAYEE_NAME)}`, "cu=INR"];
  if (am !== null) parts.push(`am=${am}`);
  parts.push(`tn=${encodeURIComponent(TRANSACTION_NOTE)}`);
  return parts.join("&");
}

/**
 * The generic `upi://pay` deep link. It is what the QR code carries (every UPI app scans it), and on
 * Android it opens the system's own chooser of the installed UPI apps.
 */
export function upiPayLink(amount: number | null, id: string = UPI_ID): string {
  return `upi://pay?${upiQuery(amount, id)}`;
}

/** A UPI app and the URL scheme it registers on iOS; the payment query is appended to `iosPrefix`. */
export interface UpiApp {
  id: string;
  name: string;
  iosPrefix: string;
}

/**
 * The apps an iPhone can be sent to by name. iOS has no chooser for a custom scheme: a generic
 * `upi://pay` link is handed to whichever installed app claimed `upi://` — WhatsApp, as often as not
 * (user report 2026-09-17: "Open in WhatsApp?" over the Pay button) — so on iOS the page links each
 * app through its own scheme instead. The prefixes are the ones documented for iOS intent: Google Pay
 * by Google's developer docs (`gpay://upi/pay`), PhonePe, Paytm, CRED and BHIM by Juspay's merchant
 * stack (`phonepe://pay`, `paytmmp://pay`, `credpay://upi/pay`, `bhim://pay`). Ordered by UPI volume.
 */
export const UPI_APPS: readonly UpiApp[] = [
  { id: "phonepe", name: "PhonePe", iosPrefix: "phonepe://pay" },
  { id: "gpay", name: "Google Pay", iosPrefix: "gpay://upi/pay" },
  { id: "paytm", name: "Paytm", iosPrefix: "paytmmp://pay" },
  { id: "cred", name: "CRED", iosPrefix: "credpay://upi/pay" },
  { id: "bhim", name: "BHIM", iosPrefix: "bhim://pay" },
];

/** The payment link that opens one named app on iOS — the same query as the generic link, behind the app's own scheme. */
export function appPayLink(app: UpiApp, amount: number | null, id: string = UPI_ID): string {
  return `${app.iosPrefix}?${upiQuery(amount, id)}`;
}

export type PayPlatform = "ios" | "android" | "other";

/**
 * Which kind of device is paying, from the browser's own description of itself (read in the page,
 * used for nothing else): iOS needs an app named; Android has its own chooser for `upi://pay`;
 * anything else has no UPI apps as a rule. iPadOS asks for desktop sites and calls itself a Mac —
 * the touch points tell it apart from one.
 */
export function payPlatform(ua: string, maxTouchPoints: number): PayPlatform {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  return "other";
}

/** The QR code's modules (true = dark) with a two-module quiet zone; error correction M. Pure. */
export function qrMatrix(data: string): boolean[][] {
  return encode(data, { ecc: "M", border: 2 }).data;
}

/** One unit square per dark module, for an SVG `<path>` in a viewBox of the matrix's size. Pure. */
export function qrPath(matrix: readonly (readonly boolean[])[]): string {
  const squares: string[] = [];
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x++) if (row[x]) squares.push(`M${x} ${y}h1v1h-1z`);
  }
  return squares.join("");
}

const rupees = new Intl.NumberFormat("en-IN");
export const fmtRupees = (n: number): string => `₹${rupees.format(n)}`;

/** The words that travel with a shared link. */
export function shareText(url: string): string {
  return `A certified helmet for every pillion — ISI-certified helmets for Bengaluru's bike-taxi passengers, handed to the drivers. Give by UPI: ${UPI_ID}\n${url}`;
}

export interface Source {
  name: string;
  href: string;
}

export interface Figure {
  value: string;
  label: string;
  source: Source;
}

const MORTH_2023: Source = { name: "MoRTH · Road Accidents in India 2023", href: "https://morth.gov.in/backend/documents/uploaded/Road-Accident-in-India-2023-Publications.pdf" };

/** Four figures, each with the public document it comes from. Years are named; nothing is projected. */
export const FIGURES: readonly Figure[] = [
  { value: "54,568", label: "killed on India's roads in 2023 without a helmet", source: MORTH_2023 },
  { value: "15,408", label: "of them were passengers — the pillion, not the rider", source: MORTH_2023 },
  {
    value: "909",
    label: "killed on Bengaluru's roads in 2023, the most on record; about 70 % of the fatal accidents involved a two-wheeler",
    source: { name: "Bengaluru Traffic Police · The Hindu, 1 Jan 2024", href: "https://www.thehindu.com/news/national/karnataka/road-accident-fatalities-rise-to-909-in-2023-in-bengaluru-city/article67695823.ece" },
  },
  {
    value: "25–30 %",
    label: "of Bengaluru's riders who wear a helmet wear a standard one; 80 % wear something",
    source: { name: "NIMHANS & Bengaluru Traffic Police · The Hindu, 30 May 2024", href: "https://www.thehindu.com/news/cities/bangalore/is-your-helmet-good-enough-to-save-your-head-often-not-say-police-and-experts/article68224299.ece" },
  },
];

/** The two rules the campaign rests on, each linked to its record. */
export const LAW = {
  pillion2016: { text: "since January 2016", href: "https://www.thehindu.com/news/national/karnataka/pillion-riders-without-helmets-to-be-fined-from-today/article8177873.ece" },
  bis2021: { text: "the BIS mark (IS 4151)", href: "https://www.bis.gov.in/wp-content/uploads/2020/12/Helmet-for-riders-of-Two-Wheeler-Motor-Vehicles-Quality-Control-Order-2020.pdf" },
} as const;

/** How it works — three steps, one sentence each. */
export const STEPS: readonly { index: string; title: string; body: string }[] = [
  { index: "01", title: "Buy", body: "ISI-certified helmets — IS 4151:2015, the BIS mark on the shell — bought in bulk from a licensed maker." },
  { index: "02", title: "Hand over", body: "Given to bike-taxi drivers where they wait for rides, one each, as the passenger's helmet; it stays on the bike." },
  { index: "03", title: "Ride", body: "The next person on the back rides in a helmet that can take a hit, not one bought to get past a checkpoint." },
];
