import { getBusinessObject } from "bpmn-js/lib/util/ModelUtil";

export default class TemplateElementFactory {
    public static $inject: string[];

    private readonly commandStack: any;
    private readonly elementFactory: any;

    constructor(commandStack: any, elementFactory: any) {
        this.commandStack = commandStack;
        this.elementFactory = elementFactory;
    }

    public create(template: any) {
        const element = this.createShape(template);
        this.setModelerTemplate(element, template);

        this.commandStack.execute("propertiesPanel.camunda.changeTemplate", {
            element,
            oldTemplate: null,
            newTemplate: template,
        });

        return element;
    }

    private createShape(template: any) {
        const { appliesTo, elementType = {} } = template;
        const attrs: any = {
            type: elementType.value || appliesTo[0],
        };

        if (elementType.eventDefinition) {
            attrs.eventDefinitionType = elementType.eventDefinition;
        }

        return this.elementFactory.createShape(attrs);
    }

    private setModelerTemplate(element: any, template: any) {
        const { id, version, icon } = template;
        const businessObject = getBusinessObject(element);
        businessObject.set("camunda:modelerTemplate", id);
        businessObject.set("camunda:modelerTemplateVersion", version);
        if (icon && icon.contents) {
            businessObject.set("camunda:modelerTemplateIcon", icon.contents);
        }
    }
}

TemplateElementFactory.$inject = ["commandStack", "elementFactory"];
