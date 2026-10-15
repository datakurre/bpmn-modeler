import { getBusinessObject } from "bpmn-js/lib/util/ModelUtil";

export class ExtendElementTemplatesClass {
    public static $inject: string[];

    constructor(elementTemplates: any, templateElementFactory: any, eventBus: any) {
        const proto = Object.getPrototypeOf(elementTemplates);
        if (proto && !proto.createElement) {
            proto.createElement = (template: any) => {
                if (!template) {
                    throw new Error("template is missing");
                }
                return templateElementFactory.create(template);
            };
        }

        const setTemplateIcon = ({ context }: any, templateKey: "newTemplate" | "oldTemplate") => {
            const { element } = context;
            const icon = context[templateKey]?.icon?.contents;
            const businessObject = getBusinessObject(element);

            if (businessObject.get("camunda:modelerTemplateIcon") !== icon) {
                businessObject.set("camunda:modelerTemplateIcon", icon);
                eventBus.fire("element.changed", { element });
            }
        };

        eventBus.on(
            "commandStack.propertiesPanel.camunda.changeTemplate.postExecute",
            (event: any) => setTemplateIcon(event, "newTemplate"),
        );
        eventBus.on(
            "commandStack.propertiesPanel.camunda.changeTemplate.postRevert",
            (event: any) => setTemplateIcon(event, "oldTemplate"),
        );
        eventBus.on("commandStack.propertiesPanel.removeTemplate.postExecute", (event: any) =>
            setTemplateIcon(event, "newTemplate"),
        );
        eventBus.on("commandStack.propertiesPanel.removeTemplate.postRevert", (event: any) =>
            setTemplateIcon(event, "oldTemplate"),
        );
    }
}

ExtendElementTemplatesClass.$inject = ["elementTemplates", "templateElementFactory", "eventBus"];
