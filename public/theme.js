(() => {
  let preference = "dark";
  try {
    const stored = window.localStorage.getItem("world-news-atlas-theme");
    if (["light", "dark", "system"].includes(stored)) preference = stored;
  } catch {}
  const resolved = preference === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
})();
