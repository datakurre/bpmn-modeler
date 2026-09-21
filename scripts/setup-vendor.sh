#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

mkdir -p "$ROOT_DIR/vendor"

ln -sfn "$ROOT_DIR/vscode-operaton-bpmn-js-modeler" "$ROOT_DIR/vendor/bpmn-js-modeler"
ln -sfn "$ROOT_DIR/vscode-operaton-dmn-js-modeler" "$ROOT_DIR/vendor/dmn-js-modeler"
ln -sfn "$ROOT_DIR/vscode-operaton-form-js-modeler" "$ROOT_DIR/vendor/form-js-modeler"

if [ ! -d "$ROOT_DIR/vendor/bpmn-auto-layout" ]; then
    git clone https://github.com/datakurre/bpmn-auto-layout.git "$ROOT_DIR/vendor/bpmn-auto-layout"
fi

if [ ! -f "$ROOT_DIR/vendor/bpmn-auto-layout/dist/index.js" ]; then
    (
        cd "$ROOT_DIR/vendor/bpmn-auto-layout"
        "$ROOT_DIR/node_modules/.bin/esbuild" src/index.ts \
            --bundle --format=esm --platform=node \
            --external:bpmn-moddle --external:bpmn-js \
            --outfile=dist/index.js --loader:.json=json
    )
fi

# vite.dev.config.mts aliases "bpmn-auto-layout" to
# vendor/bpmn-js-modeler/vendor/bpmn-auto-layout/dist/index.js, which — via
# the vendor/bpmn-js-modeler symlink above — resolves inside the
# vscode-operaton-bpmn-js-modeler checkout, not under the top-level vendor/
# built here. Link it through so `npm run desktop:dev` can find it.
mkdir -p "$ROOT_DIR/vscode-operaton-bpmn-js-modeler/vendor"
ln -sfn "$ROOT_DIR/vendor/bpmn-auto-layout" "$ROOT_DIR/vscode-operaton-bpmn-js-modeler/vendor/bpmn-auto-layout"

echo "Vendor setup completed in $ROOT_DIR/vendor"
