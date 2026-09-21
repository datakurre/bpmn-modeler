import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
    root: resolve(__dirname),
    base: "./",
    cacheDir: "../node_modules/.vite/shell",
    server: {
        port: 1420,
        strictPort: true,
    },
    build: {
        target: "es2021",
        outDir: "../dist/desktop/shell",
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(__dirname, "index.html"),
        },
    },
});
