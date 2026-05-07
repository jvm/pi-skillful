# pi-skillful

`pi-skillful` is a [Pi](https://github.com/badlogic/pi-mono) package that improves skill workflows.

It currently provides two extensions:

- **Inline skill invocation**: invoke one or more skills anywhere in a prompt with `/skill:name`.
- **Skill prompt visibility**: choose which skills are hidden from the model's automatic skill-discovery prompt, while keeping them explicitly invokable and visibly marked in Pi's startup skill list.

> [!WARNING]
> Pi packages can execute arbitrary code through extensions. Review package source before installing any third-party Pi package.

## Features

### Inline skill invocation

Vanilla Pi expands `/skill:name` only when it appears at the beginning of the prompt. `pi-skillful` expands known skill markers anywhere in the prompt, including multiple skills:

```text
Use /skill:code-security and /skill:semgrep to review this change.
```

The extension replaces each known marker with that skill's `SKILL.md` content before Pi's built-in skill/template expansion runs.

### Skill prompt visibility

Hide skills from the `<available_skills>` section of the system prompt without editing each skill's `disable-model-invocation` frontmatter.

Hidden skills:

- are not advertised to the model for automatic skill selection;
- remain loaded by Pi;
- remain available for explicit invocation with `/skill:name`, including inline invocation.

Configuration is stored under the `skillful` key in Pi settings:

```json
{
  "skillful": {
    "hiddenSkills": ["pdf", "xlsx"]
  }
}
```

Supported scopes:

- Global: `~/.pi/agent/settings.json`
- Project: `.pi/settings.json`

Effective hidden skills are the union of global and project `hiddenSkills`.

Open the menu with:

```text
/skillful
```

The menu lists all loaded skills alphabetically. Toggle a skill off to save it in the active scope's `hiddenSkills` list. Use the Global/Project tabs to choose which settings file to edit.

Pi's startup `[Skills]` list also highlights hidden skills in the error color (red in the default dark theme).

When the project settings file contains only `skillful` settings and the project `hiddenSkills` list becomes empty, `.pi/settings.json` is deleted instead of leaving an empty settings file behind.

## Installation

Install from GitHub:

```bash
pi install git:github.com/jvm/pi-skillful
```

Install project-locally with Pi's `-l` flag:

```bash
pi install -l git:github.com/jvm/pi-skillful
```

During local development from this repository:

```bash
pi install /path/to/pi-skillful
```

For a one-off test run without installing:

```bash
pi -e /path/to/pi-skillful/extensions/pi-skillful
```

## Usage

1. Start Pi in a project with this package installed.
2. Run `/skillful`.
3. Select the Global or Project tab.
4. Toggle skills on/off.
5. Send a prompt normally, or explicitly invoke hidden skills with `/skill:name` anywhere in the prompt.

Example:

```text
Please analyze this using /skill:code-security, then summarize the risk.
```

## Development

This package is source-distributed. Pi loads the TypeScript extensions directly via its extension loader.

Requirements:

- Node.js >= 20.6.0
- Bun for local development commands

Common commands:

```bash
bun install
bun run check
bun run pack:dry-run
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and pull request guidelines.

## Security

Please report security issues privately. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
