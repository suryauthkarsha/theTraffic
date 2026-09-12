import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { usePageTitle } from "@/hooks/usePageTitle";

const NotFound = () => {
  const location = useLocation();
  usePageTitle("Not found");

  useEffect(() => {
    console.warn("404: no route for", location.pathname);
  }, [location.pathname]);

  return (
    <AppShell>
      <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
        <section className="panel panel-hud w-full max-w-[520px] p-8 rise-in" aria-labelledby="nf-title">
          <div className="readout readout-ember text-[64px]">404</div>
          <h1 id="nf-title" className="mt-3 text-[22px] font-semibold text-gw-text">
            No signal here
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-gw-secondary">
            Nothing at <span className="mono text-gw-text">{location.pathname}</span>.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/console" className="btn-primary">
              Console
            </Link>
            <Link to="/signals" className="btn-secondary h-11">
              Signal Map <ArrowRight size={14} className="ml-1.5" aria-hidden />
            </Link>
            <Link to="/support" className="btn-secondary h-11">
              Support
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
};

export default NotFound;
