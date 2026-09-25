import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import "./shell.css";

type EditorKind = "bpmn" | "dmn" | "form";

interface TabInfo {
    id: string;
    kind: EditorKind;
    filePath: string | null;
    label: string;
    dirty: boolean;
    hasBeenSaved: boolean;
}

interface TabsPayload {
    tabs: TabInfo[];
    activeTabId: string | null;
}

const KIND_LABELS: Record<EditorKind, string> = {
    bpmn: "BPMN diagram",
    dmn: "DMN diagram",
    form: "Form",
};

let state: TabsPayload = { tabs: [], activeTabId: null };

const tabsElement = document.getElementById("shell-tabs") as HTMLElement;
const emptyElement = document.getElementById("shell-empty") as HTMLElement;
const newMenu = document.getElementById("shell-new-menu") as HTMLElement;
const newToggle = document.getElementById("shell-new-toggle") as HTMLButtonElement;

function render(): void {
    tabsElement.innerHTML = "";

    for (const tab of state.tabs) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = tab.id === state.activeTabId ? "shell-tab active" : "shell-tab";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(tab.id === state.activeTabId));
        button.title = `${KIND_LABELS[tab.kind]}: ${tab.filePath ?? tab.label}`;

        const kindDot = document.createElement("span");
        kindDot.className = `shell-tab-kind shell-tab-kind-${tab.kind}`;
        kindDot.setAttribute("aria-hidden", "true");
        button.appendChild(kindDot);

        const labelSpan = document.createElement("span");
        labelSpan.className = "shell-tab-label";
        labelSpan.textContent = tab.dirty ? `${tab.label} ●` : tab.label;
        button.appendChild(labelSpan);

        const closeButton = document.createElement("span");
        closeButton.className = "shell-tab-close";
        closeButton.textContent = "×";
        closeButton.setAttribute("role", "button");
        closeButton.setAttribute("aria-label", `Close ${tab.label}`);
        closeButton.addEventListener("click", (event) => {
            event.stopPropagation();
            void invoke("close_tab", { tabId: tab.id });
        });
        button.appendChild(closeButton);

        button.addEventListener("click", () => {
            if (tab.id !== state.activeTabId) void invoke("focus_tab", { tabId: tab.id });
        });

        tabsElement.appendChild(button);
    }

    emptyElement.hidden = state.tabs.length > 0;
}

async function refresh(): Promise<void> {
    state = await invoke<TabsPayload>("get_tabs");
    render();
}

async function openFile(): Promise<void> {
    // The dialog runs entirely in Rust (pick_and_open_file) rather than
    // this webview picking a path and passing it to open_tab, so an
    // arbitrary path never needs to cross the IPC boundary for this flow.
    await invoke("pick_and_open_file");
}

async function newFile(kind: EditorKind): Promise<void> {
    await invoke("open_tab", { kind });
}

function closeNewMenu(): void {
    newMenu.hidden = true;
    newToggle.setAttribute("aria-expanded", "false");
}

document.getElementById("shell-open")?.addEventListener("click", () => void openFile());
document.getElementById("shell-empty-open")?.addEventListener("click", () => void openFile());

document.getElementById("shell-minimize")?.addEventListener("click", () => {
    void invoke("minimize_window");
});
document.getElementById("shell-maximize")?.addEventListener("click", () => {
    void invoke("maximize_window");
});
document.getElementById("shell-quit")?.addEventListener("click", () => {
    void invoke("quit_app");
});

newToggle?.addEventListener("click", () => {
    const isHidden = newMenu.hidden;
    newMenu.hidden = !isHidden;
    newToggle.setAttribute("aria-expanded", String(isHidden));
});

document.addEventListener("click", (event) => {
    if (!newMenu.hidden && !newMenu.contains(event.target as Node) && event.target !== newToggle) {
        closeNewMenu();
    }
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-kind]")) {
    button.addEventListener("click", () => {
        const kind = button.dataset.kind as EditorKind;
        closeNewMenu();
        void newFile(kind);
    });
}

listen<TabsPayload>("tabs-changed", (event) => {
    state = event.payload;
    render();
});

window.addEventListener("keydown", (event) => {
    const modifierPressed = event.ctrlKey || event.metaKey;
    if (modifierPressed && event.key.toLowerCase() === "q") {
        event.preventDefault();
        void invoke("quit_app");
    }
});

void refresh();
