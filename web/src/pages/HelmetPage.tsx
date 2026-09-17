import { ArrowRight, Check, Copy, HardHat, Share2 } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { UpiQr } from "@/components/helmet/UpiQr";
import { AppShell } from "@/components/layout/AppShell";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { usePageTitle } from "@/hooks/usePageTitle";
import { AMOUNTS, appPayLink, FIGURES, fmtRupees, LAW, payPlatform, shareText, STEPS, UPI_APPS, UPI_ID, upiPayLink } from "@/lib/helmet/campaign";
import { SITE_URL } from "@/lib/system/seo";
import { cn } from "@/lib/utils";

const inline = "text-gw-text underline decoration-gw-muted underline-offset-2 hover:decoration-gw-orange";
const quiet = "inline-flex min-h-[32px] items-center gap-1 rounded px-1.5 text-[12px] text-gw-secondary hover:text-gw-text coarse:min-h-[44px]";

/**
 * The helmet campaign (`/helmet`, user request 2026-09-12): why the pillion, how it works, and one
 * HUD panel to give by UPI — a QR code drawn here, the id with Copy, a few plain amounts and, on a
 * phone, a link that opens the payer's own app: on Android the generic `upi://pay`, which the system
 * answers with its chooser of installed UPI apps; on iOS, which has no chooser and handed `upi://` to
 * WhatsApp (user report 2026-09-17), one link per app on that app's own scheme. Paying happens in
 * that app; this page takes no part in it and learns nothing.
 */
export default function HelmetPage() {
  usePageTitle("Helmet campaign");
  const id = useId();
  const [amount, setAmount] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const link = useMemo(() => upiPayLink(amount), [amount]);
  const platform = useMemo(() => (typeof navigator === "undefined" ? "other" : payPlatform(navigator.userAgent, typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0)), []);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const pageUrl = `${SITE_URL}/helmet`;

  const say = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2_000);
  };
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(UPI_ID);
      say("Copied.");
    } catch {
      say("Clipboard blocked.");
    }
  };
  const share = async () => {
    if (canShare) {
      try {
        await navigator.share({ title: "A certified helmet for every pillion — theTraffic.", text: shareText(pageUrl), url: pageUrl });
      } catch (e) {
        if ((e as { name?: unknown } | null)?.name !== "AbortError") say("Sharing did not work here — copy the link instead.");
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(pageUrl);
      say("Link copied.");
    } catch {
      say("Clipboard blocked.");
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1180px] px-4 pb-12 pt-4 sm:px-6">
        <Breadcrumb parent={{ to: "/console", label: "Console" }} current="Helmet campaign" />
        <header className="mt-4">
          <div className="eyebrow">
            <b>campaign</b> · helmets for the pillion
          </div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.01em] text-gw-text">A certified helmet for every pillion.</h1>
          <p className="mt-2 max-w-[62ch] text-[13.5px] text-gw-secondary">We buy ISI-certified helmets and hand them to bike-taxi drivers in Bengaluru — Uber Moto, Rapido — as the passenger's helmet.</p>
        </header>

        {/* Phones: the Give panel comes first, then the case for it; on a desk the case is on the left. */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="order-last space-y-6 lg:order-none">
            <section className="panel p-5" aria-labelledby={`${id}-why`}>
              <h2 id={`${id}-why`} className="text-[15px] font-semibold text-gw-text">
                Why the pillion
              </h2>
              <div className="rule mt-3" aria-hidden />
              <p className="mt-3 text-[13.5px] leading-relaxed text-gw-secondary">
                On a bike taxi the driver wears a helmet. The passenger gets the spare on the hook — when there is one, and often the thin kind. The pillion has had to wear a helmet in Karnataka{" "}
                <a href={LAW.pillion2016.href} target="_blank" rel="noopener noreferrer" className={inline}>
                  {LAW.pillion2016.text}
                </a>
                , and since June 2021 only helmets carrying{" "}
                <a href={LAW.bis2021.href} target="_blank" rel="noopener noreferrer" className={inline}>
                  {LAW.bis2021.text}
                </a>{" "}
                may be made or sold in India.
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Figures">
                {FIGURES.map((f, i) => (
                  <li key={f.value} className="card-inset rise-in p-3" style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="readout text-[24px] text-gw-text">{f.value}</div>
                    <p className="mt-1.5 text-[13px] leading-snug text-gw-secondary">{f.label}</p>
                    <a href={f.source.href} target="_blank" rel="noopener noreferrer" className="mono mt-2 inline-block text-[11px] text-gw-muted hover:text-gw-secondary">
                      {f.source.name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel p-5" aria-labelledby={`${id}-how`}>
              <h2 id={`${id}-how`} className="text-[15px] font-semibold text-gw-text">
                How it works
              </h2>
              <div className="rule mt-3" aria-hidden />
              <ol className="mt-3 grid gap-2">
                {STEPS.map((s) => (
                  <li key={s.index} className="card-inset grid gap-3 p-4 sm:grid-cols-[56px_minmax(0,1fr)]">
                    <span className="readout text-[24px] text-gw-tick">{s.index}</span>
                    <div>
                      <h3 className="text-[15px] font-semibold text-gw-text">{s.title}</h3>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-gw-secondary">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section className="panel panel-hud order-first self-start p-4 sm:p-5 lg:order-none" aria-labelledby={`${id}-give`}>
            <div className="flex items-center gap-2">
              <HardHat size={17} className="text-gw-orange" aria-hidden />
              <h2 id={`${id}-give`} className="text-[17px] font-semibold text-gw-text">
                Give
              </h2>
            </div>
            <p className="mt-1.5 text-[12.5px] text-gw-muted">
              By UPI — scan the code, {platform === "ios" ? "tap your app, " : <span className="fine:hidden">tap Pay, </span>}or paste the id into any UPI app.
            </p>

            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
              <UpiQr data={link} size={216} label={amount === null ? `UPI QR code for ${UPI_ID}` : `UPI QR code for ${UPI_ID}, ${fmtRupees(amount)}`} />
              <div className="min-w-0 flex-1 space-y-4">
                <div>
                  <span className="label">UPI id</span>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="mono select-all text-[15px] text-gw-text">{UPI_ID}</code>
                    <button type="button" onClick={() => void copyId()} className={quiet} aria-label="Copy the UPI id">
                      <Copy size={12} aria-hidden /> Copy
                    </button>
                  </div>
                </div>
                <div role="group" aria-label="Amount">
                  <span className="label">Amount</span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {AMOUNTS.map((a) => (
                      <button key={a} type="button" onClick={() => setAmount(a)} aria-pressed={amount === a} className={cn("chip mono", amount === a && "border-gw-orange/50 text-gw-text")}>
                        {fmtRupees(a)}
                      </button>
                    ))}
                    <button type="button" onClick={() => setAmount(null)} aria-pressed={amount === null} className={cn("chip", amount === null && "border-gw-orange/50 text-gw-text")}>
                      Any amount
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {platform === "ios" ? (
              /* iOS has no chooser for upi:// — it hands the link to whichever app claimed the scheme — so each app is linked by name, the generic link last for any other. */
              <div className="mt-4" role="group" aria-labelledby={`${id}-paywith`}>
                <span id={`${id}-paywith`} className="label">
                  Pay with
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {UPI_APPS.map((app) => (
                    <a key={app.id} href={appPayLink(app, amount)} className="btn-secondary h-11 px-2 text-[13px]">
                      {app.name}
                    </a>
                  ))}
                  <a href={link} className="btn-secondary h-11 px-2 text-[13px]">
                    Another UPI app
                  </a>
                </div>
              </div>
            ) : (
              /* Android answers upi:// with its own chooser of installed apps; a desk has none, so there the code and the id are the way. */
              <a href={link} className="btn-primary mt-4 h-11 w-full text-[14px] fine:hidden">
                Pay with a UPI app <ArrowRight size={15} className="ml-1.5" aria-hidden />
              </a>
            )}

            <p className="mt-4 text-[13.5px] leading-relaxed text-gw-text">Everything you give goes to the campaign — the helmets, and handing them over. Nothing is kept back.</p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void share()} className="btn-secondary h-10 text-[13px]">
                <Share2 size={14} className="mr-1.5" aria-hidden /> {canShare ? "Share the campaign" : "Copy the link"}
              </button>
              {flash && (
                <span className="text-[12px] text-gw-orange" role="status">
                  <Check size={12} className="mr-1 inline" aria-hidden />
                  {flash}
                </span>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
