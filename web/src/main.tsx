import { createRoot } from "react-dom/client";

// IBM Plex, bundled: the same weights the site has always used, served from this origin so no font
// request (and no visitor's address) goes to a third party. Subsets load by unicode-range as needed.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

// MapLibre v6 worker registration — must run before any map is constructed.
import "@/lib/maplibre";

import { installAnalytics, installDataFast } from "@/lib/system/analytics";
import { installPreviewInsets } from "@/lib/system/previewInsets";

import App from "./App.tsx";
import "./index.css";

// Before the first paint: inside the Rork preview frame the drawn status bar needs a safe area env() cannot report.
installPreviewInsets();
// The audience counters: DataFast on every build, Google Analytics only when a measurement id is
// configured — neither when the visitor sends Global Privacy Control.
installDataFast();
installAnalytics();

createRoot(document.getElementById("root")!).render(<App />);
