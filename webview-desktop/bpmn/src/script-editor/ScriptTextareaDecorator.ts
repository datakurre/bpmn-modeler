/**
 * Script Textarea Decorator — bpmn-js module.
 *
 * Watches the properties panel DOM for script textareas and injects
 * a small ↗ badge icon that opens the script in a VS Code temp file.
 * Provides continuous bidirectional sync between the textarea and
 * the temp file.
 *
 * Supports any textarea whose `name` attribute ends with `scriptValue`,
 * which covers:
 * - `bpmn:ScriptTask` script body (`scriptValue`)
 * - Conditional sequence flow scripts (`conditionScriptValue`)
 * - Execution / task listener scripts (prefixed `scriptValue`)
 * - Input / output parameter scripts (prefixed `scriptValue`)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VsCodeApi {
    postMessage(msg: unknown): void;
}

interface TrackedTextarea {
    readonly textarea: HTMLTextAreaElement;
    readonly badge: HTMLElement;
    readonly inputHandler: () => void;
}

// ---------------------------------------------------------------------------
// Exported helpers (pure, testable)
// ---------------------------------------------------------------------------

/**
 * CSS selector that matches all script-body textareas in the panel.
 *
 * Both `scriptValue` and `conditionScriptValue` end with `scriptValue`,
 * so a single `$=` selector covers every variant including prefixed ones
 * generated for listeners and I/O parameters.
 */
export const SCRIPT_TEXTAREA_SELECTOR = 'textarea[name$="scriptValue"]';

/**
 * Detect the script format/language for a given script textarea by looking
 * at the sibling format / language input field in the DOM.
 */
export function detectScriptFormat(textarea: HTMLTextAreaElement): string {
    const panel =
        textarea.closest("#js-properties-panel") ?? document.getElementById("js-properties-panel");
    if (!panel) return "";

    const name = textarea.name;

    // Condition scripts: format is stored in `conditionScriptLanguage`
    if (name.endsWith("conditionScriptValue")) {
        const prefix = name.slice(0, -"conditionScriptValue".length);
        const langInput = panel.querySelector<HTMLInputElement>(
            `input[name="${prefix}conditionScriptLanguage"]`,
        );
        return langInput?.value ?? "";
    }

    // Regular scripts (ScriptTask, listener, I/O parameter):
    // format is stored in `scriptFormat`
    if (name.endsWith("scriptValue")) {
        const prefix = name.slice(0, -"scriptValue".length);
        const formatInput = panel.querySelector<HTMLInputElement>(
            `input[name="${prefix}scriptFormat"]`,
        );
        return formatInput?.value ?? "";
    }

    return "";
}

/**
 * Create the badge button element (↗) that opens the script in VS Code.
 */
export function createBadge(): HTMLButtonElement {
    const badge = document.createElement("button");
    badge.className = "script-editor-badge";
    badge.type = "button";
    badge.title = "Edit in VS Code";
    badge.textContent = "\u2197"; // ↗
    return badge;
}

/**
 * Detect the script context from a textarea's property path name.
 *
 * Task-listener scripts get the `task` context; everything else
 * (script tasks, execution listeners, conditions, I/O parameters) gets
 * `execution`.
 */
export function detectScriptContext(propertyPath: string): "execution" | "task" {
    if (propertyPath.toLowerCase().includes("tasklistener")) {
        return "task";
    }
    return "execution";
}

// ---------------------------------------------------------------------------
// Service class (bpmn-js injectable)
// ---------------------------------------------------------------------------

export class ScriptTextareaDecorator {
    public static $inject: string[];

    private vscode: VsCodeApi | undefined;
    private elementRegistry: any;
    private commandStack: any;
    private observer: MutationObserver | undefined;
    private currentElementId: string | undefined;
    private tracked = new Map<string, TrackedTextarea>();
    /** Guard to prevent feedback loops during extension → textarea sync. */
    private updatingFromExtension = false;

    constructor(eventBus: any, elementRegistry: any, commandStack: any) {
        this.elementRegistry = elementRegistry;
        this.commandStack = commandStack;

        // Track the currently selected element
        eventBus.on("selection.changed", (e: any) => {
            const sel: any[] = e.newSelection ?? [];
            this.currentElementId = sel.length === 1 ? sel[0].id : undefined;
        });

        // Start observing the properties panel DOM
        this.startObserving();
    }

    // -- Public API ----------------------------------------------------------

    /** Store a reference to the VS Code webview postMessage API. */
    setVsCodeApi(api: VsCodeApi): void {
        this.vscode = api;
    }

    /**
     * Apply an updated script body coming from the VS Code temp file.
     *
     * Tries a direct DOM update first (textarea visible).  Falls back to the
     * bpmn-js command stack for `scriptValue` when the textarea is not in the
     * DOM (e.g. a different element is selected).
     */
    updateFromExtension(elementId: string, scriptBody: string, propertyPath: string): void {
        // Try direct DOM update when the element is currently selected
        const panel = document.getElementById("js-properties-panel");
        if (panel && this.currentElementId === elementId) {
            const textarea = panel.querySelector<HTMLTextAreaElement>(
                `textarea[name="${propertyPath}"]`,
            );
            if (textarea && textarea.value !== scriptBody) {
                this.updatingFromExtension = true;
                try {
                    // Use the native setter so that Preact's controlled
                    // input handling picks up the change.
                    const setter = Object.getOwnPropertyDescriptor(
                        HTMLTextAreaElement.prototype,
                        "value",
                    )?.set;
                    if (setter) {
                        setter.call(textarea, scriptBody);
                    } else {
                        textarea.value = scriptBody;
                    }
                    textarea.dispatchEvent(new Event("input", { bubbles: true }));
                } finally {
                    this.updatingFromExtension = false;
                }
                return;
            }
        }

        // Fall back: update the BPMN model directly via the command stack.
        // Currently only the ScriptTask `scriptValue` property is supported
        // here; listener / condition scripts require the textarea to be
        // visible for DOM-based sync.
        if (propertyPath === "scriptValue") {
            const element = this.elementRegistry.get(elementId);
            if (element) {
                const bo = element.businessObject ?? element;
                this.commandStack.execute("element.updateProperties", {
                    element,
                    moddleElement: bo,
                    properties: { script: scriptBody },
                });
            }
        }
    }

    // -- Private: DOM observation -------------------------------------------

    private startObserving(): void {
        // Defer to allow the properties panel DOM to be created
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(() => this.attachObserver());
        } else {
            setTimeout(() => this.attachObserver(), 0);
        }
    }

    private attachObserver(): void {
        const panel = document.getElementById("js-properties-panel");
        if (!panel) return;

        this.observer = new MutationObserver(() => this.scan());
        this.observer.observe(panel, { childList: true, subtree: true });

        // Initial scan
        this.scan();
    }

    /**
     * Scan the properties panel for script textareas and decorate any
     * new ones.  Removes stale tracked entries for textareas that have
     * been removed from the DOM or replaced by Preact re-renders.
     */
    private scan(): void {
        const panel = document.getElementById("js-properties-panel");
        if (!panel) return;

        const textareas = Array.from(
            panel.querySelectorAll<HTMLTextAreaElement>(SCRIPT_TEXTAREA_SELECTOR),
        );

        // Build a set of live textarea DOM nodes for quick lookup
        const liveSet = new Set<HTMLTextAreaElement>(textareas);

        // First pass: clean up entries whose textarea has been removed or
        // replaced by a new DOM node (Preact re-render).
        for (const [key, entry] of this.tracked) {
            if (!liveSet.has(entry.textarea)) {
                entry.textarea.removeEventListener("input", entry.inputHandler);
                entry.badge.remove();
                this.tracked.delete(key);
            }
        }

        // Second pass: decorate any new textareas that aren't tracked yet.
        for (const textarea of textareas) {
            const key = textarea.name;
            if (!this.tracked.has(key)) {
                this.decorate(textarea);
            }
        }
    }

    // -- Private: decoration ------------------------------------------------

    private decorate(textarea: HTMLTextAreaElement): void {
        const badge = createBadge();

        // Place the badge inside the textarea wrapper, positioned absolutely
        const wrapper = textarea.closest(".bio-properties-panel-textarea");
        if (wrapper) {
            (wrapper as HTMLElement).style.position = "relative";
            wrapper.appendChild(badge);
        }

        // Click → open in VS Code editor
        badge.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onBadgeClick(textarea);
        });

        // Textarea input → sync to extension (textarea → temp file)
        const inputHandler = () => {
            if (this.updatingFromExtension) return;
            this.onTextareaInput(textarea);
        };
        textarea.addEventListener("input", inputHandler);

        this.tracked.set(textarea.name, { textarea, badge, inputHandler });
    }

    // -- Private: event handlers --------------------------------------------

    private onBadgeClick(textarea: HTMLTextAreaElement): void {
        if (!this.vscode) {
            console.warn("[ScriptTextareaDecorator] badge clicked but vscode API not set");
            return;
        }
        if (!this.currentElementId) {
            console.warn("[ScriptTextareaDecorator] badge clicked but no element selected");
            return;
        }

        const scriptFormat = detectScriptFormat(textarea);
        const scriptContext = detectScriptContext(textarea.name);
        const msg = {
            type: "openScriptEditor",
            elementId: this.currentElementId,
            scriptFormat,
            scriptBody: textarea.value,
            propertyPath: textarea.name,
            scriptContext,
        };
        console.log("[ScriptTextareaDecorator] posting openScriptEditor", msg);
        this.vscode.postMessage(msg);
    }

    private onTextareaInput(textarea: HTMLTextAreaElement): void {
        if (!this.vscode || !this.currentElementId) return;

        this.vscode.postMessage({
            type: "scriptTextareaChanged",
            elementId: this.currentElementId,
            scriptBody: textarea.value,
            propertyPath: textarea.name,
        });
    }
}

ScriptTextareaDecorator.$inject = ["eventBus", "elementRegistry", "commandStack"];
