import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Route-level code splitting: the lander is the entry chunk (small, no map); the console entry,
// the signal map and every other screen load on first visit.
import LandingPage from "./pages/LandingPage";
const ConsolePage = lazy(() => import("./pages/ConsolePage"));
const SignalMapPage = lazy(() => import("./pages/SignalMapPage"));
const IntersectionPage = lazy(() => import("./pages/IntersectionPage"));
const SurveillancePage = lazy(() => import("./pages/SurveillancePage"));
const ResearchPage = lazy(() => import("./pages/ResearchPage"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage"));
const SupportPage = lazy(() => import("./pages/SupportPage"));
const GrievancePage = lazy(() => import("./pages/GrievancePage"));
const GrievancesPage = lazy(() => import("./pages/GrievancesPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

/** Shown for the few hundred milliseconds a lazy screen takes to arrive. */
function RouteFallback() {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center bg-gw-canvas" role="status" aria-live="polite">
      <span className="chip">
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-gw-orange" aria-hidden /> loading
      </span>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/console" element={<ConsolePage />} />
              <Route path="/signals" element={<SignalMapPage />} />
              <Route path="/intersection/:id" element={<IntersectionPage />} />
              <Route path="/surveillance" element={<SurveillancePage />} />
              <Route path="/research" element={<ResearchPage />} />
              <Route path="/methodology" element={<MethodologyPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/grievance" element={<GrievancePage />} />
              <Route path="/grievances" element={<GrievancesPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
