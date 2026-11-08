// Visitor-facing notes, newest first. Update these for visible production changes.
export const playerReleases = [
  {
    title: "Recent improvements",
    changes: [
      "Switch between WebGL and WebGPU from the pause menu, keeping your mode and settings when the lab reloads.",
      "The field's reflections and ripples are more consistent across the two renderers.",
      "Base and boost speed controls are available again in the Movement settings.",
    ],
  },
  {
    title: "Version 0.6.0 Alpha",
    changes: [
      "Explore the ripple field in Training, Track, or Arena, with a choice of field styles and colors.",
      "The Legacy Neon palette gives the field a stronger violet and cyan glow with golden wave crests.",
      "Choose a field style and palette from the pause menu to make the lab your own.",
    ],
  },
];

export function renderPlayerChangelog(container: HTMLElement): void {
  container.replaceChildren();
  for (const release of playerReleases) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = release.title;
    const list = document.createElement("ul");
    for (const change of release.changes) {
      const item = document.createElement("li");
      item.textContent = change;
      list.append(item);
    }
    section.append(heading, list);
    container.append(section);
  }
}
