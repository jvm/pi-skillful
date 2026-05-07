import {
  DynamicBorder,
  formatSkillsForPrompt,
  getSettingsListTheme,
  InteractiveMode,
  type ExtensionAPI,
  type Skill,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import { type Component, Key, matchesKey, type SettingItem, SettingsList, truncateToWidth, type TUI } from "@mariozechner/pi-tui";
import {
  normalizeSkillName,
  normalizeSkillNames,
  readEffectiveHiddenSkills,
  readScopedSkillfulSettings,
  type SkillfulScope,
  writeHiddenSkills,
} from "../config.js";

const SKILLS_SECTION_PATTERN = /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/;
const SCOPES: SkillfulScope[] = ["global", "project"];
const STORE_KEY = Symbol.for("pi-skillful.skillVisibilityStore");
const STARTUP_SKILL_LIST_PATCH_KEY = Symbol.for("pi-skillful.startupSkillListPatchInstalled");

interface SkillVisibilityStore {
  hiddenSkillsByCwd: Map<string, Set<string>>;
  lastHiddenSkills: Set<string>;
}

const skillVisibilityStore = (((globalThis as Record<PropertyKey, unknown>)[STORE_KEY] as SkillVisibilityStore | undefined) ??= {
  hiddenSkillsByCwd: new Map<string, Set<string>>(),
  lastHiddenSkills: new Set<string>(),
}) as SkillVisibilityStore;

interface SkillListItem {
  name: string;
  description: string;
}

export default function skillVisibility(pi: ExtensionAPI) {
  installStartupSkillListPatch();

  pi.on("session_start", async (_event, ctx) => {
    await refreshHiddenSkillCache(ctx.cwd);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const hidden = await refreshHiddenSkillCache(ctx.cwd);
    if (hidden.size === 0 || !event.systemPromptOptions.skills?.length) return;

    const filteredSkills: Skill[] = event.systemPromptOptions.skills.map((skill) =>
      hidden.has(skill.name) ? { ...skill, disableModelInvocation: true } : skill,
    );
    const replacement = formatSkillsForPrompt(filteredSkills);

    if (!SKILLS_SECTION_PATTERN.test(event.systemPrompt)) return;
    return { systemPrompt: event.systemPrompt.replace(SKILLS_SECTION_PATTERN, replacement) };
  });

  pi.registerCommand("skillful", {
    description: "Open the pi-skillful skill visibility menu.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/skillful requires interactive UI", "warning");
        return;
      }

      const skills = getSkillItems(pi);
      if (skills.length === 0) {
        ctx.ui.notify("No skills are currently loaded.", "info");
        return;
      }

      const scoped = await readScopedSkillfulSettings(ctx.cwd);
      await ctx.ui.custom<void>((tui, theme, _keybindings, done) =>
        new SkillfulVisibilityMenu({
          cwd: ctx.cwd,
          skills,
          hiddenByScope: {
            global: new Set(scoped.global.hiddenSkills),
            project: new Set(scoped.project.hiddenSkills),
          },
          theme,
          tui,
          notify: (message, type) => ctx.ui.notify(message, type),
          done,
        }),
      );
    },
  });
}

async function refreshHiddenSkillCache(cwd: string): Promise<Set<string>> {
  const hidden = await readEffectiveHiddenSkills(cwd);
  skillVisibilityStore.hiddenSkillsByCwd.set(cwd, hidden);
  skillVisibilityStore.lastHiddenSkills = hidden;
  return hidden;
}

function installStartupSkillListPatch(): void {
  type StartupResourceLoader = {
    getSkills: () => { skills: Skill[]; diagnostics: unknown[] };
  };
  type InteractiveModeWithStartupResources = {
    showLoadedResources?: (options?: unknown) => void;
    session?: { resourceLoader?: StartupResourceLoader };
    sessionManager?: { getCwd?: () => string };
  };

  const prototype = (InteractiveMode as unknown as { prototype: InteractiveModeWithStartupResources }).prototype;
  const patchState = prototype as InteractiveModeWithStartupResources & Record<PropertyKey, unknown>;
  if (patchState[STARTUP_SKILL_LIST_PATCH_KEY]) return;

  const original = prototype.showLoadedResources;
  if (typeof original !== "function") return;

  prototype.showLoadedResources = function showLoadedResourcesWithSkillfulVisibility(
    this: InteractiveModeWithStartupResources,
    options?: unknown,
  ): void {
    const loader = this.session?.resourceLoader;
    const originalGetSkills = loader?.getSkills;
    if (!loader || typeof originalGetSkills !== "function") {
      original.call(this, options);
      return;
    }

    const cwd = this.sessionManager?.getCwd?.();
    const hidden = (cwd ? skillVisibilityStore.hiddenSkillsByCwd.get(cwd) : undefined) ?? skillVisibilityStore.lastHiddenSkills;

    loader.getSkills = () => {
      const result = originalGetSkills.call(loader);
      return {
        ...result,
        skills: result.skills.map((skill) => ({
          ...skill,
          name: formatStartupSkillName(skill.name, hidden.has(skill.name)),
        })),
      };
    };

    try {
      original.call(this, options);
    } finally {
      loader.getSkills = originalGetSkills;
    }
  };

  patchState[STARTUP_SKILL_LIST_PATCH_KEY] = true;
}

function formatStartupSkillName(name: string, hidden: boolean): string {
  return hidden ? `${name} \x1b[31;2m●\x1b[22;39m` : `${name} \x1b[32m●\x1b[39m`;
}

function getSkillItems(pi: ExtensionAPI): SkillListItem[] {
  const byName = new Map<string, SkillListItem>();
  for (const command of pi.getCommands()) {
    if (command.source !== "skill") continue;
    const name = normalizeSkillName(command.name);
    if (!name) continue;
    byName.set(name, {
      name,
      description: command.description ?? "",
    });
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

class SkillfulVisibilityMenu implements Component {
  private readonly cwd: string;
  private readonly skills: SkillListItem[];
  private readonly hiddenByScope: Record<SkillfulScope, Set<string>>;
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly notify: (message: string, type?: "info" | "warning" | "error") => void;
  private readonly done: () => void;
  private readonly topBorder: DynamicBorder;
  private readonly bottomBorder: DynamicBorder;
  private scope: SkillfulScope = "project";
  private settingsList: SettingsList;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(options: {
    cwd: string;
    skills: SkillListItem[];
    hiddenByScope: Record<SkillfulScope, Set<string>>;
    theme: Theme;
    tui: TUI;
    notify: (message: string, type?: "info" | "warning" | "error") => void;
    done: () => void;
  }) {
    this.cwd = options.cwd;
    this.skills = options.skills;
    this.hiddenByScope = options.hiddenByScope;
    this.theme = options.theme;
    this.tui = options.tui;
    this.notify = options.notify;
    this.done = options.done;
    this.topBorder = new DynamicBorder((text: string) => this.theme.fg("accent", text));
    this.bottomBorder = new DynamicBorder((text: string) => this.theme.fg("accent", text));
    this.settingsList = this.createSettingsList();
  }

  render(width: number): string[] {
    return [
      ...this.topBorder.render(width),
      truncateToWidth(`  ${this.theme.bold(this.theme.fg("accent", "pi-skillful"))}  ${this.renderTabs()}`, width),
      truncateToWidth(this.theme.fg("dim", "  Toggle skills shown in the model-invocation system prompt"), width),
      "",
      ...this.settingsList.render(width),
      "",
      truncateToWidth(this.theme.fg("dim", "  Tab/←/→ switch global/project · Enter/Space toggle · Esc close"), width),
      ...this.bottomBorder.render(width),
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      this.switchScope(1);
      return;
    }
    if (matchesKey(data, Key.shift(Key.tab)) || matchesKey(data, Key.left)) {
      this.switchScope(-1);
      return;
    }

    this.settingsList.handleInput(data);
    this.tui.requestRender();
  }

  invalidate(): void {
    this.topBorder.invalidate();
    this.bottomBorder.invalidate();
    this.settingsList.invalidate();
  }

  private renderTabs(): string {
    return SCOPES
      .map((scope) => {
        const label = scope === "global" ? "Global" : "Project";
        return scope === this.scope
          ? this.theme.bg("selectedBg", this.theme.fg("accent", ` ${label} `))
          : this.theme.fg("muted", ` ${label} `);
      })
      .join(" ");
  }

  private switchScope(direction: 1 | -1): void {
    const current = SCOPES.indexOf(this.scope);
    this.scope = SCOPES[(current + direction + SCOPES.length) % SCOPES.length];
    this.settingsList = this.createSettingsList();
    this.tui.requestRender();
  }

  private createSettingsList(): SettingsList {
    const items: SettingItem[] = this.skills.map((skill) => {
      const hidden = this.hiddenByScope[this.scope].has(skill.name);
      return {
        id: skill.name,
        label: skill.name,
        description: skill.description || "No skill description provided.",
        currentValue: hidden ? "off" : "on",
        values: ["on", "off"],
      };
    });

    return new SettingsList(
      items,
      12,
      getSettingsListTheme(),
      (skillName, newValue) => {
        const hidden = this.hiddenByScope[this.scope];
        if (newValue === "off") hidden.add(skillName);
        else hidden.delete(skillName);
        this.persistScope(this.scope);
      },
      this.done,
      { enableSearch: true },
    );
  }

  private persistScope(scope: SkillfulScope): void {
    const snapshot = normalizeSkillNames(this.hiddenByScope[scope]);
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await writeHiddenSkills(scope, this.cwd, snapshot);
        await refreshHiddenSkillCache(this.cwd);
      })
      .catch((error) => {
        this.notify(`Failed to save ${scope} skill visibility: ${error instanceof Error ? error.message : String(error)}`, "error");
      });
  }
}
