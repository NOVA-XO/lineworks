(() => {
  "use strict";

  const root = document.documentElement;
  const themeButton = document.getElementById("theme");
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const sunIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></svg>';
  const moonIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  const applyTheme = (value) => {
    const theme = value === "light" ? "light" : "dark";
    const light = theme === "light";

    root.dataset.theme = theme;

    if (themeMeta) {
      themeMeta.content = light ? "#ffffff" : "#070d18";
    }

    if (themeButton) {
      const label = light
        ? "Бараан горимд шилжих"
        : "Цайвар горимд шилжих";

      themeButton.setAttribute("aria-label", label);
      themeButton.title = label;
      themeButton.innerHTML = light ? moonIcon : sunIcon;
    }
  };

  let initialTheme = root.dataset.theme;

  try {
    initialTheme = localStorage.getItem("zs-theme") || initialTheme;
  } catch {}

  applyTheme(initialTheme);

  themeButton?.addEventListener("click", () => {
    const next = root.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);

    try {
      localStorage.setItem("zs-theme", next);
    } catch {}
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "zs-theme" || event.key === null) {
      applyTheme(event.newValue);
    }
  });

  const menu = document.getElementById("menu");
  const nav = document.getElementById("nav");

  if (!menu || !nav) return;

  const mobile = window.matchMedia("(max-width: 1180px)");

  const setMenu = (open, restoreFocus = false) => {
    const expanded = mobile.matches && open;
    nav.classList.toggle("open", expanded);
    menu.setAttribute("aria-expanded", String(expanded));

    if (restoreFocus && mobile.matches) {
      menu.focus({ preventScroll: true });
    }
  };

  menu.setAttribute("aria-controls", nav.id);

  menu.addEventListener("click", () => {
    setMenu(menu.getAttribute("aria-expanded") !== "true");
  });

  nav.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) {
      setMenu(false, true);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("open")) {
      event.preventDefault();
      setMenu(false, true);
    }
  });

  document.addEventListener("click", (event) => {
    if (
      nav.classList.contains("open") &&
      event.target instanceof Node &&
      !nav.contains(event.target) &&
      !menu.contains(event.target)
    ) {
      setMenu(false, nav.contains(document.activeElement));
    }
  });

  document.addEventListener("focusin", (event) => {
    if (
      nav.classList.contains("open") &&
      event.target instanceof Node &&
      !nav.contains(event.target) &&
      !menu.contains(event.target)
    ) {
      setMenu(false);
    }
  });

  const handleBreakpoint = () => {
    const focusWasInNav = nav.contains(document.activeElement);
    setMenu(false, mobile.matches && focusWasInNav);
  };

  if (mobile.addEventListener) {
    mobile.addEventListener("change", handleBreakpoint);
  } else {
    mobile.addListener(handleBreakpoint);
  }

  setMenu(false);
  root.classList.add("nav-ready");
})();
