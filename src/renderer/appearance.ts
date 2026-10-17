import { useEffect } from "react";
import type { Settings } from "../shared/types";

type Appearance = Pick<
  Settings,
  "colorMode" | "theme" | "animations" | "hoverGlow" | "density"
>;
const fallback: Appearance = {
  colorMode: "system",
  theme: "iris",
  animations: true,
  hoverGlow: true,
  density: "comfortable",
};
export function applyAppearance(value: Appearance) {
  const root = document.documentElement;
  root.dataset.mode =
    value.colorMode === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : value.colorMode;
  root.dataset.theme = value.theme;
  root.dataset.motion = value.animations ? "on" : "off";
  root.dataset.density = value.density;
  root.dataset.glow = value.hoverGlow ? "on" : "off";
}
try {
  const cached = {
    ...fallback,
    ...JSON.parse(localStorage.getItem("vidown.appearance") || "{}"),
  };
  if (!["dark", "light", "system"].includes(cached.colorMode))
    cached.colorMode = "system";
  if (!["iris", "ocean", "jade", "rose"].includes(cached.theme))
    cached.theme = "iris";
  applyAppearance(cached);
} catch {
  applyAppearance(fallback);
}

export function useAppearance(settings?: Settings) {
  useEffect(() => {
    if (!settings) return;
    const value: Appearance = {
      colorMode: settings.colorMode,
      theme: settings.theme,
      animations: settings.animations,
      hoverGlow: settings.hoverGlow,
      density: settings.density,
    };
    const apply = () => applyAppearance(value);
    apply();
    try {
      localStorage.setItem("vidown.appearance", JSON.stringify(value));
    } catch {}
    const query = matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [
    settings?.colorMode,
    settings?.theme,
    settings?.animations,
    settings?.hoverGlow,
    settings?.density,
  ]);

  useEffect(() => {
    if (!settings?.hoverGlow) return;
    let frame = 0,
      lastTime = 0,
      x = 0,
      y = 0;
    let target: HTMLElement | null = null;
    const clear = () => {
      target?.classList.remove("pointer-lit");
      target = null;
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const update = (time: number) => {
      frame = 0;
      if (!target || !target.isConnected || document.hidden) return;
      // At most one small highlight repaint per 32 ms, only during pointer input.
      if (time - lastTime < 32) return;
      lastTime = time;
      const box = target.getBoundingClientRect();
      target.style.setProperty("--glow-x", `${Math.round(x - box.left)}px`);
      target.style.setProperty("--glow-y", `${Math.round(y - box.top)}px`);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const next = (event.target as Element).closest<HTMLElement>(
        "button, .card, .task-row, .url-entry, .theme-choice",
      );
      if (next !== target) {
        clear();
        target = next;
        target?.classList.add("pointer-lit");
        lastTime = 0;
      }
      x = event.clientX;
      y = event.clientY;
      if (target && !frame && !document.hidden)
        frame = requestAnimationFrame(update);
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", clear);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clear();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", clear);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [settings?.hoverGlow]);
}
