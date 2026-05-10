import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const PACKAGE_NAME = "pi-skillful";
const INSTALL_TELEMETRY_URL = "https://mocito.dev/api/report-install";
const INSTALL_TELEMETRY_TIMEOUT_MS = 5000;

interface InstallTelemetryState {
  lastReportedVersion?: string;
}

interface PiSettingsDocument {
  enableInstallTelemetry?: unknown;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return {};
  }
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function isInstallTelemetryEnabled(): boolean {
  if (isTruthyEnvFlag(process.env.PI_OFFLINE)) return false;
  if (process.env.PI_TELEMETRY !== undefined) return isTruthyEnvFlag(process.env.PI_TELEMETRY);

  const settings = readJsonFile(join(getAgentDir(), "settings.json")) as PiSettingsDocument;
  return settings.enableInstallTelemetry !== false;
}

function getPackageVersion(): string {
  const packageJson = readJsonFile(fileURLToPath(new URL("../package.json", import.meta.url))) as { version?: unknown };
  return typeof packageJson.version === "string" && packageJson.version.length > 0 ? packageJson.version : "0.0.0";
}

function getInstallTelemetryUserAgent(version: string): string {
  const runtimeVersions = process.versions as NodeJS.ProcessVersions & { bun?: string };
  const runtime = runtimeVersions.bun ? `bun/${runtimeVersions.bun}` : `node/${process.version}`;
  return `${PACKAGE_NAME}/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

async function reportInstallTelemetryAsync(): Promise<void> {
  try {
    if (!isInstallTelemetryEnabled()) return;

    const version = getPackageVersion();
    const extensionsDir = join(getAgentDir(), "extensions");
    const statePath = join(extensionsDir, "skillful-install.json");
    const state = readJsonFile(statePath) as InstallTelemetryState;
    if (state.lastReportedVersion === version) return;

    await mkdir(extensionsDir, { recursive: true });
    await writeFile(statePath, `${JSON.stringify({ lastReportedVersion: version }, null, 2)}\n`, "utf8");

    const params = new URLSearchParams({ tool: PACKAGE_NAME, version });
    await fetch(`${INSTALL_TELEMETRY_URL}?${params.toString()}`, {
      headers: { "User-Agent": getInstallTelemetryUserAgent(version) },
      signal: AbortSignal.timeout(INSTALL_TELEMETRY_TIMEOUT_MS),
    });
  } catch {
    // Best-effort telemetry: ignore settings, filesystem, and network failures.
  }
}

export function reportInstallTelemetry(): void {
  void reportInstallTelemetryAsync();
}
