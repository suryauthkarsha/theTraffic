import { ArrowRight, Check, Copy, HardHat, Share2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { encode } from "uqr";

import { AppShell } from "@/components/layout/AppShell";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { usePageTitle } from "@/hooks/usePageTitle";
import { SITE_URL } from "@/lib/system/seo";
import { cn } from "@/lib/utils";

const UPI_ID = "7338425455@fam";
const PAYEE_NAME = "theTraffic";
const PAYMENT_NOTE = "Helmet campaign";
const AMOUNTS = [200, 500, 1_000, 2_000] as const;

function validAmount(amount: number | null): number | null {
  return typeof amount === "number" && Number.isInteger(amount) && amount > 0 && amount <= 100_000 ? amount : null;
}

export function buildUpiUrl(amount: number | null, upiId = UPI_ID): string {
  const valid = validAmount(amount);
  const params = [`pa=${upiId}`, `pn=${encodeURIComponent(PAYEE_NAME)}`, "cu=INR"];
  if (valid !== null) params.push(`am=${valid}`);
  params.push(`tn=${encodeURIComponent(PAYMENT_NOTE)}`);
  return `upi://pay?${params.join("&")}`;
}

function qrPath(data: boolean[][]): string {
  const path: string[] = [];
  for (let y = 0; y < data.length; y += 1) {
    for (let x = 0; x < data[y].length; x += 1) {
      if (data[y][x]) path.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return path.join("");
}

function QrCode({ data, label, size = 192 }: { data: string; label: string; size?: number }) {
  const qr = useMemo(() => {
    const encoded = encode(data, { ecc: "M", border: 2 });
    return { path: qrPath(encoded.data), modules: encoded.data.length };
  }, [data]);

  return (
    <div className="shrink-0 rounded-[3px] bg-[#FFFFFF] p-3" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${qr.modules} ${qr.modules}`} width="100%" height="100%" role="img" aria-label={label} shapeRendering="crispEdges">
        <path d={qr.path} fill="#000000" />
      </svg>
    </div>
  );
}

const nf = new Intl.NumberFormat("en-IN");
const formatAmount = (amount: number): string => `₹${nf.format(amount)}`;
const shareText = (url: string): string => `A certified helmet for every pillion — ISI-certified helmets for Bengaluru's bike-taxi passengers, handed to the drivers. Give by UPI: ${UPI_ID}\n${url}`;

const MORTH = {
  name: "MoRTH · Road Accidents in India 2023",
  href: "https://morth.gov.in/backend/documents/uploaded/Road-Accident-in-India-2023-Publications.pdf",
};

const FIGURES = [
  { value: "54,568", label: "killed on India's roads in 2023 without a helmet", source: MORTH },
  { value: "15,408", label: "of them were passengers — the pillion, not the rider", source: MORTH },
  {
    value: "909",
    label: "killed on Bengaluru's roads in 2023, the most on record; about 70 % of the fatal accidents involved a two-wheeler",
    source: {
      name: "Bengaluru Traffic Police · The Hindu, 1 Jan 2024",
      href: "https://www.thehindu.com/news/national/karnataka/road-accident-fatalities-rise-to-909-in-2023-in-bengaluru-city/article67695823.ece",
    },
  },
  {
    value: "25–30 %",
    label: "of Bengaluru's riders who wear a helmet wear a standard one; 80 % wear something",
    source: {
      name: "NIMHANS & Bengaluru Traffic Police · The Hindu, 30 May 2024",
      href: "https://www.thehindu.com/news/cities/bangalore/is-your-helmet-good-enough-to-save-your-head-often-not-say-police-and-experts/article68224299.ece",
    },
  },
] as const;

const RULES = {
  pillion2016: {
    text: "since January 2016",
    href: "https://www.thehindu.com/news/national/karnataka/pillion-riders-without-helmets-to-be-fined-from-today/article8177873.ece",
  },
  bis2021: {
    text: "the BIS mark (IS 4151)",
    href: "https://www.bis.gov.in/wp-content/uploads/2020/12/Helmet-for-riders-of-Two-Wheeler-Motor-Vehicles-Quality-Control-Order-2020.pdf",
  },
} as const;

const STEPS = [
  { index: "01", title: "Buy", body: "ISI-certified helmets — IS 4151:2015, the BIS mark on the shell — bought in bulk from a licensed maker." },
  { index: "02", title: "Hand over", body: "Given to bike-taxi drivers where they wait for rides, one each, as the passenger's helmet; it stays on the bike." },
  { index: "03", title: "Ride", body: "The next person on the back rides in a helmet that can take a hit, not one bought to get past a checkpoint." },
] as const;

const sourceLink = "text-gw-text underline decoration-gw-muted underline-offset-2 hover:decoration-gw-orange";
const smallButton = "inline-flex min-h-[32px] items-center gap-1 rounded px-1.5 text-[12px] text-gw-secondary hover:text-gw-text coarse:min-h-[44px]";

export default function HelmetPage() {
  usePageTitle("Helmet campaign");
  const id = useId();
  const [amount, setAmount] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const upiUrl = useMemo(() => buildUpiUrl(amount), [amount]);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const campaignUrl = `${SITE_URL}/helmet`;

  const showStatus = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2_000);
  };

  const copyUpiId = async () => {
    try {
      await navigator.clipboard.writeText(UPI_ID);
      showStatus("Copied.");
    } catch {
      showStatus("Clipboard blocked.");
    }
  };

  const share = async () => {
    if (canShare) {
      try {
        await navigator.share({ title: "A certified helmet for every pillion — theTraffic.", text: shareText(campaignUrl), url: campaignUrl });
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") showStatus("Sharing did not work here — copy the link instead.");
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(campaignUrl);
      showStatus("Link copied.");
    } catch {
      showStatus("Clipboard blocked.");
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1180px] px-4 pb-12 pt-4 sm:px-6">
        <Breadcrumb parent={{ to: "/console", label: "Console" }} current="Helmet campaign" />
        <header className="mt-4">
          <div className="eyebrow"><b>campaign</b> · helmets for the pillion</div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.01em] text-gw-text">A certified helmet for every pillion.</h1>
          <p className="mt-2 max-w-[62ch] text-[13.5px] text-gw-secondary">We buy ISI-certified helmets and hand them to bike-taxi drivers in Bengaluru — Uber Moto, Rapido — as the passenger's helmet.</p>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="order-last space-y-6 lg:order-none">
            <section className="panel p-5" aria-labelledby={`${id}-why`}>
              <h2 id={`${id}-why`} className="text-[15px] font-semibold text-gw-text">Why the pillion</h2>
              <div className="rule mt-3" aria-hidden />
              <p className="mt-3 text-[13.5px] leading-relaxed text-gw-secondary">
                On a bike taxi the driver wears a helmet. The passenger gets the spare on the hook — when there is one, and often the thin kind. The pillion has had to wear a helmet in Karnataka{" "}
                <a href={RULES.pillion2016.href} target="_blank" rel="noopener noreferrer" className={sourceLink}>{RULES.pillion2016.text}</a>, and since June 2021 only helmets carrying{" "}
                <a href={RULES.bis2021.href} target="_blank" rel="noopener noreferrer" className={sourceLink}>{RULES.bis2021.text}</a>{" "}
                may be made or sold in India.
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Figures">
                {FIGURES.map((figure, index) => (
                  <li key={figure.value} className="card-inset rise-in p-3" style={{ animationDelay: `${index * 40}ms` }}>
                    <div className="readout text-[24px] text-gw-text">{figure.value}</div>
                    <p className="mt-1.5 text-[13px] leading-snug text-gw-secondary">{figure.label}</p>
                    <a href={figure.source.href} target="_blank" rel="noopener noreferrer" className="mono mt-2 inline-block text-[11px] text-gw-muted hover:text-gw-secondary">{figure.source.name}</a>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel p-5" aria-labelledby={`${id}-how`}>
              <h2 id={`${id}-how`} className="text-[15px] font-semibold text-gw-text">How it works</h2>
              <div className="rule mt-3" aria-hidden />
              <ol className="mt-3 grid gap-2">
                {STEPS.map((step) => (
                  <li key={step.index} className="card-inset grid gap-3 p-4 sm:grid-cols-[56px_minmax(0,1fr)]">
                    <span className="readout text-[24px] text-gw-tick">{step.index}</span>
                    <div>
                      <h3 className="text-[15px] font-semibold text-gw-text">{step.title}</h3>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-gw-secondary">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section className="panel panel-hud order-first self-start p-4 sm:p-5 lg:order-none" aria-labelledby={`${id}-give`}>
            <div className="flex items-center gap-2">
              <HardHat size={17} className="text-gw-orange" aria-hidden />
              <h2 id={`${id}-give`} className="text-[17px] font-semibold text-gw-text">Give</h2>
            </div>
            <p className="mt-1.5 text-[12.5px] text-gw-muted">By UPI — scan the code, <span className="fine:hidden">tap Pay, </span>or paste the id into any UPI app.</p>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
              <QrCode data={upiUrl} size={216} label={amount === null ? `UPI QR code for ${UPI_ID}` : `UPI QR code for ${UPI_ID}, ${formatAmount(amount)}`} />
              <div className="min-w-0 flex-1 space-y-4">
                <div>
                  <span className="label">UPI id</span>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="mono select-all text-[15px] text-gw-text">{UPI_ID}</code>
                    <button type="button" onClick={() => void copyUpiId()} className={smallButton} aria-label="Copy the UPI id"><Copy size={12} aria-hidden /> Copy</button>
                  </div>
                </div>
                <div role="group" aria-label="Amount">
                  <span className="label">Amount</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {AMOUNTS.map((value) => (
                      <button key={value} type="button" onClick={() => setAmount(value)} aria-pressed={amount === value} className={cn("chip mono", amount === value && "border-gw-orange/50 text-gw-text")}>{formatAmount(value)}</button>
                    ))}
                    <button type="button" onClick={() => setAmount(null)} aria-pressed={amount === null} className={cn("chip", amount === null && "border-gw-orange/50 text-gw-text")}>Any amount</button>
                  </div>
                </div>
              </div>
            </div>
            <a href={upiUrl} className="btn-primary mt-4 h-11 w-full text-[14px] fine:hidden">Pay with a UPI app <ArrowRight size={15} className="ml-1.5" aria-hidden /></a>
            <p className="mt-4 text-[13.5px] leading-relaxed text-gw-text">Everything you give goes to the campaign — the helmets, and handing them over. Nothing is kept back.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void share()} className="btn-secondary h-10 text-[13px]"><Share2 size={14} className="mr-1.5" aria-hidden /> {canShare ? "Share the campaign" : "Copy the link"}</button>
              {status && <span className="text-[12px] text-gw-orange" role="status"><Check size={12} className="mr-1 inline" aria-hidden />{status}</span>}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
