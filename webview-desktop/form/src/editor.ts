import { Playground } from "@bpmn-io/form-js-playground";

let playground: Playground | undefined;

interface ResizerElements {
  container: HTMLElement;
  main: HTMLElement;
}

/**
 * Make the form-js Components palette horizontally collapsible without
 * changing the playground's Preact-managed DOM.
 */
export function setupPaletteCollapse(
  container: HTMLElement,
  palette: HTMLElement,
): void {
  if (
    typeof container.querySelector !== "function" ||
    typeof container.appendChild !== "function" ||
    typeof palette.querySelector !== "function"
  ) {
    return;
  }

  if (container.querySelector(".fjs-palette-collapse-toggle")) {
    return;
  }

  const button = document.createElement("button");
  button.className = "fjs-palette-collapse-toggle";
  button.type = "button";
  button.title = "Collapse Components panel";
  button.setAttribute("aria-label", "Collapse Components panel");
  button.setAttribute("aria-expanded", "true");

  let collapsed = false;
  let lastExpandedWidth =
    container.style.getPropertyValue("--palette-width") || "260px";
  const toggle = () => {
    collapsed = !collapsed;
    if (collapsed) {
      const current = container.style.getPropertyValue("--palette-width");
      if (current && current !== "28px") {
        lastExpandedWidth = current;
      }
      container.style.setProperty("--palette-width", "28px");
    } else {
      container.style.setProperty(
        "--palette-width",
        lastExpandedWidth || "260px",
      );
    }
    container.classList.toggle("is-palette-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute(
      "aria-label",
      collapsed ? "Expand Components panel" : "Collapse Components panel",
    );
    button.title = collapsed
      ? "Expand Components panel"
      : "Collapse Components panel";
  };

  button.addEventListener("click", toggle);
  container.appendChild(button);
}

/**
 * Make the form-js properties panel horizontally collapsible while keeping
 * the existing resize gutter available when it is expanded.
 */
export function setupPropertiesCollapse(
  container: HTMLElement,
  properties: HTMLElement,
): void {
  if (
    typeof container.querySelector !== "function" ||
    typeof properties.querySelector !== "function" ||
    typeof properties.appendChild !== "function"
  ) {
    return;
  }

  if (properties.querySelector(".fjs-properties-collapse-toggle")) {
    return;
  }

  const button = document.createElement("button");
  button.className = "fjs-properties-collapse-toggle";
  button.type = "button";
  button.title = "Collapse Properties panel";
  button.setAttribute("aria-label", "Collapse Properties panel");
  button.setAttribute("aria-expanded", "true");

  let collapsed = false;
  let lastExpandedWidth =
    container.style.getPropertyValue("--properties-width") || "280px";
  const toggle = () => {
    collapsed = !collapsed;
    if (collapsed) {
      const current = container.style.getPropertyValue("--properties-width");
      if (current && current !== "28px") {
        lastExpandedWidth = current;
      }
      container.style.setProperty("--properties-width", "28px");
    } else {
      container.style.setProperty(
        "--properties-width",
        lastExpandedWidth || "280px",
      );
    }
    container.classList.toggle("is-properties-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute(
      "aria-label",
      collapsed ? "Expand Properties panel" : "Collapse Properties panel",
    );
    button.title = collapsed
      ? "Expand Properties panel"
      : "Collapse Properties panel";
  };

  button.addEventListener("click", toggle);
  properties.appendChild(button);
}

/**
 * Set up non-destructive CSS Grid resizer gutters that do not mutate
 * Preact's internal DOM structure.
 */
export function setupResizers({ container, main }: ResizerElements): void {
  if (container.querySelector(".fjs-pgl-resizers")) {
    return;
  }

  if (!container.style.getPropertyValue("--col-left-pct")) {
    container.style.setProperty("--col-left-pct", "50%");
  }
  if (!container.style.getPropertyValue("--row-top-pct")) {
    container.style.setProperty("--row-top-pct", "65%");
  }
  if (!container.style.getPropertyValue("--properties-width")) {
    container.style.setProperty("--properties-width", "280px");
  }

  const overlay = document.createElement("div");
  overlay.className = "fjs-pgl-resizers";

  const mainResizers = document.createElement("div");
  mainResizers.className = "fjs-pgl-main-resizers";

  const gutterCol = document.createElement("div");
  gutterCol.className = "gutter gutter-horizontal gutter-col";
  gutterCol.title = "Resize columns";

  const gutterRow = document.createElement("div");
  gutterRow.className = "gutter gutter-vertical gutter-row";
  gutterRow.title = "Resize rows";

  mainResizers.appendChild(gutterCol);
  mainResizers.appendChild(gutterRow);
  overlay.appendChild(mainResizers);

  // Properties panel resizer
  const gutterProperties = document.createElement("div");
  gutterProperties.className = "gutter gutter-horizontal gutter-properties";
  gutterProperties.title = "Resize properties panel (double-click to reset)";
  overlay.appendChild(gutterProperties);

  container.appendChild(overlay);

  // Column resizer: adjust width ratio between left and right sections
  gutterCol.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    gutterCol.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing-col");

    const onPointerMove = (moveEvt: PointerEvent) => {
      const mainRect = main.getBoundingClientRect();
      if (mainRect.width > 0) {
        const offsetX = moveEvt.clientX - mainRect.left;
        const pct = Math.max(
          15,
          Math.min(85, (offsetX / mainRect.width) * 100),
        );
        container.style.setProperty("--col-left-pct", `${pct.toFixed(2)}%`);
      }
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      try {
        gutterCol.releasePointerCapture(upEvt.pointerId);
      } catch {
        // Ignore if already released
      }
      document.body.classList.remove("is-resizing-col");
      gutterCol.removeEventListener("pointermove", onPointerMove);
      gutterCol.removeEventListener("pointerup", onPointerUp);
      gutterCol.removeEventListener("pointercancel", onPointerUp);
    };

    gutterCol.addEventListener("pointermove", onPointerMove);
    gutterCol.addEventListener("pointerup", onPointerUp);
    gutterCol.addEventListener("pointercancel", onPointerUp);
  });

  // Row resizer: adjust height ratio between top and bottom sections
  gutterRow.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    gutterRow.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing-row");

    const onPointerMove = (moveEvt: PointerEvent) => {
      const mainRect = main.getBoundingClientRect();
      if (mainRect.height > 0) {
        const offsetY = moveEvt.clientY - mainRect.top;
        const pct = Math.max(
          15,
          Math.min(85, (offsetY / mainRect.height) * 100),
        );
        container.style.setProperty("--row-top-pct", `${pct.toFixed(2)}%`);
      }
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      try {
        gutterRow.releasePointerCapture(upEvt.pointerId);
      } catch {
        // Ignore if already released
      }
      document.body.classList.remove("is-resizing-row");
      gutterRow.removeEventListener("pointermove", onPointerMove);
      gutterRow.removeEventListener("pointerup", onPointerUp);
      gutterRow.removeEventListener("pointercancel", onPointerUp);
    };

    gutterRow.addEventListener("pointermove", onPointerMove);
    gutterRow.addEventListener("pointerup", onPointerUp);
    gutterRow.addEventListener("pointercancel", onPointerUp);
  });

  // Properties resizer: adjust properties panel width
  gutterProperties.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    gutterProperties.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing-properties");

    const onPointerMove = (moveEvt: PointerEvent) => {
      const containerRect =
        typeof container.getBoundingClientRect === "function"
          ? container.getBoundingClientRect()
          : { right: window.innerWidth, width: window.innerWidth };
      if (containerRect.width > 0) {
        const offsetX = containerRect.right - moveEvt.clientX;
        const maxAllowed = Math.min(600, Math.round(containerRect.width * 0.6));
        const width = Math.max(200, Math.min(maxAllowed, offsetX));
        container.style.setProperty(
          "--properties-width",
          `${Math.round(width)}px`,
        );
      }
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      try {
        gutterProperties.releasePointerCapture(upEvt.pointerId);
      } catch {
        // Ignore if already released
      }
      document.body.classList.remove("is-resizing-properties");
      gutterProperties.removeEventListener("pointermove", onPointerMove);
      gutterProperties.removeEventListener("pointerup", onPointerUp);
      gutterProperties.removeEventListener("pointercancel", onPointerUp);
    };

    gutterProperties.addEventListener("pointermove", onPointerMove);
    gutterProperties.addEventListener("pointerup", onPointerUp);
    gutterProperties.addEventListener("pointercancel", onPointerUp);
  });

  gutterProperties.addEventListener("dblclick", () => {
    container.style.setProperty("--properties-width", "280px");
  });
}

/**
 * Create a new form editor (playground) instance.
 */
export function createEditor(
  schema: string | undefined,
  onSchemaChangedCb?: () => void,
): Playground {
  const container = document.querySelector<HTMLElement>("#app");
  if (!container) {
    throw new Error("Could not find container element #app");
  }

  playground = new Playground({
    container,
    schema: schema ? JSON.parse(schema) : undefined,
    data: {},
  });

  // The resizers should be configured after the playground is first rendered.
  const onRendered = () => {
    const root = container.querySelector<HTMLElement>(".fjs-pgl-root");
    const palette = container.querySelector<HTMLElement>(
      ".fjs-pgl-palette-container",
    );
    const main = container.querySelector<HTMLElement>(".fjs-pgl-main");
    const properties = container.querySelector<HTMLElement>(
      ".fjs-pgl-properties-container",
    );
    const sections = main?.querySelectorAll<HTMLElement>(".fjs-pgl-section");

    const formDefinitionSection = Array.from(sections || []).find((s) =>
      s.textContent?.includes("Form Definition"),
    );
    const formPreviewSection = Array.from(sections || []).find((s) =>
      s.textContent?.includes("Form Preview"),
    );
    const formInputSection = Array.from(sections || []).find((s) =>
      s.textContent?.includes("Form Input"),
    );
    const formOutputSection = Array.from(sections || []).find((s) =>
      s.textContent?.includes("Form Output"),
    );

    if (
      root &&
      palette &&
      main &&
      properties &&
      formDefinitionSection &&
      formPreviewSection &&
      formInputSection &&
      formOutputSection
    ) {
      setupPaletteCollapse(container, palette);
      setupPropertiesCollapse(container, properties);
      setupResizers({ container, main });
    }

    // Subscribe to schema changes only after playground is initialized
    if (onSchemaChangedCb) {
      getEditor().getForm().on("import.done", onSchemaChangedCb);
    }

    // Remove the listener after the first execution
    playground?.off("formPlayground.rendered", onRendered);
  };

  playground.on("formPlayground.rendered", onRendered);

  return playground;
}

/**
 * Load a schema into the editor.
 * @throws Error if the editor is not initialized
 */
export async function loadSchema(schema: string): Promise<any> {
  return getEditor().getEditor().importSchema(JSON.parse(schema));
}

/**
 * Get the schema from the editor.
 * @throws Error if the editor is not initialized
 */
export function exportSchema(): object {
  return getEditor().getSchema();
}

/**
 * Get the editor instance.
 * @throws Error if the editor is not initialized
 */
function getEditor(): Playground {
  if (!playground) {
    throw new Error("Form editor is not initialized!");
  }
  return playground;
}
