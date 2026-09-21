/**
 * Evaluation Panel — UI for DMN evaluation mode in the webview.
 *
 * Auto-generates input forms from decision table inputs, runs evaluation,
 * and displays results.
 */

import {
    parseDmnXml,
    parseCSV,
    getDependencies,
    exportBatchAsJSON,
    exportBatchAsCSV,
    exportTraceAsJSON,
    type DmnModel,
    type DmnDecision,
    type DmnInput,
    type EvaluationTrace,
    type BatchRow,
} from "./engine";
import { evaluateDecisionWithOperaton } from "./engine/operaton-dmn";
import { evaluateDecisionTs } from "./engine/ts-fallback";
import {
    highlightDecisions,
    clearDecisionHighlights,
    animateDecisions,
    type AnimationController,
} from "./drd-overlay";
import {
    getModelerInstance,
    navigateToDecisionTable,
    highlightMatchedRules,
    clearMatchedRuleHighlights,
} from "./modeler";
import { EditorView, basicSetup } from "codemirror";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorSelection } from "@codemirror/state";

// Syntax highlight style that reads VS Code CSS variables, so it looks correct
// in both light and dark themes without any JavaScript theme-switching logic.
const vscodeJsonHighlight = HighlightStyle.define([
    {
        tag: tags.propertyName,
        color: "var(--vscode-symbolIcon-keyForeground, #0451a5)",
    },
    {
        tag: tags.string,
        color: "var(--vscode-debugTokenExpression-string, #a31515)",
    },
    {
        tag: tags.number,
        color: "var(--vscode-debugTokenExpression-number, #098658)",
    },
    {
        tag: [tags.bool, tags.null],
        color: "var(--vscode-debugTokenExpression-boolean, #0000ff)",
    },
]);

// ── State ───────────────────────────────────────────────────────────

let currentModel: DmnModel | null = null;
let lastTrace: EvaluationTrace[] = [];
let lastBatchResults: BatchRow[] = [];
let whatIfOverrides: Record<string, unknown> = {};
let panelVisible = false;
let drdOverlaysVisible = false;
let currentAnimation: AnimationController | null = null;

// ── DOM References ──────────────────────────────────────────────────

let panelEl: HTMLElement;
let decisionSelectEl: HTMLSelectElement;
let inputFormEl: HTMLFormElement;
let evaluateBtnEl: HTMLButtonElement;
let resultEl: HTMLElement;
let batchEditorView: EditorView | null = null;
let batchBtnEl: HTMLButtonElement;
let batchExportCsvEl: HTMLButtonElement;
let batchExportJsonEl: HTMLButtonElement;
let batchResultEl: HTMLElement;
let toggleBtnEl: HTMLButtonElement;
let whatIfSectionEl: HTMLElement;
let drdSectionEl: HTMLElement;
let animPlayBtnEl: HTMLButtonElement;
let animPauseBtnEl: HTMLButtonElement;
let animStopBtnEl: HTMLButtonElement;
let animStepFwdBtnEl: HTMLButtonElement;
let animStepBkBtnEl: HTMLButtonElement;
let drdToggleOverlaysBtnEl: HTMLButtonElement;
let drdResetBtnEl: HTMLButtonElement;

// ── Initialization ──────────────────────────────────────────────────

/** Callback used to post messages back to the VS Code extension. */
let postToExtension: ((msg: unknown) => void) | undefined;

/**
 * Create and mount the evaluation panel.
 */
export function createEvaluationPanel(
    container: HTMLElement,
    sendMessage?: (msg: unknown) => void
): {
    toggle: () => void;
    updateDmn: (xml: string) => Promise<void>;
    isVisible: () => boolean;
    handleMessage: (msg: unknown) => void;
} {
    postToExtension = sendMessage;
    // Create toggle button
    toggleBtnEl = document.createElement("button");
    toggleBtnEl.id = "eval-toggle";
    toggleBtnEl.textContent = "▶ Evaluate";
    toggleBtnEl.title = "Toggle evaluation panel";
    toggleBtnEl.addEventListener("click", togglePanel);
    container.parentElement?.insertBefore(toggleBtnEl, container);

    // Create panel
    panelEl = document.createElement("div");
    panelEl.id = "evaluation-panel";
    panelEl.className = "evaluation-panel hidden";
    panelEl.innerHTML = `
        <div class="eval-resize-handle" id="eval-resize-handle" title="Drag to resize"></div>
        <div class="eval-panel-content">
            <div class="eval-header">
                <h3>Evaluate Decision</h3>
                <button id="eval-close" title="Close evaluation panel">✕</button>
            </div>
            <div class="eval-section">
                <label for="decision-select">Decision:</label>
                <select id="decision-select" disabled>
                    <option value="">— Load a DMN file —</option>
                </select>
            </div>
            <div class="eval-section">
                <h4>Input Values</h4>
                <form id="eval-input-form">
                    <p class="eval-hint">Select a decision to see inputs</p>
                </form>
            </div>
            <details class="eval-section" id="eval-whatif-section">
                <summary>What-If Overrides</summary>
                <p class="eval-hint">Override intermediate decision results:</p>
                <div id="eval-whatif-fields"></div>
            </details>
            <div class="eval-actions">
                <button id="eval-run" disabled>▶ Evaluate</button>
            </div>
            <div class="eval-section">
                <h4>Result</h4>
                <button id="eval-clear-highlights" class="eval-clear-highlights hidden">✕ Clear Highlights</button>
                <div id="eval-result" class="eval-result">
                    <p class="eval-hint">Run evaluation to see results</p>
                </div>
            </div>
            <details class="eval-section eval-batch-section">
                <summary>Batch Evaluation</summary>
                <p class="eval-hint">Enter JSON array or CSV with headers:</p>
                <div id="eval-batch-input" class="eval-batch-editor"></div>
                <div class="eval-actions">
                    <button id="eval-batch-add-row" title="Add a row (or initialise with input template)">＋ Add Row</button>
                    <button id="eval-batch-run" disabled>▶ Run Batch</button>
                    <button id="eval-batch-open-editor" title="Open batch input in VS Code editor">↗ Open in Editor</button>
                    <button id="eval-batch-export-csv" class="eval-export-btn" disabled title="Export results as CSV">⬇ CSV</button>
                    <button id="eval-batch-export-json" class="eval-export-btn" disabled title="Export results as JSON">⬇ JSON</button>
                </div>
                <div id="eval-batch-result" class="eval-result"></div>
            </details>
            <details class="eval-section eval-drd-section" id="eval-drd-section">
                <summary>DRD Controls</summary>
                <div id="eval-drd-controls" class="eval-drd-controls">
                    <button id="eval-drd-toggle-overlays" title="Show/hide evaluation overlays" disabled>👁 Overlays</button>
                    <button id="eval-drd-reset" title="Clear all DRD highlights" disabled>🔄 Reset</button>
                </div>
                <div class="eval-drd-animation">
                    <p class="eval-hint">Step-through animation:</p>
                    <div class="eval-actions">
                        <button id="eval-anim-step-bk" title="Step backward" disabled>⏮</button>
                        <button id="eval-anim-play" title="Play animation" disabled>▶</button>
                        <button id="eval-anim-pause" title="Pause animation" disabled>⏸</button>
                        <button id="eval-anim-stop" title="Stop animation" disabled>⏹</button>
                        <button id="eval-anim-step-fwd" title="Step forward" disabled>⏭</button>
                    </div>
                </div>
            </details>
        </div>
    `;
    container.appendChild(panelEl);

    // ── Resize handle ────────────────────────────────────────────────
    const resizeHandle = panelEl.querySelector(
        "#eval-resize-handle"
    ) as HTMLElement;
    let isResizing = false;
    let resizeStartX = 0;
    let resizeStartWidth = 0;

    function onResizeMove(e: MouseEvent) {
        if (!isResizing) return;
        // Panel is on the right; dragging left increases width
        const dx = resizeStartX - e.clientX;
        const newWidth = Math.min(900, Math.max(200, resizeStartWidth + dx));
        panelEl.style.width = `${newWidth}px`;
    }

    function onResizeEnd() {
        if (!isResizing) return;
        isResizing = false;
        resizeHandle.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onResizeMove);
        document.removeEventListener("mouseup", onResizeEnd);
    }

    resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
        isResizing = true;
        resizeStartX = e.clientX;
        resizeStartWidth = panelEl.getBoundingClientRect().width;
        resizeHandle.classList.add("dragging");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", onResizeMove);
        document.addEventListener("mouseup", onResizeEnd);
        e.preventDefault();
    });

    // Bind references
    decisionSelectEl = panelEl.querySelector(
        "#decision-select"
    ) as HTMLSelectElement;
    inputFormEl = panelEl.querySelector("#eval-input-form") as HTMLFormElement;
    evaluateBtnEl = panelEl.querySelector("#eval-run") as HTMLButtonElement;
    resultEl = panelEl.querySelector("#eval-result") as HTMLElement;
    const clearHighlightsBtnEl = panelEl.querySelector(
        "#eval-clear-highlights"
    ) as HTMLButtonElement;
    batchBtnEl = panelEl.querySelector("#eval-batch-run") as HTMLButtonElement;
    batchExportCsvEl = panelEl.querySelector(
        "#eval-batch-export-csv"
    ) as HTMLButtonElement;
    batchExportJsonEl = panelEl.querySelector(
        "#eval-batch-export-json"
    ) as HTMLButtonElement;
    batchResultEl = panelEl.querySelector("#eval-batch-result") as HTMLElement;

    // Set up CodeMirror editor for batch input
    const batchInputEl = panelEl.querySelector(
        "#eval-batch-input"
    ) as HTMLElement;
    const conditionalJsonLinter = linter((view) => {
        const content = view.state.doc.toString().trim();
        if (!content.startsWith("[") && !content.startsWith("{")) return [];
        return jsonParseLinter()(view);
    });
    batchEditorView = new EditorView({
        doc: "",
        extensions: [
            basicSetup,
            json(),
            syntaxHighlighting(vscodeJsonHighlight),
            conditionalJsonLinter,
            lintGutter(),
            EditorView.theme({
                "&": {
                    fontSize: "11px",
                    maxHeight: "160px",
                },
                ".cm-scroller": {
                    overflow: "auto",
                    fontFamily: "var(--vscode-editor-font-family, monospace)",
                },
                ".cm-content": {
                    fontFamily: "var(--vscode-editor-font-family, monospace)",
                },
                ".cm-focused": { outline: "none" },
            }),
        ],
        parent: batchInputEl,
    });

    whatIfSectionEl = panelEl.querySelector(
        "#eval-whatif-fields"
    ) as HTMLElement;

    // DRD controls
    drdSectionEl = panelEl.querySelector("#eval-drd-section") as HTMLElement;
    drdToggleOverlaysBtnEl = panelEl.querySelector(
        "#eval-drd-toggle-overlays"
    ) as HTMLButtonElement;
    drdResetBtnEl = panelEl.querySelector(
        "#eval-drd-reset"
    ) as HTMLButtonElement;
    animPlayBtnEl = panelEl.querySelector(
        "#eval-anim-play"
    ) as HTMLButtonElement;
    animPauseBtnEl = panelEl.querySelector(
        "#eval-anim-pause"
    ) as HTMLButtonElement;
    animStopBtnEl = panelEl.querySelector(
        "#eval-anim-stop"
    ) as HTMLButtonElement;
    animStepFwdBtnEl = panelEl.querySelector(
        "#eval-anim-step-fwd"
    ) as HTMLButtonElement;
    animStepBkBtnEl = panelEl.querySelector(
        "#eval-anim-step-bk"
    ) as HTMLButtonElement;

    const closeBtn = panelEl.querySelector("#eval-close") as HTMLButtonElement;
    const batchOpenEditorBtnEl = panelEl.querySelector(
        "#eval-batch-open-editor"
    ) as HTMLButtonElement;
    const batchAddRowBtnEl = panelEl.querySelector(
        "#eval-batch-add-row"
    ) as HTMLButtonElement;

    // Event listeners
    closeBtn.addEventListener("click", togglePanel);
    clearHighlightsBtnEl.addEventListener("click", clearHighlights);
    decisionSelectEl.addEventListener("change", onDecisionChanged);
    evaluateBtnEl.addEventListener("click", runEvaluation);
    batchBtnEl.addEventListener("click", runBatchEvaluation);
    batchOpenEditorBtnEl.addEventListener("click", openBatchInEditor);
    batchAddRowBtnEl.addEventListener("click", addBatchRow);
    batchExportCsvEl.addEventListener("click", () =>
        downloadFile(
            "batch-results.csv",
            exportBatchAsCSV(lastBatchResults),
            "text/csv"
        )
    );
    batchExportJsonEl.addEventListener("click", () =>
        downloadFile(
            "batch-results.json",
            exportBatchAsJSON(lastBatchResults),
            "application/json"
        )
    );

    inputFormEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            runEvaluation();
        }
    });

    // DRD controls event listeners
    drdToggleOverlaysBtnEl.addEventListener("click", toggleDrdOverlays);
    drdResetBtnEl.addEventListener("click", resetDrdHighlights);
    animPlayBtnEl.addEventListener("click", playAnimation);
    animPauseBtnEl.addEventListener("click", pauseAnimation);
    animStopBtnEl.addEventListener("click", stopAnimation);
    animStepFwdBtnEl.addEventListener("click", stepAnimationForward);
    animStepBkBtnEl.addEventListener("click", stepAnimationBackward);

    return {
        toggle: togglePanel,
        updateDmn,
        isVisible: () => panelVisible,
        handleMessage,
    };
}

// ── Panel Toggle ────────────────────────────────────────────────────

function togglePanel() {
    panelVisible = !panelVisible;
    panelEl.classList.toggle("hidden", !panelVisible);
    toggleBtnEl.classList.toggle("active", panelVisible);
}

// ── DMN Update ──────────────────────────────────────────────────────

async function updateDmn(xml: string) {
    if (!xml || xml.trim() === "") return;

    try {
        currentModel = await parseDmnXml(xml);
        populateDecisionSelector();
    } catch (err) {
        console.warn("Failed to parse DMN for evaluation:", err);
        currentModel = null;
    }
}

function populateDecisionSelector() {
    if (!currentModel) return;

    const previouslySelected = decisionSelectEl.value;

    decisionSelectEl.innerHTML = "";

    if (currentModel.decisions.size === 0) {
        decisionSelectEl.innerHTML =
            '<option value="">— No decisions found —</option>';
        decisionSelectEl.disabled = true;
        return;
    }

    for (const [id, decision] of currentModel.decisions) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = decision.name || id;
        if (id === previouslySelected) {
            option.selected = true;
        }
        decisionSelectEl.appendChild(option);
    }

    decisionSelectEl.disabled = false;
    evaluateBtnEl.disabled = false;
    batchBtnEl.disabled = false;

    // Hide DRD controls when there is only a single decision (no DRD to visualise)
    drdSectionEl.style.display =
        currentModel.decisions.size <= 1 ? "none" : "";

    onDecisionChanged();
}

// ── Decision Changed ────────────────────────────────────────────────

function onDecisionChanged() {
    const decisionId = decisionSelectEl.value;
    if (!decisionId || !currentModel) return;

    const decision = currentModel.decisions.get(decisionId);
    if (!decision) return;

    buildInputForm(decision);
    buildWhatIfFields(decisionId);
}

function buildInputForm(decision: DmnDecision) {
    // Preserve values the user has already typed, keyed by input name
    const savedValues: Record<string, string> = {};
    inputFormEl.querySelectorAll<HTMLInputElement>("input").forEach((el) => {
        if (el.name && el.value) savedValues[el.name] = el.value;
    });

    inputFormEl.innerHTML = "";

    if (!decision.logic) {
        inputFormEl.innerHTML =
            '<p class="eval-hint">Decision has no logic</p>';
        return;
    }

    let inputs: DmnInput[] = [];

    if (decision.logic.type === "decisionTable") {
        inputs = decision.logic.inputs;
    } else if (decision.logic.type === "literalExpression") {
        // Extract variable names from expression (best-effort)
        const vars = extractExpressionVariables(decision.logic.expression);
        inputs = vars.map((v) => ({
            id: `var_${v}`,
            label: v,
            expression: v,
            typeRef: undefined,
        }));
    }

    if (inputs.length === 0) {
        inputFormEl.innerHTML = '<p class="eval-hint">No inputs required</p>';
        return;
    }

    for (const input of inputs) {
        const div = document.createElement("div");
        div.className = "eval-field";

        const label = document.createElement("label");
        label.textContent = input.label || input.expression || input.id;
        label.htmlFor = `eval-input-${input.id}`;
        if (input.typeRef) {
            const typeTag = document.createElement("span");
            typeTag.className = "eval-type-tag";
            typeTag.textContent = input.typeRef;
            label.appendChild(typeTag);
        }
        div.appendChild(label);

        const inputEl = document.createElement("input");
        inputEl.type = getInputType(input.typeRef);
        inputEl.id = `eval-input-${input.id}`;
        inputEl.name = input.expression || input.label;
        inputEl.placeholder = input.typeRef || "value";
        if (input.typeRef) {
            inputEl.dataset.typeRef = input.typeRef;
        }
        // Restore previously typed value if the column name is unchanged
        const savedKey = input.expression || input.label;
        if (savedValues[savedKey] !== undefined) {
            inputEl.value = savedValues[savedKey];
        }
        div.appendChild(inputEl);

        inputFormEl.appendChild(div);
    }
}

function getInputType(typeRef?: string): string {
    if (!typeRef) return "text";
    switch (typeRef.toLowerCase()) {
        case "integer":
        case "long":
        case "double":
            return "number";
        case "boolean":
            return "text"; // use text to allow "true"/"false"
        case "date":
            return "date";
        default:
            return "text";
    }
}

/**
 * Extract variable names from a FEEL expression (best-effort heuristic).
 *
 * Improvements over naive regex:
 * - Skips property names on dot-access (e.g. `person.age` → only `person`)
 * - Extended reserved set covers FEEL keywords and built-in function names
 */
function extractExpressionVariables(expression: string): string[] {
    // FEEL keywords and built-in function names that are not user variables
    const reserved = new Set([
        // keywords
        "if",
        "then",
        "else",
        "for",
        "in",
        "return",
        "some",
        "every",
        "satisfies",
        "and",
        "or",
        "not",
        "true",
        "false",
        "null",
        "function",
        "external",
        "instance",
        "of",
        "between",
        // built-in functions (single-word)
        "count",
        "min",
        "max",
        "sum",
        "mean",
        "all",
        "any",
        "append",
        "reverse",
        "flatten",
        "product",
        "median",
        "stddev",
        "mode",
        "decimal",
        "floor",
        "ceiling",
        "abs",
        "sqrt",
        "log",
        "exp",
        "even",
        "odd",
        "modulo",
        "string",
        "number",
        "duration",
        "date",
        "time",
        "context",
        "range",
        "now",
        "today",
        "contains",
        "matches",
        "replace",
        "split",
        "type",
    ]);

    // Remove dot-accessed property names so they are not mistaken for variables.
    // e.g. "person.age" → "person" stays; "age" is removed.
    const withoutDotProps = expression.replace(/\.[a-zA-Z_]\w*/g, "");

    const matches = withoutDotProps.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);
    if (!matches) return [];

    const unique = [...new Set(matches)].filter((m) => !reserved.has(m));
    return unique;
}

// ── What-If Analysis ────────────────────────────────────────────────

/**
 * Build what-if override fields for the intermediate DRG decisions.
 */
function buildWhatIfFields(decisionId: string) {
    whatIfSectionEl.innerHTML = "";
    whatIfOverrides = {};

    if (!currentModel) return;

    const deps = getDependencies(currentModel, decisionId);
    if (deps.length === 0) {
        whatIfSectionEl.innerHTML =
            '<p class="eval-hint">No intermediate decisions</p>';
        return;
    }

    for (const depId of deps) {
        const depDecision = currentModel.decisions.get(depId);
        if (!depDecision) continue;

        const div = document.createElement("div");
        div.className = "eval-field eval-whatif-field";

        const label = document.createElement("label");
        label.textContent = depDecision.name || depId;
        label.htmlFor = `eval-whatif-${depId}`;

        const enabledCheckbox = document.createElement("input");
        enabledCheckbox.type = "checkbox";
        enabledCheckbox.className = "eval-whatif-toggle";
        enabledCheckbox.title = "Enable override";
        label.insertBefore(enabledCheckbox, label.firstChild);
        div.appendChild(label);

        const inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.id = `eval-whatif-${depId}`;
        inputEl.name = depId;
        inputEl.placeholder = "override value";
        inputEl.disabled = true;

        enabledCheckbox.addEventListener("change", () => {
            inputEl.disabled = !enabledCheckbox.checked;
            if (!enabledCheckbox.checked) {
                inputEl.value = "";
                delete whatIfOverrides[depId];
            }
        });

        inputEl.addEventListener("input", () => {
            if (enabledCheckbox.checked) {
                const raw = inputEl.value.trim();
                if (raw === "") {
                    delete whatIfOverrides[depId];
                } else {
                    whatIfOverrides[depId] = coerceInputValue(raw);
                }
            }
        });

        div.appendChild(inputEl);
        whatIfSectionEl.appendChild(div);
    }
}

/**
 * Auto-coerce a user-provided input value.
 */
function coerceInputValue(raw: string): unknown {
    if (raw.toLowerCase() === "true") return true;
    if (raw.toLowerCase() === "false") return false;
    if (raw.toLowerCase() === "null") return null;
    const num = Number(raw);
    if (!isNaN(num)) return num;
    // Try JSON parse for arrays/objects
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

// ── Evaluation ──────────────────────────────────────────────────────

function getInputValues(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    const inputs = inputFormEl.querySelectorAll("input");

    for (const input of inputs) {
        const name = input.name;
        const raw = input.value.trim();
        const typeRef = (input.dataset.typeRef || "").toLowerCase();

        if (raw === "") continue;

        // Coerce based on declared DMN typeRef
        switch (typeRef) {
            case "boolean":
                values[name] = raw.toLowerCase() === "true";
                break;
            case "integer":
            case "long":
                values[name] = parseInt(raw, 10);
                break;
            case "double":
                values[name] = parseFloat(raw);
                break;
            default:
                // string or unknown — keep as string
                values[name] = raw;
                break;
        }
    }

    return values;
}

async function runEvaluation() {
    const decisionId = decisionSelectEl.value;
    if (!decisionId || !currentModel) {
        showError("Please select a decision first");
        return;
    }

    const inputData = getInputValues();
    setBtnLoading(evaluateBtnEl, "▶ Evaluate");

    try {
        let evalResult = await evaluateDecisionWithOperaton(
            currentModel,
            decisionId,
            inputData
        );
        if (evalResult === null) {
            console.warn(
                "[DMN] Operaton engine unavailable — falling back to TS engine"
            );
            evalResult = evaluateDecisionTs(currentModel, decisionId, inputData);
        }
        const { result, trace, error } = evalResult;
        lastTrace = trace;
        if (error) {
            showError(error);
            flashBtn(evaluateBtnEl, "▶ Evaluate", "✗ Error", "eval-btn-error");
            return;
        }
        showResult(result, trace);
        flashBtn(evaluateBtnEl, "▶ Evaluate", "✓ Done", "eval-btn-success");
        if (trace.length > 1) {
            showDrdOverlays(trace);
        } else if (trace.length > 0) {
            const lastEntry = trace[trace.length - 1];
            if (
                lastEntry.type === "decisionTable" &&
                lastEntry.matchedRules.length > 0
            ) {
                await highlightMatchedRulesInTable(lastEntry);
            }
        }
    } catch (err) {
        showError((err as Error).message);
        flashBtn(evaluateBtnEl, "▶ Evaluate", "✗ Error", "eval-btn-error");
    } finally {
        setBtnLoading(evaluateBtnEl, null);
    }
}

/** Disable a button and show a loading label. Pass null to restore. */
function setBtnLoading(btn: HTMLButtonElement, originalLabel: string | null) {
    if (originalLabel === null) {
        btn.disabled = false;
        // label is restored by flashBtn timeout or set by caller
    } else {
        btn.disabled = true;
        btn.dataset.originalLabel = originalLabel;
        btn.textContent = "⌛ Evaluating…";
    }
}

/** Briefly flash a success/error class on a button then restore original label. */
function flashBtn(
    btn: HTMLButtonElement,
    originalLabel: string,
    flashLabel: string,
    cls: string,
    ms = 1500
) {
    btn.disabled = false;
    btn.textContent = flashLabel;
    btn.classList.add(cls);
    setTimeout(() => {
        btn.textContent = originalLabel;
        btn.classList.remove(cls);
    }, ms);
}

function showResult(result: unknown, trace: EvaluationTrace[]) {
    resultEl.innerHTML = "";

    // Result value
    const resultBox = document.createElement("div");
    resultBox.className = "eval-result-value";
    resultBox.textContent = formatResult(result);
    resultEl.appendChild(resultBox);

    // Trace details
    if (trace.length > 0) {
        const traceEl = document.createElement("details");
        traceEl.className = "eval-trace";

        const summaryEl = document.createElement("summary");
        summaryEl.textContent = `Evaluation Trace (${trace.length} step${trace.length !== 1 ? "s" : ""})`;

        const exportBtn = document.createElement("button");
        exportBtn.className = "eval-export-btn eval-trace-export";
        exportBtn.textContent = "⬇ JSON";
        exportBtn.title = "Export trace as JSON";
        exportBtn.addEventListener("click", (e) => {
            e.preventDefault();
            downloadFile(
                "evaluation-trace.json",
                exportTraceAsJSON(lastTrace),
                "application/json"
            );
        });
        summaryEl.appendChild(exportBtn);
        traceEl.appendChild(summaryEl);

        for (const entry of trace) {
            const entryEl = document.createElement("div");
            entryEl.className = "eval-trace-entry";

            const icon =
                entry.type === "override"
                    ? "⚡"
                    : entry.type === "literalExpression"
                      ? "𝑓"
                      : "▦";

            entryEl.innerHTML = `
                <div class="eval-trace-header">
                    <span class="eval-trace-icon">${icon}</span>
                    <strong>${escapeHtml(entry.decisionName)}</strong>
                    <span class="eval-trace-type">${entry.type}</span>
                    ${entry.durationMs !== undefined ? `<span class="eval-trace-time">${entry.durationMs}ms</span>` : ""}
                </div>
                ${entry.hitPolicy ? `<div class="eval-trace-detail">Hit Policy: ${entry.hitPolicy}${entry.aggregation ? ` (${entry.aggregation})` : ""}</div>` : ""}
                <div class="eval-trace-detail">Result: ${escapeHtml(formatResult(entry.result))}</div>
                ${entry.matchedRules.length > 0 ? `<div class="eval-trace-detail">Matched Rules: ${entry.matchedRules.length}</div>` : ""}
                ${entry.error ? `<div class="eval-trace-error">Error: ${escapeHtml(entry.error)}</div>` : ""}
            `;
            traceEl.appendChild(entryEl);
        }

        resultEl.appendChild(traceEl);
    }
}

function showError(message: string) {
    resultEl.innerHTML = `<div class="eval-error">${escapeHtml(message)}</div>`;
}

// ── Batch Evaluation ────────────────────────────────────────────────

async function runBatchEvaluation() {
    const decisionId = decisionSelectEl.value;
    if (!decisionId || !currentModel) {
        batchResultEl.innerHTML =
            '<div class="eval-error">Please select a decision first</div>';
        return;
    }

    const raw = (batchEditorView?.state.doc.toString() ?? "").trim();
    if (!raw) {
        batchResultEl.innerHTML =
            '<div class="eval-error">Please enter batch input data</div>';
        return;
    }

    let inputRows: Record<string, unknown>[];

    try {
        // Try JSON first
        inputRows = JSON.parse(raw);
        if (!Array.isArray(inputRows)) {
            throw new Error("Expected a JSON array");
        }
    } catch {
        // Try CSV
        inputRows = parseCSV(raw);
        if (inputRows.length === 0) {
            batchResultEl.innerHTML =
                '<div class="eval-error">Could not parse input as JSON array or CSV</div>';
            return;
        }
    }

    setBtnLoading(batchBtnEl, "▶ Run Batch");
    batchResultEl.innerHTML = '<p class="eval-hint">Running…</p>';
    const results: BatchRow[] = [];
    for (let i = 0; i < inputRows.length; i++) {
        const inputData = inputRows[i];
        try {
            const operatonResult = await evaluateDecisionWithOperaton(
                currentModel,
                decisionId,
                inputData
            );
            const evalResult =
                operatonResult ??
                evaluateDecisionTs(currentModel, decisionId, inputData);
            if (operatonResult === null) {
                console.warn(
                    "[DMN] Operaton engine unavailable — using TS fallback for batch row"
                );
            }
            results.push({
                index: i,
                inputData,
                result: evalResult.result,
                trace: evalResult.trace,
                error: evalResult.error,
            });
        } catch (err) {
            results.push({
                index: i,
                inputData,
                result: null,
                trace: [],
                error: (err as Error).message,
            });
        }
    }

    lastBatchResults = results;
    showBatchResults(results);
    batchExportCsvEl.disabled = false;
    batchExportJsonEl.disabled = false;
    setBtnLoading(batchBtnEl, null);
    const hasErrors = results.some((r) => r.error);
    flashBtn(
        batchBtnEl,
        "▶ Run Batch",
        hasErrors ? `⚠ ${results.length} rows (errors)` : `✓ ${results.length} rows`,
        hasErrors ? "eval-btn-error" : "eval-btn-success"
    );
}

function showBatchResults(results: BatchRow[]) {
    batchResultEl.innerHTML = "";

    const table = document.createElement("table");
    table.className = "eval-batch-table";

    // Header
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr><th>#</th><th>Input</th><th>Result</th><th>Status</th></tr>`;
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    for (const row of results) {
        const tr = document.createElement("tr");
        tr.className = row.error ? "eval-batch-error" : "";
        tr.innerHTML = `
            <td>${row.index + 1}</td>
            <td><code>${escapeHtml(JSON.stringify(row.inputData))}</code></td>
            <td>${row.error ? `<em class="eval-batch-error-label">${escapeHtml(row.error)}</em>` : escapeHtml(formatResult(row.result))}</td>
            <td>${row.error ? "❌" : "✅"}</td>
        `;
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    const summary = document.createElement("div");
    summary.className = "eval-batch-summary";
    const success = results.filter((r) => !r.error).length;
    const errors = results.filter((r) => !!r.error).length;
    summary.textContent = `${results.length} rows: ${success} ✅, ${errors} ❌`;
    batchResultEl.appendChild(summary);
    batchResultEl.appendChild(table);
}

// ── Utilities ───────────────────────────────────────────────────────

function formatResult(value: unknown): string {
    if (value === null || value === undefined) return "∅";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Trigger a file download in the browser.
 */
function downloadFile(filename: string, content: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Batch Editor (VS Code) ──────────────────────────────────────────

/**
 * Build a template row object from the current decision's inputs.
 * Type-appropriate placeholder values are used.
 */
function buildTemplateRow(): Record<string, unknown> {
    const decisionId = decisionSelectEl.value;
    if (!decisionId || !currentModel) return {};
    const decision = currentModel.decisions.get(decisionId);
    if (!decision || decision.logic?.type !== "decisionTable") return {};
    const row: Record<string, unknown> = {};
    for (const input of decision.logic.inputs) {
        const key = input.expression || input.label;
        if (!key) continue;
        switch ((input.typeRef ?? "").toLowerCase()) {
            case "integer":
            case "long":
            case "double":
                row[key] = 0;
                break;
            case "boolean":
                row[key] = false;
                break;
            default:
                row[key] = "";
        }
    }
    return row;
}

/**
 * Add a row to the batch editor:
 *   - If the editor is empty, seed it with [<template row>].
 *   - If the editor already contains a JSON array, append a new template row.
 */
function addBatchRow() {
    const existing = (batchEditorView?.state.doc.toString() ?? "").trim();
    const template = buildTemplateRow();

    if (!existing) {
        setBatchEditorContent(JSON.stringify([template], null, 2));
        return;
    }

    try {
        const parsed = JSON.parse(existing) as unknown;
        if (Array.isArray(parsed)) {
            parsed.push(template);
            setBatchEditorContent(JSON.stringify(parsed, null, 2));
        } else {
            // Not an array — replace with array containing template
            setBatchEditorContent(JSON.stringify([template], null, 2));
        }
    } catch {
        // Invalid JSON — append a new row as a fresh single-element array
        setBatchEditorContent(JSON.stringify([template], null, 2));
    }
}

/**
 * Open the batch input content in a VS Code text editor tab.
 * Seeds the editor with a template row first if it is empty.
 * The extension will sync changes back as `batchEditorContent` messages.
 */
function openBatchInEditor() {
    // Seed with a template if the editor is empty, so the user has something
    // to work with instead of an empty file.
    const current = (batchEditorView?.state.doc.toString() ?? "").trim();
    if (!current) {
        const template = buildTemplateRow();
        if (Object.keys(template).length > 0) {
            setBatchEditorContent(JSON.stringify([template], null, 2));
        }
    }

    const content = batchEditorView?.state.doc.toString() ?? "";
    if (!postToExtension) {
        // Not running inside VS Code — nothing to do
        return;
    }
    postToExtension({
        type: "openBatchEditor",
        content,
        decisionId: decisionSelectEl.value,
        decisionName:
            decisionSelectEl.options[decisionSelectEl.selectedIndex]?.text ??
            "",
    });
}

/**
 * Replace the CodeMirror batch editor content without triggering the
 * undo history stack.
 */
function setBatchEditorContent(content: string) {
    if (!batchEditorView) return;
    batchEditorView.dispatch({
        changes: {
            from: 0,
            to: batchEditorView.state.doc.length,
            insert: content,
        },
        selection: EditorSelection.cursor(
            Math.min(batchEditorView.state.selection.main.anchor, content.length)
        ),
    });
}

// ── Incoming Message Handler ────────────────────────────────────────

/**
 * Handle messages arriving from the VS Code extension.
 */
export function handleMessage(msg: unknown) {
    const m = msg as { type?: string; content?: string; cases?: TestCase[]; runId?: string };
    switch (m.type) {
        case "batchEditorContent":
            if (typeof m.content === "string" && m.content.trim()) {
                setBatchEditorContent(m.content);
            }
            break;
        case "runTestCases":
            if (Array.isArray(m.cases) && m.runId) {
                void runTestCases(m.runId, m.cases);
            }
            break;
    }
}

// ── Batch Test Case Runner ──────────────────────────────────────────

/** Shape of a test case sent from the extension's TestController. */
interface TestCase {
    id: string;
    label: string;
    decisionId: string;
    inputs: Record<string, unknown>;
    expected?: Record<string, unknown>;
    dmnContent?: string;
}

interface TestCaseResult {
    id: string;
    passed: boolean;
    error?: string;
    actual?: unknown;
    expected?: unknown;
}

/**
 * Evaluate a batch of test cases driven by the VS Code test controller.
 * Posts `testCaseResults` back to the extension.
 */
async function runTestCases(runId: string, cases: TestCase[]) {
    const results: TestCaseResult[] = [];

    for (const tc of cases) {
        // If a DMN content was provided with the test case, parse it first
        let modelToUse = currentModel;
        if (tc.dmnContent) {
            try {
                modelToUse = await parseDmnXml(tc.dmnContent);
            } catch (e) {
                results.push({
                    id: tc.id,
                    passed: false,
                    error: `Failed to parse DMN: ${(e as Error).message}`,
                });
                continue;
            }
        }

        if (!modelToUse) {
            results.push({
                id: tc.id,
                passed: false,
                error: "No DMN model loaded",
            });
            continue;
        }

        try {
            const operatonResult = await evaluateDecisionWithOperaton(
                modelToUse,
                tc.decisionId,
                tc.inputs
            );
            const evalResult =
                operatonResult ??
                evaluateDecisionTs(modelToUse, tc.decisionId, tc.inputs);
            if (operatonResult === null) {
                console.warn(
                    "[DMN] Operaton engine unavailable — using TS fallback for test case"
                );
            }
            if (evalResult.error) {
                results.push({
                    id: tc.id,
                    passed: false,
                    error: evalResult.error,
                });
                continue;
            }

            // If no expected value provided, just report as passed (smoke test)
            if (!tc.expected) {
                results.push({ id: tc.id, passed: true, actual: evalResult.result });
                continue;
            }

            const actual = evalResult.result;
            const passed = deepEqual(actual, tc.expected);
            results.push({
                id: tc.id,
                passed,
                actual,
                expected: tc.expected,
                error: passed ? undefined : `Expected ${JSON.stringify(tc.expected)}, got ${JSON.stringify(actual)}`,
            });
        } catch (e) {
            results.push({
                id: tc.id,
                passed: false,
                error: (e as Error).message,
            });
        }
    }

    postToExtension?.({ type: "testCaseResults", runId, results });
}

/**
 * Deep equality check for DMN result values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a !== "object") return false;
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao);
    const bKeys = Object.keys(bo);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
        if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
}

// ── Rule Highlighting ───────────────────────────────────────────────

/**
 * Highlight matched rules in the decision table view.
 */
async function highlightMatchedRulesInTable(entry: EvaluationTrace) {
    if (entry.type !== "decisionTable" || entry.matchedRules.length === 0) {
        return;
    }

    // Get the rule IDs from matched rules
    const ruleIds = entry.matchedRules.map((r) => r.id);

    // Navigate to the decision table view
    const navigated = await navigateToDecisionTable(entry.decisionId);

    if (navigated) {
        // Wait a bit for the view to stabilize
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Highlight the matched rules
        highlightMatchedRules(ruleIds);

        // Show the clear button
        const clearBtn = document.querySelector("#eval-clear-highlights");
        if (clearBtn) {
            clearBtn.classList.remove("hidden");
        }
    }
}

/**
 * Clear all rule highlights and hide the clear button.
 */
function clearHighlights() {
    clearMatchedRuleHighlights();

    const clearBtn = document.querySelector("#eval-clear-highlights");
    if (clearBtn) {
        clearBtn.classList.add("hidden");
    }
}

// ── DRD Overlay Controls ────────────────────────────────────────────

function showDrdOverlays(trace: EvaluationTrace[]) {
    const modeler = getModelerInstance();
    if (!modeler) return;

    // Clear any existing overlays first
    clearDecisionHighlights(modeler);

    // Show overlays
    highlightDecisions(modeler, trace);
    drdOverlaysVisible = true;

    // Enable DRD controls
    drdToggleOverlaysBtnEl.disabled = false;
    drdResetBtnEl.disabled = false;
    animPlayBtnEl.disabled = false;
    animStepFwdBtnEl.disabled = false;
    animStepBkBtnEl.disabled = false;
}

function toggleDrdOverlays() {
    const modeler = getModelerInstance();
    if (!modeler) return;

    if (drdOverlaysVisible) {
        clearDecisionHighlights(modeler);
        drdOverlaysVisible = false;
        drdToggleOverlaysBtnEl.textContent = "👁 Show";
    } else {
        if (lastTrace.length > 0) {
            highlightDecisions(modeler, lastTrace);
        }
        drdOverlaysVisible = true;
        drdToggleOverlaysBtnEl.textContent = "👁 Hide";
    }
}

function resetDrdHighlights() {
    const modeler = getModelerInstance();
    if (!modeler) return;

    stopAnimation();
    clearDecisionHighlights(modeler);
    drdOverlaysVisible = false;
    drdToggleOverlaysBtnEl.textContent = "👁 Overlays";
    drdToggleOverlaysBtnEl.disabled = true;
    drdResetBtnEl.disabled = true;
    animPlayBtnEl.disabled = true;
    animPauseBtnEl.disabled = true;
    animStopBtnEl.disabled = true;
    animStepFwdBtnEl.disabled = true;
    animStepBkBtnEl.disabled = true;
}

function playAnimation() {
    const modeler = getModelerInstance();
    if (!modeler || lastTrace.length === 0) return;

    // Stop any existing animation
    if (currentAnimation) {
        currentAnimation.stop();
    }

    // Clear existing overlays for clean animation
    clearDecisionHighlights(modeler);
    drdOverlaysVisible = false;

    currentAnimation = animateDecisions(modeler, lastTrace, {
        speed: 800,
        onStep: () => {
            // Update UI state during animation
        },
        onComplete: () => {
            drdOverlaysVisible = true;
            animPlayBtnEl.disabled = false;
            animPauseBtnEl.disabled = true;
        },
    });

    if (currentAnimation) {
        currentAnimation.play();
        animPlayBtnEl.disabled = true;
        animPauseBtnEl.disabled = false;
        animStopBtnEl.disabled = false;
    }
}

function pauseAnimation() {
    if (currentAnimation) {
        currentAnimation.pause();
        animPlayBtnEl.disabled = false;
        animPauseBtnEl.disabled = true;
    }
}

function stopAnimation() {
    if (currentAnimation) {
        currentAnimation.stop();
        currentAnimation = null;
        animPlayBtnEl.disabled = lastTrace.length === 0;
        animPauseBtnEl.disabled = true;
        animStopBtnEl.disabled = true;
    }
}

function stepAnimationForward() {
    const modeler = getModelerInstance();
    if (!modeler || lastTrace.length === 0) return;

    if (!currentAnimation) {
        clearDecisionHighlights(modeler);
        currentAnimation = animateDecisions(modeler, lastTrace);
        animStopBtnEl.disabled = false;
    }

    if (currentAnimation) {
        currentAnimation.stepForward();
    }
}

function stepAnimationBackward() {
    if (currentAnimation) {
        currentAnimation.stepBackward();
    }
}
