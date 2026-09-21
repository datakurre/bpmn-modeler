/**
 * Vendored integration of the camunda-modeler-embedded-comments-plugin.
 * Source: https://github.com/datakurre/camunda-modeler-embedded-comments-plugin
 *
 * The underlying bpmn-js module is provided by the {@link bpmn-js-embedded-comments}
 * npm package. Only the plugin wrapper (moddle extension + registration logic) is
 * vendored here.
 */

/* @ts-expect-error - bpmn-js-embedded-comments does not ship type definitions */
import EmbeddedCommentsModule from "bpmn-js-embedded-comments";

import "./comments.css";

/**
 * Minimal moddle extension required to persist comments inside the BPMN XML.
 * Taken from the plugin's client.js (commit 1eafe73).
 */
export const EmbeddedCommentsModdleExtension = {
    name: "documentation",
    uri: "http://example.com/myextension",
    prefix: "doc",
    xml: {
        tagAlias: "lowerCase",
    },
    associations: [],
    types: [
        {
            name: "Documentation",
            properties: [
                {
                    name: "documentation",
                    isAttr: true,
                    type: "String",
                },
            ],
        },
    ],
};

export { EmbeddedCommentsModule };
