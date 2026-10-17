import { useEffect } from "react";
import type { Settings } from "../shared/types";

type Appearance = Pick<
  Settings,
  "colorMode" | "theme" | "animations" | "density"
>;
const fallback: Appearance = {
  colorMode: "system",
  theme: "iris",
  animations: true,
  density: "compact",
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
  root.dataset.density = "compact";
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
    settings?.density,
  ]);
}
