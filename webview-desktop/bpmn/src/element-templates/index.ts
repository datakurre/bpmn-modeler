import templateElementFactory from "./create";
import { ExtendElementTemplatesClass } from "./ExtendElementTemplates";
import { SafeRemoveTemplateReplaceClass } from "./SafeRemoveTemplateReplace";

export const ExtendElementTemplates = {
    __depends__: [templateElementFactory],
    __init__: ["extendedElementTemplates", "safeRemoveTemplateReplace"],
    extendedElementTemplates: ["type", ExtendElementTemplatesClass],
    safeRemoveTemplateReplace: ["type", SafeRemoveTemplateReplaceClass],
};
