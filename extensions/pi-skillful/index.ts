import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import inlineSkillInvocation from "../../src/extensions/inline-skill-invocation.js";
import skillVisibility from "../../src/extensions/skill-visibility.js";

export default function piSkillful(pi: ExtensionAPI) {
  inlineSkillInvocation(pi);
  skillVisibility(pi);
}
