/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
    createBadgeHtml,
    groupCallerLinks,
    LinkedResourceOverlays,
    ResolvedLink,
} from "./LinkedResourceOverlays";

// ---------------------------------------------------------------------------
// createBadgeHtml
// ---------------------------------------------------------------------------

describe("createBadgeHtml", () => {
    it("should create a div element for a process link", () => {
        const link: ResolvedLink = {
            elementId: "Call_1",
            refId: "Sub_Process",
            refType: "process",
            targetPath: "processes/sub.bpmn",
        };
        const el = createBadgeHtml(link);

        expect(el.tagName).toBe("DIV");
        expect(el.className).toContain("linked-resource-badge");
        expect(el.className).toContain("linked-resource-badge--process");
        expect(el.textContent).toBe("↗");
        expect(el.dataset.targetPath).toBe("processes/sub.bpmn");
        expect(el.dataset.refId).toBe("Sub_Process");
        expect(el.dataset.refType).toBe("process");
    });

    it("should create a div element for a decision link", () => {
        const link: ResolvedLink = {
            elementId: "BRT_1",
            refId: "Risk_Check",
            refType: "decision",
            targetPath: "decisions/risk.dmn",
        };
        const el = createBadgeHtml(link);

        expect(el.className).toContain("linked-resource-badge--decision");
        expect(el.textContent).toBe("↗");
    });

    it("should create a div element for a form link", () => {
        const link: ResolvedLink = {
            elementId: "UT_1",
            refId: "review-form",
            refType: "form",
            targetPath: "forms/review.form",
        };
        const el = createBadgeHtml(link);

        expect(el.className).toContain("linked-resource-badge--form");
        expect(el.textContent).toBe("↗");
    });

    it("should include target path and refId in title tooltip", () => {
        const link: ResolvedLink = {
            elementId: "Call_1",
            refId: "SubProcess",
            refType: "process",
            targetPath: "sub.bpmn",
        };
        const el = createBadgeHtml(link);

        expect(el.title).toContain("SubProcess");
        expect(el.title).toContain("sub.bpmn");
    });

    it("should use fallback icon for unknown refType", () => {
        const link: ResolvedLink = {
            elementId: "Unknown_1",
            refId: "Unknown_Ref",
            refType: "unknown" as any,
            targetPath: "unknown.txt",
        };
        const el = createBadgeHtml(link);

        expect(el.textContent).toBe("↗");
        expect(el.className).toContain("linked-resource-badge--unknown");
    });

    it("should use ↙ icon for caller (back-link) refType", () => {
        const link: ResolvedLink = {
            elementId: "SubStart",
            refId: "Sub_Process",
            refType: "caller",
            targetPath: "parent.bpmn",
        };
        const el = createBadgeHtml(link);

        expect(el.textContent).toBe("↙");
        expect(el.className).toContain("linked-resource-badge--caller");
        expect(el.title).toContain("parent.bpmn");
        expect(el.title).toContain("Sub_Process");
    });
});

// ---------------------------------------------------------------------------
// LinkedResourceOverlays
// ---------------------------------------------------------------------------

describe("LinkedResourceOverlays", () => {
    let overlays: any;
    let eventBus: any;
    let sut: LinkedResourceOverlays;

    beforeEach(() => {
        overlays = {
            add: vi.fn().mockReturnValue("ov-1"),
            remove: vi.fn(),
        };
        eventBus = { on: vi.fn() };
        sut = new LinkedResourceOverlays(overlays, eventBus);
    });

    it("should have correct $inject", () => {
        expect(LinkedResourceOverlays.$inject).toEqual(["overlays", "eventBus"]);
    });

    describe("showLinks", () => {
        const links: ResolvedLink[] = [
            {
                elementId: "Call_1",
                refId: "Sub_Process",
                refType: "process",
                targetPath: "sub.bpmn",
            },
            {
                elementId: "BRT_1",
                refId: "Risk_Decision",
                refType: "decision",
                targetPath: "risk.dmn",
            },
        ];

        it("should add overlays for each link", () => {
            sut.showLinks(links);
            expect(overlays.add).toHaveBeenCalledTimes(2);
        });

        it("should pass element id and overlay type to overlays.add", () => {
            sut.showLinks(links);
            expect(overlays.add).toHaveBeenCalledWith(
                "Call_1",
                "linked-resource-badge",
                expect.objectContaining({
                    position: { top: 5, right: 25 },
                    html: expect.any(HTMLElement),
                }),
            );
        });

        it("should use bottom-left position for caller back-links", () => {
            sut.showLinks([
                {
                    elementId: "SubStart",
                    refId: "Sub_Process",
                    refType: "caller",
                    targetPath: "parent.bpmn",
                },
            ]);
            expect(overlays.add).toHaveBeenCalledWith(
                "SubStart",
                "linked-resource-badge",
                expect.objectContaining({
                    position: { bottom: 0, left: -10 },
                    html: expect.any(HTMLElement),
                }),
            );
        });

        it("should clear previous overlays before adding new ones", () => {
            sut.showLinks(links);
            overlays.add.mockReturnValue("ov-2");
            sut.showLinks([links[0]]);

            // First call added 2, second clears them and adds 1
            expect(overlays.remove).toHaveBeenCalledTimes(2);
            expect(overlays.remove).toHaveBeenCalledWith("ov-1");
        });

        it("should handle errors from overlays.add gracefully", () => {
            overlays.add.mockImplementation(() => {
                throw new Error("Element not found");
            });

            // Should not throw
            expect(() => sut.showLinks(links)).not.toThrow();
        });

        it("should handle errors from overlays.remove gracefully", () => {
            sut.showLinks(links);
            overlays.remove.mockImplementation(() => {
                throw new Error("Already removed");
            });

            // Should not throw
            expect(() => sut.showLinks([])).not.toThrow();
        });
    });

    describe("clearOverlays", () => {
        it("should remove all tracked overlay ids", () => {
            overlays.add.mockReturnValueOnce("id-1").mockReturnValueOnce("id-2");
            sut.showLinks([
                {
                    elementId: "A",
                    refId: "X",
                    refType: "process",
                    targetPath: "a.bpmn",
                },
                {
                    elementId: "B",
                    refId: "Y",
                    refType: "decision",
                    targetPath: "b.dmn",
                },
            ]);

            sut.clearOverlays();
            expect(overlays.remove).toHaveBeenCalledWith("id-1");
            expect(overlays.remove).toHaveBeenCalledWith("id-2");
        });

        it("should be safe to call when no overlays exist", () => {
            expect(() => sut.clearOverlays()).not.toThrow();
        });
    });

    describe("click handling", () => {
        it("should re-add overlays on import.done event", () => {
            const links: ResolvedLink[] = [
                {
                    elementId: "Call_1",
                    refId: "Sub_Process",
                    refType: "process",
                    targetPath: "sub.bpmn",
                },
            ];

            // Show links first to store them
            sut.showLinks(links);
            expect(overlays.add).toHaveBeenCalledTimes(1);

            // Simulate import.done event
            const importDoneHandler = eventBus.on.mock.calls.find(
                (call: any[]) => call[0] === "import.done",
            )?.[1];
            expect(importDoneHandler).toBeDefined();

            // Reset and trigger the event
            overlays.add.mockClear();
            overlays.remove.mockClear();
            importDoneHandler();

            // Overlays should be re-added
            expect(overlays.add).toHaveBeenCalledTimes(1);
        });

        it("should not add overlays on import.done when no links stored", () => {
            const importDoneHandler = eventBus.on.mock.calls.find(
                (call: any[]) => call[0] === "import.done",
            )?.[1];
            expect(importDoneHandler).toBeDefined();

            importDoneHandler();
            expect(overlays.add).not.toHaveBeenCalled();
        });

        it("should post openLinkedFile message on badge click", () => {
            const mockVscode = { postMessage: vi.fn() };
            sut.setVsCodeApi(mockVscode);

            // Capture the HTML element passed to overlays.add
            let capturedHtml: HTMLElement | null = null;
            overlays.add.mockImplementation(
                (_elementId: string, _type: string, opts: { html: HTMLElement }) => {
                    capturedHtml = opts.html;
                    return "ov-click";
                },
            );

            sut.showLinks([
                {
                    elementId: "Call_1",
                    refId: "Sub_Process",
                    refType: "process",
                    targetPath: "processes/sub.bpmn",
                },
            ]);

            expect(capturedHtml).toBeTruthy();
            // Simulate click
            capturedHtml!.click();

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                type: "openLinkedFile",
                relativePath: "processes/sub.bpmn",
            });
        });

        it("should not throw if vsCodeApi is not set", () => {
            let capturedHtml: HTMLElement | null = null;
            overlays.add.mockImplementation(
                (_elementId: string, _type: string, opts: { html: HTMLElement }) => {
                    capturedHtml = opts.html;
                    return "ov-click";
                },
            );

            sut.showLinks([
                {
                    elementId: "Call_1",
                    refId: "Sub_Process",
                    refType: "process",
                    targetPath: "sub.bpmn",
                },
            ]);

            // Should not throw even without vsCodeApi
            expect(() => capturedHtml!.click()).not.toThrow();
        });
    });
});

// ---------------------------------------------------------------------------
// Message-based badge tests (createBadgeHtml for "message" refType)
// ---------------------------------------------------------------------------

describe("createBadgeHtml — message refType", () => {
    it("should create a forward ↗ badge for message refType", () => {
        const link: ResolvedLink = {
            elementId: "Send_1",
            refId: "OrderCreated",
            refType: "message",
            targetPath: "processes/receiver.bpmn",
        };
        const el = createBadgeHtml(link);

        expect(el.tagName).toBe("DIV");
        expect(el.className).toContain("linked-resource-badge");
        expect(el.className).toContain("linked-resource-badge--message");
        expect(el.textContent).toBe("↗");
        expect(el.dataset.targetPath).toBe("processes/receiver.bpmn");
        expect(el.dataset.refId).toBe("OrderCreated");
        expect(el.dataset.refType).toBe("message");
    });

    it("should include message name and target path in title", () => {
        const link: ResolvedLink = {
            elementId: "Send_1",
            refId: "OrderCreated",
            refType: "message",
            targetPath: "processes/receiver.bpmn",
        };
        const el = createBadgeHtml(link);

        expect(el.title).toContain("OrderCreated");
        expect(el.title).toContain("processes/receiver.bpmn");
    });
});

// ---------------------------------------------------------------------------
// Message-based overlay integration tests
// ---------------------------------------------------------------------------

describe("LinkedResourceOverlays — message forward links", () => {
    let overlays: any;
    let eventBus: any;
    let sut: LinkedResourceOverlays;

    beforeEach(() => {
        overlays = {
            add: vi.fn().mockReturnValue("ov-msg"),
            remove: vi.fn(),
        };
        eventBus = { on: vi.fn() };
        sut = new LinkedResourceOverlays(overlays, eventBus);
    });

    it("should add a top-right badge for message forward links", () => {
        sut.showLinks([
            {
                elementId: "Send_1",
                refId: "OrderCreated",
                refType: "message",
                targetPath: "receiver.bpmn",
            },
        ]);

        expect(overlays.add).toHaveBeenCalledWith(
            "Send_1",
            "linked-resource-badge",
            expect.objectContaining({
                position: { top: -20, right: 5 },
                html: expect.any(HTMLElement),
            }),
        );
    });

    it("should post openLinkedFile on message badge click", () => {
        const mockVscode = { postMessage: vi.fn() };
        sut.setVsCodeApi(mockVscode);

        let capturedHtml: HTMLElement | null = null;
        overlays.add.mockImplementation(
            (_elementId: string, _type: string, opts: { html: HTMLElement }) => {
                capturedHtml = opts.html;
                return "ov-msg-click";
            },
        );

        sut.showLinks([
            {
                elementId: "Send_1",
                refId: "OrderCreated",
                refType: "message",
                targetPath: "receiver.bpmn",
            },
        ]);

        capturedHtml!.click();
        expect(mockVscode.postMessage).toHaveBeenCalledWith({
            type: "openLinkedFile",
            relativePath: "receiver.bpmn",
        });
    });
});

describe("LinkedResourceOverlays — message back-links (caller badges)", () => {
    let overlays: any;
    let eventBus: any;
    let sut: LinkedResourceOverlays;

    beforeEach(() => {
        overlays = {
            add: vi.fn().mockReturnValue("ov-back"),
            remove: vi.fn(),
        };
        eventBus = { on: vi.fn() };
        sut = new LinkedResourceOverlays(overlays, eventBus);
    });

    it("should use bottom-left position for message back-links (refType caller)", () => {
        sut.showLinks([
            {
                elementId: "Start_Recv",
                refId: "OrderCreated",
                refType: "caller",
                targetPath: "sender.bpmn",
            },
        ]);

        expect(overlays.add).toHaveBeenCalledWith(
            "Start_Recv",
            "linked-resource-badge",
            expect.objectContaining({
                position: { bottom: 0, left: -10 },
                html: expect.any(HTMLElement),
            }),
        );
    });

    it("should group multiple message back-links into one badge", () => {
        sut.showLinks([
            {
                elementId: "Start_Recv",
                refId: "OrderCreated",
                refType: "caller",
                targetPath: "sender1.bpmn",
            },
            {
                elementId: "Start_Recv",
                refId: "OrderCreated",
                refType: "caller",
                targetPath: "sender2.bpmn",
            },
        ]);

        // Two caller links share same elementId → grouped into one badge
        expect(overlays.add).toHaveBeenCalledTimes(1);
        expect(overlays.add).toHaveBeenCalledWith(
            "Start_Recv",
            "linked-resource-badge",
            expect.objectContaining({
                position: { bottom: 0, left: -10 },
            }),
        );
    });

    it("should post openLinkedFile for single message back-link click", () => {
        const mockVscode = { postMessage: vi.fn() };
        sut.setVsCodeApi(mockVscode);

        let capturedHtml: HTMLElement | null = null;
        overlays.add.mockImplementation(
            (_elementId: string, _type: string, opts: { html: HTMLElement }) => {
                capturedHtml = opts.html;
                return "ov-single";
            },
        );

        sut.showLinks([
            {
                elementId: "Start_Recv",
                refId: "OrderCreated",
                refType: "caller",
                targetPath: "sender.bpmn",
            },
        ]);

        capturedHtml!.click();
        expect(mockVscode.postMessage).toHaveBeenCalledWith({
            type: "openLinkedFile",
            relativePath: "sender.bpmn",
        });
    });

    it("should post openLinkedFileChooser for multiple message back-link click", () => {
        const mockVscode = { postMessage: vi.fn() };
        sut.setVsCodeApi(mockVscode);

        let capturedHtml: HTMLElement | null = null;
        overlays.add.mockImplementation(
            (_elementId: string, _type: string, opts: { html: HTMLElement }) => {
                capturedHtml = opts.html;
                return "ov-multi";
            },
        );

        sut.showLinks([
            {
                elementId: "Start_Recv",
                refId: "OrderCreated",
                refType: "caller",
                targetPath: "sender1.bpmn",
            },
            {
                elementId: "Start_Recv",
                refId: "OrderCreated",
                refType: "caller",
                targetPath: "sender2.bpmn",
            },
        ]);

        capturedHtml!.click();
        expect(mockVscode.postMessage).toHaveBeenCalledWith({
            type: "openLinkedFileChooser",
            candidates: expect.arrayContaining([
                expect.objectContaining({ relativePath: "sender1.bpmn" }),
                expect.objectContaining({ relativePath: "sender2.bpmn" }),
            ]),
        });
    });
});

// ---------------------------------------------------------------------------
// groupCallerLinks — duplicate candidate filtering
// ---------------------------------------------------------------------------

describe("groupCallerLinks — deduplication", () => {
    const makeCallerLink = (elementId: string, targetPath: string): ResolvedLink => ({
        elementId,
        refId: "Sub_Process",
        refType: "caller",
        targetPath,
    });

    it("(a) collapses all-duplicate callers into a single candidate", () => {
        const links = [
            makeCallerLink("Start_1", "callerA.bpmn"),
            makeCallerLink("Start_1", "callerA.bpmn"),
            makeCallerLink("Start_1", "callerA.bpmn"),
        ];
        const { callerGroups } = groupCallerLinks(links);

        expect(callerGroups).toHaveLength(1);
        expect(callerGroups[0].candidates).toHaveLength(1);
        expect(callerGroups[0].candidates[0].relativePath).toBe("callerA.bpmn");
    });

    it("(b) retains unique entries and removes duplicates from mixed input", () => {
        const links = [
            makeCallerLink("Start_1", "callerA.bpmn"),
            makeCallerLink("Start_1", "callerB.bpmn"),
            makeCallerLink("Start_1", "callerA.bpmn"), // duplicate of first
        ];
        const { callerGroups } = groupCallerLinks(links);

        expect(callerGroups).toHaveLength(1);
        expect(callerGroups[0].candidates).toHaveLength(2);
        const paths = callerGroups[0].candidates.map((c) => c.relativePath);
        expect(paths).toContain("callerA.bpmn");
        expect(paths).toContain("callerB.bpmn");
    });

    it("(c) preserves all entries when no duplicates are present", () => {
        const links = [
            makeCallerLink("Start_1", "callerA.bpmn"),
            makeCallerLink("Start_1", "callerB.bpmn"),
            makeCallerLink("Start_1", "callerC.bpmn"),
        ];
        const { callerGroups } = groupCallerLinks(links);

        expect(callerGroups).toHaveLength(1);
        expect(callerGroups[0].candidates).toHaveLength(3);
    });

    it("deduplicates independently per elementId group", () => {
        const links = [
            makeCallerLink("Start_A", "shared.bpmn"),
            makeCallerLink("Start_A", "shared.bpmn"), // dup in group A
            makeCallerLink("Start_B", "shared.bpmn"),
            makeCallerLink("Start_B", "shared.bpmn"), // dup in group B
        ];
        const { callerGroups } = groupCallerLinks(links);

        expect(callerGroups).toHaveLength(2);
        for (const group of callerGroups) {
            expect(group.candidates).toHaveLength(1);
            expect(group.candidates[0].relativePath).toBe("shared.bpmn");
        }
    });

    it("showLinks sends openLinkedFile (not chooser) when duplicates reduce to one candidate", () => {
        const overlays = { add: vi.fn().mockReturnValue("ov-dedup"), remove: vi.fn() };
        const eventBus = { on: vi.fn() };
        const sut = new LinkedResourceOverlays(overlays, eventBus);
        const mockVscode = { postMessage: vi.fn() };
        sut.setVsCodeApi(mockVscode);

        let capturedHtml: HTMLElement | null = null;
        overlays.add.mockImplementation(
            (_elementId: string, _type: string, opts: { html: HTMLElement }) => {
                capturedHtml = opts.html;
                return "ov-dedup";
            },
        );

        sut.showLinks([
            { elementId: "Start_1", refId: "Sub", refType: "caller", targetPath: "callerA.bpmn" },
            { elementId: "Start_1", refId: "Sub", refType: "caller", targetPath: "callerA.bpmn" },
        ]);

        capturedHtml!.click();
        expect(mockVscode.postMessage).toHaveBeenCalledWith({
            type: "openLinkedFile",
            relativePath: "callerA.bpmn",
        });
    });
});
