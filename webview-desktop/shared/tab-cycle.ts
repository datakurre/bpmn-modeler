import { invoke } from "@tauri-apps/api/core";

interface TabInfo {
    id: string;
}

interface TabsPayload {
    tabs: TabInfo[];
    activeTabId: string | null;
}

async function cycleTab(direction: 1 | -1): Promise<void> {
    const { tabs, activeTabId } = await invoke<TabsPayload>("get_tabs");
    if (tabs.length < 2 || activeTabId === null) return;

    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    if (index === -1) return;

    const next = tabs[(index + direction + tabs.length) % tabs.length];
    await invoke("focus_tab", { tabId: next.id });
}

export function focusNextTab(): Promise<void> {
    return cycleTab(1);
}

export function focusPreviousTab(): Promise<void> {
    return cycleTab(-1);
}
