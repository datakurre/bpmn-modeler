import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@bpmn-io/form-js-playground", () => ({
  Playground: vi.fn().mockImplementation(function () {
    const formMock = { on: vi.fn() };
    const editorMock = {
      importSchema: vi.fn().mockResolvedValue({
        warnings: [],
      }),
    };
    return {
      on: vi.fn(),
      off: vi.fn(),
      getForm: vi.fn(() => formMock),
      getEditor: vi.fn(() => editorMock),
      getSchema: vi.fn(() => ({
        type: "object",
        id: "Form_1",
      })),
    };
  }),
}));

describe("editor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("panel collapse controls", () => {
    it("should collapse and expand the Components panel", async () => {
      const listeners: Record<string, () => void> = {};
      const button = {
        addEventListener: vi.fn((event: string, handler: () => void) => {
          listeners[event] = handler;
        }),
        setAttribute: vi.fn(),
      };
      const container = {
        appendChild: vi.fn(),
        classList: { toggle: vi.fn() },
        querySelector: vi.fn(() => null),
        style: {
          getPropertyValue: vi.fn(() => ""),
          setProperty: vi.fn(),
        },
      };
      const palette = { querySelector: vi.fn(() => ({})) };

      vi.stubGlobal("document", {
        createElement: vi.fn(() => button),
      });

      const { setupPaletteCollapse } = await import("./editor");
      setupPaletteCollapse(container as any, palette as any);
      listeners.click();
      listeners.click();

      expect(container.style.setProperty).toHaveBeenNthCalledWith(
        1,
        "--palette-width",
        "28px",
      );
      expect(container.style.setProperty).toHaveBeenNthCalledWith(
        2,
        "--palette-width",
        "260px",
      );
      expect(container.classList.toggle).toHaveBeenNthCalledWith(
        1,
        "is-palette-collapsed",
        true,
      );
    });

    it("should collapse and expand the Properties panel", async () => {
      const listeners: Record<string, () => void> = {};
      const button = {
        addEventListener: vi.fn((event: string, handler: () => void) => {
          listeners[event] = handler;
        }),
        setAttribute: vi.fn(),
      };
      const container = {
        appendChild: vi.fn(),
        classList: { toggle: vi.fn() },
        querySelector: vi.fn(() => null),
        style: {
          getPropertyValue: vi.fn(() => ""),
          setProperty: vi.fn(),
        },
      };
      const properties = {
        appendChild: vi.fn(),
        querySelector: vi.fn(() => null),
      };

      vi.stubGlobal("document", {
        createElement: vi.fn(() => button),
      });

      const { setupPropertiesCollapse } = await import("./editor");
      setupPropertiesCollapse(container as any, properties as any);
      listeners.click();
      listeners.click();

      expect(container.style.setProperty).toHaveBeenNthCalledWith(
        1,
        "--properties-width",
        "28px",
      );
      expect(container.style.setProperty).toHaveBeenNthCalledWith(
        2,
        "--properties-width",
        "280px",
      );
      expect(container.classList.toggle).toHaveBeenNthCalledWith(
        1,
        "is-properties-collapsed",
        true,
      );
      expect(container.classList.toggle).toHaveBeenNthCalledWith(
        2,
        "is-properties-collapsed",
        false,
      );
    });
  });

  describe("createEditor", () => {
    it("should throw when container element is not found", async () => {
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => null),
      });

      const { createEditor } = await import("./editor");

      expect(() => createEditor(undefined)).toThrow(
        "Could not find container element #app",
      );
    });

    it("should create a Playground with parsed schema", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor } = await import("./editor");
      const result = createEditor('{"type":"object"}');

      expect(result).toBeDefined();
      expect(result.on).toBeDefined();
    });

    it("should create a Playground without schema", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor } = await import("./editor");
      const result = createEditor(undefined);

      expect(result).toBeDefined();
    });

    it("should register formPlayground.rendered event", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor } = await import("./editor");
      const playground = createEditor(undefined);

      expect(playground.on).toHaveBeenCalledWith(
        "formPlayground.rendered",
        expect.any(Function),
      );
    });

    it("should set up DOM layout without removing main element when all elements are found on render", async () => {
      const formDefSection = {
        textContent: "Form Definition",
      };
      const formPreviewSection = {
        textContent: "Form Preview",
      };
      const formInputSection = {
        textContent: "Form Input",
      };
      const formOutputSection = {
        textContent: "Form Output",
      };
      const sections = [
        formDefSection,
        formPreviewSection,
        formInputSection,
        formOutputSection,
      ];

      const root = { insertBefore: vi.fn() };
      const palette = { nextSibling: {} };
      const mainElement = {
        querySelectorAll: vi.fn(() => sections),
        remove: vi.fn(),
      };
      const properties = {};

      const container = {
        querySelector: vi.fn((selector: string) => {
          const map: Record<string, any> = {
            ".fjs-pgl-root": root,
            ".fjs-pgl-palette-container": palette,
            ".fjs-pgl-main": mainElement,
            ".fjs-pgl-properties-container": properties,
          };
          return map[selector] || null;
        }),
        style: {
          getPropertyValue: vi.fn(() => ""),
          setProperty: vi.fn(),
        },
        appendChild: vi.fn(),
      };

      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
        createElement: vi.fn(() => ({
          classList: { add: vi.fn() },
          appendChild: vi.fn(),
          addEventListener: vi.fn(),
        })),
      });

      const { createEditor } = await import("./editor");
      const playground = createEditor(undefined);

      // Get and invoke the rendered handler
      const renderedCall = vi
        .mocked(playground.on)
        .mock.calls.find((c) => c[0] === "formPlayground.rendered");
      expect(renderedCall).toBeDefined();
      (renderedCall![1] as any)();

      // Crucial: mainElement.remove must NOT be called so Preact's DOM remains intact
      expect(mainElement.remove).not.toHaveBeenCalled();
      expect(container.appendChild).toHaveBeenCalled();
      expect(container.style.setProperty).toHaveBeenCalledWith(
        "--col-left-pct",
        "50%",
      );
      expect(container.style.setProperty).toHaveBeenCalledWith(
        "--row-top-pct",
        "65%",
      );
      expect(container.style.setProperty).toHaveBeenCalledWith(
        "--properties-width",
        "280px",
      );
    });

    it("should skip layout when DOM elements are missing", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor } = await import("./editor");
      const playground = createEditor(undefined);

      const renderedCall = vi
        .mocked(playground.on)
        .mock.calls.find((c) => c[0] === "formPlayground.rendered");
      // Should not throw when elements are missing
      (renderedCall![1] as any)();
    });

    it("should skip layout when sections are incomplete", async () => {
      // Only provide root, palette, main, properties but NOT all sections
      const mainElement = {
        querySelectorAll: vi.fn(() => [
          { textContent: "Form Definition" },
          // Missing Form Preview, Form Input, Form Output
        ]),
        remove: vi.fn(),
      };

      const container = {
        querySelector: vi.fn((selector: string) => {
          const map: Record<string, any> = {
            ".fjs-pgl-root": {},
            ".fjs-pgl-palette-container": {},
            ".fjs-pgl-main": mainElement,
            ".fjs-pgl-properties-container": {},
          };
          return map[selector] || null;
        }),
        appendChild: vi.fn(),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor } = await import("./editor");
      const playground = createEditor(undefined);

      const renderedCall = vi
        .mocked(playground.on)
        .mock.calls.find((c) => c[0] === "formPlayground.rendered");
      (renderedCall![1] as any)();

      expect(container.appendChild).not.toHaveBeenCalled();
    });

    it("should register schema change callback on render", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor } = await import("./editor");
      const callback = vi.fn();
      const playground = createEditor(undefined, callback);

      const renderedCall = vi
        .mocked(playground.on)
        .mock.calls.find((c) => c[0] === "formPlayground.rendered");
      (renderedCall![1] as any)();

      expect(playground.getForm().on).toHaveBeenCalledWith(
        "import.done",
        callback,
      );
    });

    it("should not register callback when none provided", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor } = await import("./editor");
      const playground = createEditor(undefined);

      const renderedCall = vi
        .mocked(playground.on)
        .mock.calls.find((c) => c[0] === "formPlayground.rendered");
      (renderedCall![1] as any)();

      expect(playground.getForm().on).not.toHaveBeenCalled();
    });

    it("should unregister rendered listener after first render", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor } = await import("./editor");
      const playground = createEditor(undefined);

      const renderedCall = vi
        .mocked(playground.on)
        .mock.calls.find((c) => c[0] === "formPlayground.rendered");
      (renderedCall![1] as any)();

      expect(playground.off).toHaveBeenCalledWith(
        "formPlayground.rendered",
        expect.any(Function),
      );
    });
  });

  describe("setupResizers", () => {
    it("should skip when resizers are already installed", async () => {
      const container = {
        querySelector: vi.fn((sel: string) =>
          sel === ".fjs-pgl-resizers" ? {} : null,
        ),
        style: {
          getPropertyValue: vi.fn(() => "50%"),
          setProperty: vi.fn(),
        },
        appendChild: vi.fn(),
      };

      const { setupResizers } = await import("./editor");
      setupResizers({
        container: container as any,
        main: {} as any,
      });

      expect(container.appendChild).not.toHaveBeenCalled();
    });

    it("should handle column and row resizer drag interactions", async () => {
      const listeners: Record<string, Function[]> = {};
      const makeMockElement = () => ({
        classList: { add: vi.fn(), remove: vi.fn() },
        appendChild: vi.fn(),
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
        addEventListener: vi.fn((event: string, fn: Function) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(fn);
        }),
        removeEventListener: vi.fn((event: string, fn: Function) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter((f) => f !== fn);
          }
        }),
      });

      const elements: any[] = [];
      vi.stubGlobal("document", {
        createElement: vi.fn(() => {
          const el = makeMockElement();
          elements.push(el);
          return el;
        }),
        body: {
          classList: { add: vi.fn(), remove: vi.fn() },
        },
      });

      const propsSet: Record<string, string> = {};
      const container = {
        querySelector: vi.fn(() => null),
        style: {
          getPropertyValue: vi.fn((prop: string) => propsSet[prop] || ""),
          setProperty: vi.fn((prop: string, val: string) => {
            propsSet[prop] = val;
          }),
        },
        appendChild: vi.fn(),
      };

      const main = {
        getBoundingClientRect: vi.fn(() => ({
          left: 100,
          top: 50,
          width: 500,
          height: 400,
        })),
      };

      const { setupResizers } = await import("./editor");
      setupResizers({
        container: container as any,
        main: main as any,
      });

      // Gutter elements were created:
      // elements[0] = overlay, elements[1] = mainResizers
      // elements[2] = gutterCol, elements[3] = gutterRow
      const gutterCol = elements[2];
      const gutterRow = elements[3];

      // Test gutterCol drag
      const colDown = gutterCol.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointerdown",
      )[1];
      colDown({
        preventDefault: vi.fn(),
        pointerId: 1,
      });
      expect(gutterCol.setPointerCapture).toHaveBeenCalledWith(1);

      const colMove = gutterCol.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointermove",
      )[1];
      colMove({ clientX: 350 }); // (350 - 100) / 500 = 50%
      expect(container.style.setProperty).toHaveBeenCalledWith(
        "--col-left-pct",
        "50.00%",
      );

      const colUp = gutterCol.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointerup",
      )[1];
      colUp({ pointerId: 1 });
      expect(gutterCol.releasePointerCapture).toHaveBeenCalledWith(1);

      // Test gutterRow drag
      const rowDown = gutterRow.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointerdown",
      )[1];
      rowDown({
        preventDefault: vi.fn(),
        pointerId: 2,
      });
      expect(gutterRow.setPointerCapture).toHaveBeenCalledWith(2);

      const rowMove = gutterRow.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointermove",
      )[1];
      rowMove({ clientY: 250 }); // (250 - 50) / 400 = 50%
      expect(container.style.setProperty).toHaveBeenCalledWith(
        "--row-top-pct",
        "50.00%",
      );

      const rowUp = gutterRow.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointerup",
      )[1];
      rowUp({ pointerId: 2 });
      expect(gutterRow.releasePointerCapture).toHaveBeenCalledWith(2);

      // Test gutterProperties drag & dblclick
      // elements[4] is gutterProperties
      const gutterProperties = elements[4];
      expect(gutterProperties).toBeDefined();

      (container as any).getBoundingClientRect = vi.fn(() => ({
        right: 1000,
        width: 1000,
      }));

      const propDown = gutterProperties.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointerdown",
      )[1];
      propDown({
        preventDefault: vi.fn(),
        pointerId: 3,
      });
      expect(gutterProperties.setPointerCapture).toHaveBeenCalledWith(3);

      const propMove = gutterProperties.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointermove",
      )[1];
      propMove({ clientX: 650 }); // 1000 - 650 = 350px
      expect(container.style.setProperty).toHaveBeenCalledWith(
        "--properties-width",
        "350px",
      );

      const propUp = gutterProperties.addEventListener.mock.calls.find(
        (c: any) => c[0] === "pointerup",
      )[1];
      propUp({ pointerId: 3 });
      expect(gutterProperties.releasePointerCapture).toHaveBeenCalledWith(3);

      const propDblClick = gutterProperties.addEventListener.mock.calls.find(
        (c: any) => c[0] === "dblclick",
      )[1];
      propDblClick();
      expect(container.style.setProperty).toHaveBeenCalledWith(
        "--properties-width",
        "280px",
      );
    });
  });

  describe("loadSchema", () => {
    it("should throw when editor is not initialized", async () => {
      const { loadSchema } = await import("./editor");

      await expect(loadSchema('{"type":"object"}')).rejects.toThrow(
        "Form editor is not initialized!",
      );
    });

    it("should load and parse schema when editor is initialized", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor, loadSchema } = await import("./editor");
      const playground = createEditor(undefined);
      await loadSchema('{"type":"object"}');

      expect(playground.getEditor().importSchema).toHaveBeenCalledWith({
        type: "object",
      });
    });
  });

  describe("exportSchema", () => {
    it("should throw when editor is not initialized", async () => {
      const { exportSchema } = await import("./editor");

      expect(() => exportSchema()).toThrow("Form editor is not initialized!");
    });

    it("should return schema when editor is initialized", async () => {
      const container = {
        querySelector: vi.fn(() => null),
      };
      vi.stubGlobal("document", {
        querySelector: vi.fn(() => container),
      });

      const { createEditor, exportSchema } = await import("./editor");
      createEditor(undefined);

      const schema = exportSchema();
      expect(schema).toEqual({
        type: "object",
        id: "Form_1",
      });
    });
  });
});
