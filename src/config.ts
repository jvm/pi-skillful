import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type SkillfulScope = "global" | "project";

export interface SkillfulSettings {
  hiddenSkills: string[];
}

interface PiSettingsDocument {
  skillful?: Partial<SkillfulSettings>;
  [key: string]: unknown;
}

export const SKILLFUL_SETTINGS_KEY = "skillful";

export function globalSettingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

export function settingsPath(scope: SkillfulScope, cwd: string): string {
  return scope === "global" ? globalSettingsPath() : projectSettingsPath(cwd);
}

export function normalizeSkillName(name: string): string {
  return name.trim().replace(/^skill:/, "");
}

export function normalizeSkillNames(names: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(names)
        .map(normalizeSkillName)
        .filter((name) => name.length > 0)
        .sort(),
    ),
  );
}

async function readSettingsDocument(path: string): Promise<PiSettingsDocument> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PiSettingsDocument) : {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function readSkillfulSettings(path: string): Promise<SkillfulSettings> {
  const settings = await readSettingsDocument(path);
  const skillful = settings[SKILLFUL_SETTINGS_KEY];
  const hiddenSkills =
    skillful && typeof skillful === "object" && Array.isArray(skillful.hiddenSkills)
      ? skillful.hiddenSkills.filter((name): name is string => typeof name === "string")
      : [];

  return { hiddenSkills: normalizeSkillNames(hiddenSkills) };
}

export async function readScopedSkillfulSettings(cwd: string): Promise<Record<SkillfulScope, SkillfulSettings>> {
  const [global, project] = await Promise.all([
    readSkillfulSettings(globalSettingsPath()),
    readSkillfulSettings(projectSettingsPath(cwd)),
  ]);
  return { global, project };
}

export async function readEffectiveHiddenSkills(cwd: string): Promise<Set<string>> {
  const scoped = await readScopedSkillfulSettings(cwd);
  return new Set([...scoped.global.hiddenSkills, ...scoped.project.hiddenSkills]);
}

export async function writeHiddenSkills(
  scope: SkillfulScope,
  cwd: string,
  hiddenSkills: Iterable<string>,
): Promise<SkillfulSettings> {
  const path = settingsPath(scope, cwd);
  const document = await readSettingsDocument(path);
  const updated = normalizeSkillNames(hiddenSkills);

  if (updated.length === 0) {
    delete document[SKILLFUL_SETTINGS_KEY];
  } else {
    document[SKILLFUL_SETTINGS_KEY] = {
      ...(document[SKILLFUL_SETTINGS_KEY] && typeof document[SKILLFUL_SETTINGS_KEY] === "object"
        ? document[SKILLFUL_SETTINGS_KEY]
        : {}),
      hiddenSkills: updated,
    };
  }

  if (scope === "project" && Object.keys(document).length === 0) {
    await unlinkIfExists(path);
    return { hiddenSkills: updated };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  return { hiddenSkills: updated };
}

export async function updateHiddenSkills(
  scope: SkillfulScope,
  cwd: string,
  updater: (current: string[]) => string[],
): Promise<SkillfulSettings> {
  const path = settingsPath(scope, cwd);
  const current = await readSkillfulSettings(path);
  return writeHiddenSkills(scope, cwd, updater(current.hiddenSkills));
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
