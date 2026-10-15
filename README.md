# Operaton Modeler

Unified Linux desktop modeler for BPMN, DMN, and Form definitions.

## Development

The default Nix shell contains the tools required to build and run the Tauri
application:

```sh
nix develop --command npm ci
nix develop --command npm run typecheck
nix develop --command npm run build:webview:desktop
nix develop --command npm run desktop:dev
```

Use `nix develop .#extension-dev` when building or inspecting the Java and
Scala-based extension engines.

The extension source repositories are pinned as remote Git inputs in
`flake.lock`:

- `vasara-bpm/vscode-operaton-bpmn-js-modeler`
- `vasara-bpm/vscode-operaton-dmn-js-modeler`
- `vasara-bpm/vscode-operaton-form-js-modeler`

Hermetic Nix builds (`nix build .#frontend`) automatically unpack these flake
inputs into the build environment. For local development with `npm run build:webview:desktop`
or `npm run desktop:dev`, vendor dependencies must be initialized once by running:

```sh
npm run setup:vendor
```

For development against editable local checkouts of the extensions, place the three
repositories next to this one before running `npm run setup:vendor`.

## Builds and Checks

```sh
nix flake show
nix build .#frontend
nix build .#default
nix flake check
```

The frontend build enforces TypeScript compilation and bundle-size budgets for
the shell, BPMN, DMN, and Form outputs.

## Dependency Updates

Upstream flake inputs can be updated using `nix flake update`:

```sh
# Update all inputs
nix flake update

# Or update a specific extension input:
nix flake update bpmnRepo
```

If upstream updates introduce new or updated npm dependencies in `package-lock.json`,
update `npmDepsHash` in `flake.nix` with the new SRI hash reported by Nix.
