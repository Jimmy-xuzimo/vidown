// Run before styles to avoid a light flash when a dark theme is selected.
(() => {
  const root = document.documentElement;
  root.dataset.js = "true";
  let preference = "system";
  try {
    preference = localStorage.getItem("vidown-site-theme") || "system";
  } catch {}
  if (!["light", "dark", "system"].includes(preference)) preference = "system";
  root.dataset.preference = preference;
  root.dataset.theme =
    preference === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
})();
