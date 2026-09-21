import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    root: resolve(__dirname),
    base: "./",
    cacheDir: "../node_modules/.vite/form-desktop",
    server: {
        port: 1420,
        strictPort: true,
    },
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
});
