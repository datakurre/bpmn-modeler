import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Default to node; individual test files that need a DOM opt in
        // with a `@vitest-environment jsdom` docblock.
        environment: "node",
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "vendor/**",
            "../vscode-operaton-*/**",
        ],
    },
});
