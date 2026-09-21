// Extends the installed camunda-bpmn-moddle with modelerTemplateIcon support.
// We augment the existing TemplateSupported abstract type rather than registering
// a second moddle extension with the same "camunda" prefix, which would cause
// "package with prefix <camunda> already defined" at runtime.
import camundaModdle from "camunda-bpmn-moddle/resources/camunda.json";

const enhanced = JSON.parse(JSON.stringify(camundaModdle)) as typeof camundaModdle;

const templateSupported = (enhanced as any).types.find((t: any) => t.name === "TemplateSupported");
if (templateSupported) {
    templateSupported.properties.push({
        name: "modelerTemplateIcon",
        isAttr: true,
        type: "String",
    });
}

export default enhanced;
