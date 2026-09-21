import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

export default defineConfig({
    root: resolve(__dirname),
    base: "./",
    cacheDir: "../node_modules/.vite/bpmn-desktop",
    server: {
        port: 1420,
        strictPort: true,
    },
    resolve: {
        dedupe: [
            "@bpmn-io/element-template-icon-renderer",
            "@bpmn-io/properties-panel",
            "bpmn-js-properties-panel",
            "bpmn-js",
            "diagram-js",
            "preact",
            "min-dash",
            "bpmn-moddle",
        ],
        alias: {
            "bpmn-auto-layout": resolve(
                __dirname,
                "../vendor/bpmn-auto-layout/dist/index.js",
            ),
            "bpmn-js-element-templates": resolve(
                __dirname,
                "../vendor/operaton-element-templates/dist/index.esm.js",
            ),
            "@bpmn-io/element-templates-validator": resolve(
                __dirname,
                "../vendor/operaton-element-templates-validator/dist/index.js",
            ),
        },
    },
    plugins: [
        viteStaticCopy({
            targets: [
                {
                    src: "../node_modules/camunda-bpmn-js/dist/assets/bpmn-font/css/*",
                    dest: "css/",
                },
                {
                    src: "../node_modules/camunda-bpmn-js/dist/assets/bpmn-font/font/*",
                    dest: "font/",
                },
            ],
        }),
    ],
    build: {
        target: "es2021",
        commonjsOptions: { transformMixedEsModules: true },
        chunkSizeWarningLimit: 1200,
        outDir: "../dist/desktop",
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(__dirname, "index.html"),
        },
    },
    define: {
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
    },
});
