/**
 * Guards the "remove template" replace menu entry of
 * `bpmn-js-create-append-anything` (up to at least 2.1.0).
 *
 * Its lookup assumes every export of bpmn-js `ReplaceOptions` is an array, but
 * bpmn-js 18 exports `TYPED_EVENT` as an object. For elements without a
 * matching option group (e.g. a process or a sequence flow with a template
 * applied), building the replace menu then throws and breaks the properties
 * panel. Without a matching group there is no plain element to offer, so we
 * skip the entry instead.
 */
export class SafeRemoveTemplateReplaceClass {
    public static $inject = ["injector"];

    constructor(injector: any) {
        const provider = injector.get("removeTemplateReplaceProvider", false);

        if (!provider || typeof provider.getPlainEntry !== "function") {
            return;
        }

        const getPlainEntry = provider.getPlainEntry;

        provider.getPlainEntry = function (...args: unknown[]) {
            try {
                return getPlainEntry.apply(this, args);
            } catch (error) {
                if (
                    error instanceof TypeError &&
                    error.message.includes("findIndex")
                ) {
                    return undefined;
                }

                throw error;
            }
        };
    }
}
