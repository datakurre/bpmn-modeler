import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";
import { existsSync } from "fs";

// Conditionally include the operaton-dmn TeaVM bundle if it was built (see
// vscode-operaton-dmn-js-modeler's `make build-operaton-dmn`, or the
// checked-in copy under src/engine/). It is copied to the build's output
// root (not an `assets/` subfolder) because `engine/operaton-dmn.ts` loads
// it via a `@vite-ignore` relative dynamic import that resolves against the
// compiled entry chunk's own location — see
// `build.rollupOptions.output.entryFileNames` below, which keeps that chunk
// at the output root too.
const operatonBundlePath = resolve(__dirname, "src/engine/operaton-dmn-bundle.js");
const operatonCopyTargets = existsSync(operatonBundlePath)
    ? [
          {
              src: "src/engine/operaton-dmn-bundle.js",
              dest: ".",
          },
      ]
    : [];

export default defineConfig({
    root: resolve(__dirname),
    base: "./",
    cacheDir: "../../node_modules/.vite/dmn-desktop",
    server: {
        port: 1420,
        strictPort: true,
    },
    resolve: {
        dedupe: ["dmn-js", "diagram-js", "@bpmn-io/properties-panel", "min-dash"],
    },
    plugins: operatonCopyTargets.length > 0 ? [viteStaticCopy({ targets: operatonCopyTargets })] : [],
    build: {
        target: "es2021",
        commonjsOptions: { transformMixedEsModules: true },
        chunkSizeWarningLimit: 1400,
        outDir: "../../dist/desktop/dmn",
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(__dirname, "index.html"),
            output: {
                entryFileNames: "[name].js",
                chunkFileNames: "[name].js",
            },
        },
    },
    define: {
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
    },
});
