import { useEffect, useState } from "react";

/** Presentation only: hiding a page or reducing motion never delays a business operation. */
export function useControlMotion() {
  const available = () => document.visibilityState !== "hidden" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [enabled, setEnabled] = useState(available);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(available());
    media?.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => { media?.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  return enabled;
}
