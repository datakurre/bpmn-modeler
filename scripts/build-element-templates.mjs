#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import esbuild from "esbuild";
import Ajv from "ajv";
import ajvErrors from "ajv-errors";
import standaloneCode from "ajv/dist/standalone/index.js";
import { set } from "min-dash";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const vendorDirArg = process.argv[2] ?? "vendor/bpmn-js-modeler/vendor";
const VENDOR_DIR = path.isAbsolute(vendorDirArg)
    ? vendorDirArg
    : path.join(ROOT_DIR, vendorDirArg);

const schemaDir = path.join(VENDOR_DIR, "operaton-element-templates-json-schema");
const validatorDir = path.join(VENDOR_DIR, "operaton-element-templates-validator");
const templatesDir = path.join(VENDOR_DIR, "operaton-element-templates");

function withErrorMessages(schema, errors) {
    if (!errors || !errors.length) return schema;
    let newSchema = JSON.parse(JSON.stringify(schema));
    for (const error of errors) {
        const { path: errPath, errorMessage } = error;
        const errorMessagePath = [...errPath, "errorMessage"];
        newSchema = set(newSchema, errorMessagePath, errorMessage);
    }
    return newSchema;
}

async function main() {
    console.log(`[build-element-templates] Building vendored modules in ${VENDOR_DIR}...`);

    const requiredFiles = [
        path.join(templatesDir, "src/index.js"),
        path.join(templatesDir, "assets"),
        path.join(validatorDir, "lib/index.js"),
    ];
    for (const file of requiredFiles) {
        if (!fs.existsSync(file)) {
            console.error(`[build-element-templates] Required submodule file not found: ${file}`);
            console.error(
                `[build-element-templates] Did you run: git submodule update --init --recursive?`,
            );
            process.exit(1);
        }
    }

    // 1. Ensure resources in operaton-element-templates-json-schema
    const resourcesDir = path.join(
        schemaDir,
        "packages/element-templates-json-schema/resources",
    );
    fs.mkdirSync(resourcesDir, { recursive: true });

    const bundledSchemaPath = path.join(resourcesDir, "schema.json");
    const bundledErrorsPath = path.join(resourcesDir, "error-messages.json");

    const srcSchema = path.join(__dirname, "resources/element-templates/schema.json");
    const srcErrors = path.join(__dirname, "resources/element-templates/error-messages.json");

    if (fs.existsSync(srcSchema)) {
        fs.copyFileSync(srcSchema, bundledSchemaPath);
    }
    if (fs.existsSync(srcErrors)) {
        fs.copyFileSync(srcErrors, bundledErrorsPath);
    }

    const schema = JSON.parse(fs.readFileSync(bundledSchemaPath, "utf8"));
    const errorMessages = JSON.parse(fs.readFileSync(bundledErrorsPath, "utf8"));

    // 2. Build operaton-element-templates-validator
    console.log("[build-element-templates] Building validator standalone code...");
    const ajv = new Ajv({
        allErrors: true,
        messages: true,
        strict: false,
        code: { source: true, esm: true },
    });
    ajvErrors(ajv);

    const validate = ajv.compile(withErrorMessages(schema, errorMessages));
    const standaloneValidatorCode = standaloneCode(ajv, validate);

    const validatorTmpDir = path.join(validatorDir, "tmp");
    fs.mkdirSync(validatorTmpDir, { recursive: true });
    const standaloneValidatorPath = path.join(validatorTmpDir, "standaloneValidator.js");
    fs.writeFileSync(standaloneValidatorPath, standaloneValidatorCode, "utf8");

    const validatorDistDir = path.join(validatorDir, "dist");
    fs.mkdirSync(validatorDistDir, { recursive: true });

    console.log("[build-element-templates] Bundling operaton-element-templates-validator...");
    await esbuild.build({
        entryPoints: [path.join(validatorDir, "lib/index.js")],
        bundle: true,
        format: "esm",
        external: ["min-dash"],
        outfile: path.join(validatorDistDir, "index.js"),
        plugins: [
            {
                name: "alias-validate",
                setup(build) {
                    build.onResolve({ filter: /validate(\.js)?$/ }, () => ({
                        path: standaloneValidatorPath,
                    }));
                },
            },
        ],
    });

    await esbuild.build({
        entryPoints: [path.join(validatorDir, "lib/index.js")],
        bundle: true,
        format: "cjs",
        external: ["min-dash"],
        outfile: path.join(validatorDistDir, "index.cjs"),
        plugins: [
            {
                name: "alias-validate",
                setup(build) {
                    build.onResolve({ filter: /validate(\.js)?$/ }, () => ({
                        path: standaloneValidatorPath,
                    }));
                },
            },
        ],
    });

    // 3. Build operaton-element-templates
    console.log("[build-element-templates] Bundling operaton-element-templates...");
    const templatesDistDir = path.join(templatesDir, "dist");
    fs.mkdirSync(templatesDistDir, { recursive: true });

    await esbuild.build({
        entryPoints: [path.join(templatesDir, "src/index.js")],
        bundle: true,
        format: "esm",
        loader: { ".js": "jsx" },
        jsx: "automatic",
        jsxImportSource: "@bpmn-io/properties-panel/preact",
        alias: {
            react: "@bpmn-io/properties-panel/preact/compat",
            preact: "@bpmn-io/properties-panel/preact",
            "@bpmn-io/element-templates-validator": path.join(
                validatorDistDir,
                "index.js",
            ),
        },
        external: [
            "bpmn-js",
            "diagram-js",
            "min-dash",
            "min-dom",
            "@bpmn-io/properties-panel",
            "bpmn-js-properties-panel",
        ],
        outfile: path.join(templatesDistDir, "index.esm.js"),
    });

    // Copy assets
    const srcAssetsDir = path.join(templatesDir, "assets");
    const destAssetsDir = path.join(templatesDistDir, "assets");
    fs.mkdirSync(destAssetsDir, { recursive: true });
    for (const file of fs.readdirSync(srcAssetsDir)) {
        if (file.endsWith(".css")) {
            fs.copyFileSync(path.join(srcAssetsDir, file), path.join(destAssetsDir, file));
        }
    }

    console.log("[build-element-templates] Successfully built all vendored modules.");
}

main().catch((err) => {
    console.error("[build-element-templates] Failed:", err);
    process.exit(1);
});
