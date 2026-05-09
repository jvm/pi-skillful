import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type SkillfulScope = "global" | "project";
export type SkillToggleSlot = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
export const SUPPORTED_TOGGLE_MODIFIERS = [
  "alt",
  "ctrl",
  "ctrl+shift",
  "alt+shift",
  "ctrl+alt",
  "ctrl+alt+shift",
] as const;
export type SkillToggleModifier = (typeof SUPPORTED_TOGGLE_MODIFIERS)[number];

export interface SkillToggleConfig {
  toggleSlots: Partial<Record<SkillToggleSlot, string>>;
  toggleModifier: SkillToggleModifier;
}

export interface SkillfulSettings extends SkillToggleConfig {
  hiddenSkills: string[];
}

export interface EffectiveSkillfulSettings extends SkillfulSettings {
  hiddenSkillSet: Set<string>;
}

interface PiSettingsDocument {
  skillful?: Partial<SkillfulSettings>;
  [key: string]: unknown;
}

export const SKILLFUL_SETTINGS_KEY = "skillful";
export const SKILL_TOGGLE_SLOTS: SkillToggleSlot[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
export const DEFAULT_TOGGLE_MODIFIER: SkillToggleModifier = "alt";

const SUPPORTED_TOGGLE_MODIFIERS_SET: ReadonlySet<string> = new Set(SUPPORTED_TOGGLE_MODIFIERS);

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

export function normalizeToggleSlots(value: unknown): Partial<Record<SkillToggleSlot, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Partial<Record<SkillToggleSlot, string>> = {};
  const seenSkillNames = new Set<string>();
  const source = value as Record<string, unknown>;

  for (const slot of SKILL_TOGGLE_SLOTS) {
    const rawName = source[slot];
    if (typeof rawName !== "string") continue;

    const name = normalizeSkillName(rawName);
    if (!name || seenSkillNames.has(name)) continue;

    result[slot] = name;
    seenSkillNames.add(name);
  }

  return result;
}

export function normalizeToggleModifier(value: unknown): SkillToggleModifier {
  if (typeof value !== "string") return DEFAULT_TOGGLE_MODIFIER;
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_TOGGLE_MODIFIERS_SET.has(normalized) ? (normalized as SkillToggleModifier) : DEFAULT_TOGGLE_MODIFIER;
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
  const skillfulObject = skillful && typeof skillful === "object" && !Array.isArray(skillful) ? skillful : {};
  const hiddenSkills = Array.isArray(skillfulObject.hiddenSkills)
    ? skillfulObject.hiddenSkills.filter((name): name is string => typeof name === "string")
    : [];

  return {
    hiddenSkills: normalizeSkillNames(hiddenSkills),
    toggleSlots: normalizeToggleSlots(skillfulObject.toggleSlots),
    toggleModifier: normalizeToggleModifier(skillfulObject.toggleModifier),
  };
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

export async function readEffectiveSkillfulSettings(cwd: string): Promise<EffectiveSkillfulSettings> {
  const scoped = await readScopedSkillfulSettings(cwd);
  const hiddenSkills = normalizeSkillNames([...scoped.global.hiddenSkills, ...scoped.project.hiddenSkills]);
  const toggleSlots = normalizeToggleSlots({ ...scoped.global.toggleSlots, ...scoped.project.toggleSlots });
  return {
    hiddenSkills,
    hiddenSkillSet: new Set(hiddenSkills),
    toggleSlots,
    toggleModifier:
      scoped.project.toggleModifier !== DEFAULT_TOGGLE_MODIFIER ? scoped.project.toggleModifier : scoped.global.toggleModifier,
  };
}

export async function writeHiddenSkills(
  scope: SkillfulScope,
  cwd: string,
  hiddenSkills: Iterable<string>,
): Promise<SkillfulSettings> {
  const path = settingsPath(scope, cwd);
  const document = await readSettingsDocument(path);
  const updated = normalizeSkillNames(hiddenSkills);

  const existingSkillful =
    document[SKILLFUL_SETTINGS_KEY] && typeof document[SKILLFUL_SETTINGS_KEY] === "object" && !Array.isArray(document[SKILLFUL_SETTINGS_KEY])
      ? (document[SKILLFUL_SETTINGS_KEY] as Record<string, unknown>)
      : {};
  const nextSkillful = { ...existingSkillful };

  if (updated.length === 0) delete nextSkillful.hiddenSkills;
  else nextSkillful.hiddenSkills = updated;

  if (Object.keys(nextSkillful).length === 0) delete document[SKILLFUL_SETTINGS_KEY];
  else document[SKILLFUL_SETTINGS_KEY] = nextSkillful as Partial<SkillfulSettings>;

  const result: SkillfulSettings = {
    hiddenSkills: updated,
    toggleSlots: normalizeToggleSlots(nextSkillful.toggleSlots),
    toggleModifier: normalizeToggleModifier(nextSkillful.toggleModifier),
  };

  if (scope === "project" && Object.keys(document).length === 0) {
    await unlinkIfExists(path);
    return result;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  return result;
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
