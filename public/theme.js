(() => {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
  try { window.localStorage.setItem("world-news-atlas-theme", "dark"); } catch {}
})();
