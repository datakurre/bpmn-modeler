/**
 * DRD Overlay — shows evaluation results on DRD diagram nodes.
 *
 * Uses the dmn-js overlay and canvas services to add visual indicators
 * to decision nodes after evaluation:
 *
 * - Order badges (numbered circles showing evaluation sequence)
 * - Result overlays (compact result preview below each node)
 * - Status markers (green = evaluated, red = error, yellow = override)
 * - Dimming of non-evaluated decisions
 *
 * Also provides step-through animation of evaluation traces.
 */

import DmnModeler from "dmn-js/lib/Modeler";
import type { EvaluationTrace } from "./engine";

// ── Types ───────────────────────────────────────────────────────────

export interface HighlightOptions {
    onDecisionClick?: (decisionId: string, trace: EvaluationTrace) => void;
}

export interface AnimationController {
    play: () => void;
    pause: () => void;
    stop: () => void;
    stepForward: () => void;
    stepBackward: () => void;
    setSpeed: (ms: number) => void;
    getCurrentStep: () => number;
    getTotalSteps: () => number;
    isPlaying: () => boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Format a result value for compact overlay display.
 * Truncates long values and handles null/undefined.
 */
export function formatOverlayResult(value: unknown): string {
    if (value === null || value === undefined) return "∅";
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") return String(value);
    if (typeof value === "string") {
        return value.length > 30 ? value.slice(0, 27) + "…" : value;
    }
    const json = JSON.stringify(value);
    return json.length > 30 ? json.slice(0, 27) + "…" : json;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Get the DRD viewer services from a DmnModeler instance.
 * Returns null if the modeler is not in DRD mode or services are unavailable.
 */
function getDrdServices(modeler: DmnModeler): {
    overlays: any;
    canvas: any;
    elementRegistry: any;
} | null {
    try {
        const views = modeler.getViews?.() ?? [];
        const drdView = views.find((v: any) => v.type === "drd");
        if (!drdView) return null;

        const activeViewer = modeler.getActiveViewer();
        if (!activeViewer) return null;

        return {
            overlays: activeViewer.get("overlays"),
            canvas: activeViewer.get("canvas"),
            elementRegistry: activeViewer.get("elementRegistry"),
        };
    } catch {
        return null;
    }
}

/**
 * Build a tooltip string for a trace entry.
 */
function buildTooltip(entry: EvaluationTrace): string {
    const lines: string[] = [];
    lines.push(`${entry.decisionName} (${entry.decisionId})`);
    lines.push(`Type: ${entry.type}`);

    if (entry.hitPolicy) {
        lines.push(
            `Hit Policy: ${entry.hitPolicy}${entry.aggregation ? ` (${entry.aggregation})` : ""}`
        );
    }

    if (entry.inputValues && Object.keys(entry.inputValues).length > 0) {
        lines.push(
            `Inputs: ${Object.entries(entry.inputValues)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(", ")}`
        );
    }

    if (entry.error) {
        lines.push(`Error: ${entry.error}`);
    } else {
        lines.push(`Result: ${JSON.stringify(entry.result)}`);
    }

    if (entry.durationMs !== undefined) {
        lines.push(`Duration: ${entry.durationMs}ms`);
    }

    return lines.join("\n");
}

// ── Highlight Decisions ─────────────────────────────────────────────

/**
 * Highlight evaluated decisions on the DRD diagram.
 *
 * Adds visual overlays showing evaluation order, results, and status
 * on each decision node referenced in the trace.
 */
export function highlightDecisions(
    modeler: DmnModeler,
    trace: EvaluationTrace[],
    options: HighlightOptions = {}
): void {
    if (!trace || trace.length === 0) return;

    const services = getDrdServices(modeler);
    if (!services) return;

    const { overlays, canvas, elementRegistry } = services;
    const evaluatedIds = new Set(trace.map((e) => e.decisionId));

    // Dim non-evaluated decisions
    try {
        elementRegistry.forEach((element: any) => {
            if (
                element.type === "dmn:Decision" &&
                !evaluatedIds.has(element.id)
            ) {
                try {
                    canvas.addMarker(element.id, "decision-not-evaluated");
                } catch {
                    // Element may not support markers
                }
            }
        });
    } catch {
        // Ignore errors during dimming
    }

    // Add markers and overlays for each evaluated decision
    for (let i = 0; i < trace.length; i++) {
        const entry = trace[i];
        const decisionId = entry.decisionId;

        try {
            // Add CSS marker based on status
            let markerClass: string;
            if (entry.error) {
                markerClass = "decision-error";
            } else if (entry.type === "override") {
                markerClass = "decision-override";
            } else {
                markerClass = "decision-evaluated";
            }
            canvas.addMarker(decisionId, markerClass);

            // Add order number overlay
            const orderHtml = document.createElement("div");
            orderHtml.className = "decision-order-badge";
            if (entry.type === "override") {
                orderHtml.classList.add("override");
            }
            orderHtml.textContent = String(i + 1);
            orderHtml.title = `Step ${i + 1}: ${entry.decisionName}`;
            orderHtml.setAttribute("role", "img");
            orderHtml.setAttribute(
                "aria-label",
                `Evaluation step ${i + 1}: ${entry.decisionName}`
            );

            overlays.add(decisionId, "evaluation-order", {
                position: { top: -12, right: -12 },
                html: orderHtml,
            });

            // Add result overlay
            const resultHtml = document.createElement("div");
            const isError = !!entry.error;
            const isOverride = entry.type === "override";

            let overlayClass = "decision-result-overlay";
            if (isError) overlayClass += " error";
            else if (isOverride) overlayClass += " override";
            else if (entry.type === "literalExpression")
                overlayClass += " literal";

            resultHtml.className = overlayClass;
            resultHtml.setAttribute("role", "button");
            resultHtml.setAttribute("tabindex", "0");
            resultHtml.setAttribute(
                "aria-label",
                `${entry.decisionName}: ${isError ? "error" : isOverride ? "overridden" : "result"} — ${formatOverlayResult(entry.result)}`
            );

            // Build content
            const typeIcon = isOverride
                ? "⚡"
                : isError
                  ? "❌"
                  : entry.type === "literalExpression"
                    ? "𝑓"
                    : "▦";

            resultHtml.innerHTML = `<span class="decision-result-icon">${typeIcon}</span> ${escapeHtml(formatOverlayResult(entry.result))}${entry.durationMs !== undefined ? `<span class="decision-duration">${entry.durationMs}ms</span>` : ""}`;
            resultHtml.title = buildTooltip(entry);

            // Click handler for navigation
            if (options.onDecisionClick) {
                const handler = options.onDecisionClick;
                resultHtml.addEventListener("click", () =>
                    handler(decisionId, entry)
                );
                resultHtml.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handler(decisionId, entry);
                    }
                });
            }

            overlays.add(decisionId, "evaluation-result", {
                position: { bottom: -8, left: 0 },
                html: resultHtml,
            });

            // Error detail overlay for failed decisions
            if (isError) {
                const errorHtml = document.createElement("div");
                errorHtml.className = "decision-error-detail";
                errorHtml.textContent = entry.error!;
                errorHtml.title = entry.error!;
                errorHtml.setAttribute("role", "alert");
                errorHtml.setAttribute("aria-label", `Error: ${entry.error}`);

                overlays.add(decisionId, "evaluation-error", {
                    position: { bottom: -28, left: 0 },
                    html: errorHtml,
                });
            }
        } catch {
            // Element may not exist in the DRD — skip silently
        }
    }
}

// ── Clear Highlights ────────────────────────────────────────────────

/**
 * Remove all decision evaluation highlights and overlays from the DRD.
 */
export function clearDecisionHighlights(modeler: DmnModeler): void {
    const services = getDrdServices(modeler);
    if (!services) return;

    const { overlays, canvas, elementRegistry } = services;

    try {
        // Remove overlays
        overlays.remove({ type: "evaluation-order" });
        overlays.remove({ type: "evaluation-result" });
        overlays.remove({ type: "evaluation-error" });
    } catch {
        // Overlays may not exist
    }

    // Remove markers from all elements
    try {
        elementRegistry.forEach((element: any) => {
            try {
                canvas.removeMarker(element.id, "decision-evaluated");
                canvas.removeMarker(element.id, "decision-error");
                canvas.removeMarker(element.id, "decision-override");
                canvas.removeMarker(element.id, "decision-not-evaluated");
            } catch {
                // Ignore errors for elements without markers
            }
        });
    } catch {
        // Ignore errors during cleanup
    }
}

// ── Step-Through Animation ──────────────────────────────────────────

/**
 * Create an animation controller for step-through evaluation on the DRD.
 *
 * Reveals evaluation steps one at a time with visual transitions:
 * - Each step un-dims the decision, adds its order badge and result overlay
 * - Supports play (auto-advance), pause, stop, and manual stepping
 *
 * @param modeler - The DmnModeler instance
 * @param trace - Evaluation trace entries
 * @param options - Animation options
 * @returns AnimationController, or null if no DRD view is available
 */
export function animateDecisions(
    modeler: DmnModeler,
    trace: EvaluationTrace[],
    options: {
        speed?: number;
        onStep?: (step: number) => void;
        onComplete?: () => void;
    } = {}
): AnimationController | null {
    if (!trace || trace.length === 0) return null;

    const services = getDrdServices(modeler);
    if (!services) return null;

    const { overlays, canvas, elementRegistry } = services;

    let currentStep = -1;
    let speed = options.speed || 1000;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let playing = false;

    // Dim all decisions initially
    try {
        elementRegistry.forEach((element: any) => {
            if (element.type === "dmn:Decision") {
                try {
                    canvas.addMarker(element.id, "decision-not-evaluated");
                } catch {
                    // Skip
                }
            }
        });
    } catch {
        // Ignore
    }

    function revealStep(stepIndex: number): void {
        if (stepIndex < 0 || stepIndex >= trace.length) return;

        const entry = trace[stepIndex];
        const decisionId = entry.decisionId;

        try {
            // Remove dim marker
            canvas.removeMarker(decisionId, "decision-not-evaluated");

            // Add status marker
            let markerClass: string;
            if (entry.error) {
                markerClass = "decision-error";
            } else if (entry.type === "override") {
                markerClass = "decision-override";
            } else {
                markerClass = "decision-evaluated";
            }
            canvas.addMarker(decisionId, markerClass);

            // Add order badge
            const orderHtml = document.createElement("div");
            orderHtml.className = "decision-order-badge";
            if (entry.type === "override") {
                orderHtml.classList.add("override");
            }
            orderHtml.textContent = String(stepIndex + 1);
            orderHtml.title = `Step ${stepIndex + 1}: ${entry.decisionName}`;
            orderHtml.setAttribute("role", "img");
            orderHtml.setAttribute(
                "aria-label",
                `Evaluation step ${stepIndex + 1}: ${entry.decisionName}`
            );

            overlays.add(decisionId, "evaluation-order", {
                position: { top: -12, right: -12 },
                html: orderHtml,
            });

            // Add result overlay
            const resultHtml = document.createElement("div");
            const isError = !!entry.error;
            const isOverride = entry.type === "override";

            let overlayClass = "decision-result-overlay";
            if (isError) overlayClass += " error";
            else if (isOverride) overlayClass += " override";
            else if (entry.type === "literalExpression")
                overlayClass += " literal";

            resultHtml.className = overlayClass;
            const typeIcon = isOverride
                ? "⚡"
                : isError
                  ? "❌"
                  : entry.type === "literalExpression"
                    ? "𝑓"
                    : "▦";

            resultHtml.innerHTML = `<span class="decision-result-icon">${typeIcon}</span> ${escapeHtml(formatOverlayResult(entry.result))}`;
            resultHtml.title = buildTooltip(entry);

            overlays.add(decisionId, "evaluation-result", {
                position: { bottom: -8, left: 0 },
                html: resultHtml,
            });
        } catch {
            // Element may not exist in the DRD
        }

        options.onStep?.(stepIndex);
    }

    function hideStep(stepIndex: number): void {
        if (stepIndex < 0 || stepIndex >= trace.length) return;

        const entry = trace[stepIndex];
        const decisionId = entry.decisionId;

        try {
            // Remove markers
            canvas.removeMarker(decisionId, "decision-evaluated");
            canvas.removeMarker(decisionId, "decision-error");
            canvas.removeMarker(decisionId, "decision-override");

            // Re-add dim marker
            canvas.addMarker(decisionId, "decision-not-evaluated");
        } catch {
            // Ignore
        }

        // Note: overlay removal for specific elements is done via
        // clear + re-reveal approach since dmn-js overlays API
        // removes by type globally
    }

    function advanceStep(): void {
        if (currentStep < trace.length - 1) {
            currentStep++;
            revealStep(currentStep);

            if (currentStep >= trace.length - 1) {
                stopPlayback();
                options.onComplete?.();
            }
        }
    }

    function startPlayback(): void {
        if (playing) return;
        playing = true;

        const tick = () => {
            if (!playing) return;
            advanceStep();
            if (playing && currentStep < trace.length - 1) {
                timerId = setTimeout(tick, speed);
            }
        };

        // Start immediately with first step
        tick();
    }

    function stopPlayback(): void {
        playing = false;
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    }

    const controller: AnimationController = {
        play() {
            startPlayback();
        },

        pause() {
            stopPlayback();
        },

        stop() {
            stopPlayback();
            // Clear all revealed steps
            clearDecisionHighlights(modeler);
            currentStep = -1;
            // Re-dim all decisions
            try {
                elementRegistry.forEach((element: any) => {
                    if (element.type === "dmn:Decision") {
                        try {
                            canvas.addMarker(
                                element.id,
                                "decision-not-evaluated"
                            );
                        } catch {
                            // Skip
                        }
                    }
                });
            } catch {
                // Ignore
            }
        },

        stepForward() {
            stopPlayback();
            advanceStep();
        },

        stepBackward() {
            stopPlayback();
            if (currentStep >= 0) {
                hideStep(currentStep);
                currentStep--;
            }
        },

        setSpeed(ms: number) {
            speed = ms;
        },

        getCurrentStep() {
            return currentStep;
        },

        getTotalSteps() {
            return trace.length;
        },

        isPlaying() {
            return playing;
        },
    };

    return controller;
}
