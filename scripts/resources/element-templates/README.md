# Bundled Element Template Resources

These JSON resources (`schema.json` and `error-messages.json`) are used by `scripts/build-element-templates.mjs` to bundle `operaton-element-templates-validator` hermetically without requiring an `npm install` inside the submodule during Nix or local builds.

- `schema.json`: Complete JSON schema defining the element templates specification (dereferenced from `@bpmn-io/element-templates-json-schema`).
- `error-messages.json`: Error message mappings for element template validation rules.
