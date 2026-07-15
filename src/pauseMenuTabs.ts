const TAB_SELECTOR = "[data-settings-tab]";
const PANEL_SELECTOR = "[data-settings-panel]";

/**
 * Wires the pause-menu settings tabs once per runtime. The DOM owns the
 * categories so WebGL and WebGPU cannot drift into different menu layouts.
 */
export function wirePauseMenuTabs(root: ParentNode = document): void {
  const tabList = root.querySelector<HTMLElement>("[data-settings-tablist]");
  if (!tabList || tabList.dataset.tabsWired === "true") return;

  const tabs = [...tabList.querySelectorAll<HTMLButtonElement>(TAB_SELECTOR)];
  const panels = [...root.querySelectorAll<HTMLElement>(PANEL_SELECTOR)];
  if (tabs.length === 0 || panels.length === 0) return;

  const activateTab = (nextTab: HTMLButtonElement, focus: boolean): void => {
    const activeCategory = nextTab.dataset.settingsTab;
    if (!activeCategory) return;

    for (const tab of tabs) {
      const active = tab === nextTab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.settingsPanel !== activeCategory;
    }
    if (focus) nextTab.focus({ preventScroll: true });
  };

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => activateTab(tab, false));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;

      event.preventDefault();
      activateTab(tabs[nextIndex], true);
    });
  }

  tabList.dataset.tabsWired = "true";
  activateTab(tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ?? tabs[0], false);
}
