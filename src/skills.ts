import { fromManifest, parseSkillMarkdown } from "agents/skills";
import { skillFiles } from "./skill-files";

/**
 * The skill catalog of the task agent: what it can do and how its sandbox works.
 * `activate_skill` loads a body on demand. The same files are copied into the
 * sandbox as /workspace/.agents/skills by the Dockerfile.
 */
export const bundledSkills = fromManifest({
  id: "bundle:skills",
  // The content is the fingerprint: Think compares it with the stored one to
  // decide whether to rebuild the system prompt, so an edit lands on the next deploy.
  fingerprint: skillFiles.join("\n"),
  skills: skillFiles.map(parseSkillMarkdown).filter((skill) => skill !== null),
});
