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

The extension source repositories are pinned as remote GitLab inputs in
`flake.lock`:

- `vasara-bpm/vscode-operaton-bpmn-js-modeler`
- `vasara-bpm/vscode-operaton-dmn-js-modeler`
- `vasara-bpm/vscode-operaton-form-js-modeler`

Normal Nix builds do not require local checkouts of these repositories. For
local development against an editable extension checkout, place the three
repositories next to this one and run `npm run setup:vendor`.

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

Pinned GitHub and GitLab dependencies can be updated with:

```sh
./scripts/update-flake-deps.sh --dry-run
```

Review the generated revision and hash changes before writing them to
`flake.nix`.
