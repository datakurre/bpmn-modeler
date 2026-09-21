import "./diff.css";
import { renderDiff } from "./diffViewer";

declare function acquireVsCodeApi(): {
    postMessage(msg: any): void;
    getState(): any;
    setState(state: any): void;
};

export const vscode = acquireVsCodeApi();

window.addEventListener("message", async (event) => {
    const msg = event.data;
    if (msg.type === "showDiff") {
        await renderDiff(
            msg.oldXml,
            msg.newXml,
            msg.title,
            msg.changesets ?? [],
            msg.currentRef ?? "",
            msg.currentCompareRef ?? "CURRENT",
            msg.initialViewbox,
        );
    }
});

// Notify the extension that the webview JS is loaded and the message listener
// is active. The extension buffers the initial showDiff payload and sends it
// only after receiving this signal, avoiding the first-load race condition.
vscode.postMessage({ type: "ready" });
