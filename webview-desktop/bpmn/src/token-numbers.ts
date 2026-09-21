// bpmn-js-token-simulation labels every token "1". Number each new process
// instance (root scope) 1, 2, 3, ... and show that number on the animated
// tokens and on the token-count badges. Mirrors bpmn-to-image's
// token-number-patch.
import Animation from "bpmn-js-token-simulation/lib/animation/Animation";
import TokenCount from "bpmn-js-token-simulation/lib/features/token-count/TokenCount";

interface NumberedScope {
    tokenNumber?: number;
    parent?: NumberedScope;
}

const originalGetTokenSVG = Animation.prototype._getTokenSVG;
Animation.prototype._getTokenSVG = function (scope: NumberedScope): string {
    const svg: string = originalGetTokenSVG.call(this, scope);
    const tokenNumber = scope?.tokenNumber ?? 1;
    return svg.replace(
        /(<text[^>]*class="[^"]*bts-text[^"]*"[^>]*>)\s*1\s*(<\/text>)/,
        `$1${tokenNumber}$2`,
    );
};

const originalGetTokenHTML = TokenCount.prototype._getTokenHTML;
TokenCount.prototype._getTokenHTML = function (element: unknown, scope: NumberedScope): string {
    const html: string = originalGetTokenHTML.call(this, element, scope);
    if (scope?.tokenNumber == null) {
        return html;
    }
    return html.replace(
        /(<div[^>]*class="[^"]*bts-token-count[^"]*"[^>]*>)\s*[\d.]+\s*(<\/div>)/,
        `$1${scope.tokenNumber}$2`,
    );
};

function TokenNumbering(this: unknown, eventBus: any) {
    let nextTokenNumber = 1;

    eventBus.on("tokenSimulation.simulator.createScope", ({ scope }: { scope?: NumberedScope }) => {
        if (!scope) return;
        if (scope.parent) {
            if (scope.parent.tokenNumber != null) {
                scope.tokenNumber = scope.parent.tokenNumber;
            }
        } else {
            scope.tokenNumber = nextTokenNumber++;
        }
    });

    eventBus.on("tokenSimulation.resetSimulation", () => {
        nextTokenNumber = 1;
    });
}
TokenNumbering.$inject = ["eventBus"];

export default {
    __init__: ["tokenNumbering"],
    tokenNumbering: ["type", TokenNumbering],
};
