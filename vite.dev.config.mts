import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";

/**
 * Tauri's multiwebview app resolves every `WebviewUrl::App(path)` — for the
 * shell and for each open tab's editor webview — against the single
 * `build.devUrl` in dev mode, using the same relative paths the production
 * build serves from `dist/desktop/{shell,bpmn,dmn,form}/`. Since the bpmn/
 * dmn/form sources actually live under `webview-desktop/<kind>/`, rewrite
 * incoming `/bpmn`, `/dmn`, `/form` requests (and everything relative under
 * them, since the browser resolves a page's own asset URLs against its own
 * path) to their real location. `/shell` already matches `shell/` at the
 * repo root, so it needs no rewrite.
 */
function rewriteEditorPaths(): Plugin {
    return {
        name: "rewrite-editor-paths",
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                if (req.url) {
                    req.url = req.url.replace(/^\/(bpmn|dmn|form)(\/|\?|$)/, "/webview-desktop/$1$2");
                }
                next();
            });
        },
    };
}

export default defineConfig({
    root: resolve(__dirname),
    base: "/",
    server: {
        port: 1420,
        strictPort: true,
    },
    plugins: [rewriteEditorPaths()],
    resolve: {
        // Union of the per-app dedupe lists (webview-desktop/{bpmn,dmn}/vite.config.mts)
        // — a single dev server serves every app, so duplicate-instance
        // bugs across bpmn-js/dmn-js/diagram-js-family packages must be
        // avoided globally, not per app.
        dedupe: [
            "@bpmn-io/element-template-icon-renderer",
            "@bpmn-io/properties-panel",
            "bpmn-js-properties-panel",
            "bpmn-js",
            "diagram-js",
            "dmn-js",
            "preact",
            "min-dash",
            "bpmn-moddle",
        ],
        // Union of the per-app alias maps — only bpmn's modules import these
        // specifiers, so there's no cross-app collision risk.
        alias: {
            "bpmn-auto-layout": resolve(
                __dirname,
                "vendor/bpmn-js-modeler/vendor/bpmn-auto-layout/dist/index.js",
            ),
            "bpmn-js-element-templates": resolve(
                __dirname,
                "vendor/bpmn-js-modeler/vendor/operaton-element-templates/dist/index.esm.js",
            ),
            "@bpmn-io/element-templates-validator": resolve(
                __dirname,
                "vendor/bpmn-js-modeler/vendor/operaton-element-templates-validator/dist/index.js",
            ),
        },
    },
    define: {
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
    },
});
