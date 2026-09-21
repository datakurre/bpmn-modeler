import templateElementFactory from "./create";
import { ExtendElementTemplatesClass } from "./ExtendElementTemplates";

export const ExtendElementTemplates = {
    __depends__: [templateElementFactory],
    __init__: ["extendedElementTemplates"],
    extendedElementTemplates: ["type", ExtendElementTemplatesClass],
};
