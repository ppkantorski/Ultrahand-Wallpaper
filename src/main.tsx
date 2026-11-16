import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Prevent browser zoom via Ctrl/Cmd+scroll (Chrome/Firefox trackpad pinch)
// and Ctrl/Cmd+keyboard shortcuts. Safari Magic Mouse smart zoom is OS-level
// and cannot be blocked from a webpage — disable it in System Preferences > Mouse.
window.addEventListener("wheel", (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { passive: false, capture: true });
window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && ["=", "-", "+", "0"].includes(e.key)) e.preventDefault(); }, { capture: true });

createRoot(document.getElementById("root")!).render(<App />);

// Offline start: the service worker serves the page network-first from its "pages-cache",
// which normally only fills on a later visit. Store the page as soon as the worker is
// ready, so the app opens offline right after the first visit / install.
if ("serviceWorker" in navigator && "caches" in window) {
  navigator.serviceWorker.ready
    .then(() => caches.open("pages-cache"))
    .then((cache) => cache.add(import.meta.env.BASE_URL))
    .catch(() => {});
}
