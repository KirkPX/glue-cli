import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { ConfigError, UsageError, fileErrorReason } from "./errors.js";
import { settingsFilePath } from "./paths.js";
import { migrateLegacyConfig } from "./services/migrate.js";

/**
 * The settings file. Unknown keys are refused: a misspelt `readonly` must stop
 * the command, because ignoring it would allow the writes it was meant to block.
 * Sign-in tokens never go in this file.
 */
export const settingsSchema = z.strictObject({
  baseUrl: z.url().optional(),
  userId: z.string().trim().min(1).optional(),
  readOnly: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  // The chat service's key, and the values sign-in needs. None is built in.
  streamKey: z.string().min(1).optional(),
  firebase: z
    .strictObject({
      webKey: z.string().min(1).optional(),
      authDomain: z.string().min(1).optional(),
      projectId: z.string().min(1).optional(),
    })
    .optional(),
});

export type Settings = z.infer<typeof settingsSchema>;

function parse(value: unknown): Settings {
  const result = settingsSchema.safeParse(value);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => {
      // A bad record key reports "Invalid key in record"; the reason is one level down.
      const inner = issue.code === "invalid_key" ? issue.issues[0]?.message : undefined;
      return `${issue.path.map(String).join(".") || "settings"}: ${inner ?? issue.message}`;
    })
    .join("; ");
  throw new ConfigError(`Invalid settings: ${detail}`, `Settings file: ${settingsFilePath()}`);
}

/** Read and validate the settings file. A missing file means no settings. */
export function loadSettings(): Settings {
  migrateLegacyConfig();
  const path = settingsFilePath();
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new ConfigError(
      `Cannot read the settings file: ${fileErrorReason(error)}.`,
      `Settings file: ${path}. Run \`glue config path\` to see where it should be.`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigError("The settings file is not valid JSON.", `Settings file: ${path}`);
  }
  return parse(value);
}

/**
 * Merge a change into the settings file. The new file is written beside the old
 * one and renamed over it, so a crash cannot leave half a file. A patch value of
 * undefined removes that key.
 */
export function updateSettings(patch: Partial<Settings>): void {
  const merged: Record<string, unknown> = { ...loadSettings(), ...patch };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  writeSettings(merged);
}

function writeSettings(value: Record<string, unknown>): void {
  const next = parse(value);
  const path = settingsFilePath();
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf-8");
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw new ConfigError(
      `Cannot save the settings file: ${fileErrorReason(error)}.`,
      `Settings file: ${path}. Check you can write to that folder, or point GLUE_CLI_CONFIG_FILE at another file.`,
    );
  }
}

type Leaf = "string" | "boolean" | "integer";

/**
 * Every setting `config set` can change. Add new ones here and to the schema above.
 * A dotted name reaches inside an object, and `*` matches any one key of a record.
 */
const SETTABLE: Record<string, Leaf> = {
  baseUrl: "string",
  userId: "string",
  readOnly: "boolean",
  timeoutMs: "integer",
  streamKey: "string",
  "firebase.webKey": "string",
  "firebase.authDomain": "string",
  "firebase.projectId": "string",
};

// A `*` takes whatever was typed, and these names would reach JavaScript's own objects.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Sign-in tokens live in the keychain or the credentials file, never in settings.
const TOKEN_NAMES = /token|secret|password|credential/i;

function settingPath(name: string): { parts: string[]; type: Leaf } {
  if (TOKEN_NAMES.test(name)) {
    throw new UsageError(
      `"${name}" is not a setting: sign-in tokens never go in the settings file.`,
      "Run `glue login` to sign in, or set GLUE_REFRESH_TOKEN for one run.",
    );
  }
  const parts = name.split(".");
  const match = Object.keys(SETTABLE).find((pattern) => {
    const segments = pattern.split(".");
    return (
      segments.length === parts.length &&
      segments.every((s, i) => (s === "*" ? Boolean(parts[i]) && !UNSAFE_KEYS.has(parts[i]!) : s === parts[i]))
    );
  });
  if (!match) {
    throw new UsageError(`There is no setting called "${name}".`, `Settings: ${Object.keys(SETTABLE).join(", ")}.`);
  }
  return { parts, type: SETTABLE[match]! };
}

function coerce(name: string, type: Leaf, raw: string): string | boolean | number {
  if (type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new UsageError(`${name} takes true or false, not "${raw}".`);
  }
  if (type === "integer") {
    if (/^\d+$/.test(raw)) return Number(raw);
    throw new UsageError(`${name} takes a whole number, not "${raw}".`);
  }
  return raw;
}

/**
 * Set one value in the settings file, by its dotted name. The whole file is
 * checked before it is written, so a bad value never reaches the disk.
 */
export function setSetting(name: string, raw: string): Settings {
  const { parts, type } = settingPath(name);
  const value = coerce(name, type, raw);
  const settings = structuredClone(loadSettings()) as Record<string, unknown>;
  let node = settings;
  for (const part of parts.slice(0, -1)) {
    const child = node[part];
    node[part] = typeof child === "object" && child !== null ? child : {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
  writeSettings(settings);
  return loadSettings();
}

/** Remove one value from the settings file. Returns false when it was not set. */
export function unsetSetting(name: string): boolean {
  const { parts } = settingPath(name);
  const settings = structuredClone(loadSettings()) as Record<string, unknown>;
  const chain: Record<string, unknown>[] = [settings];
  for (const part of parts.slice(0, -1)) {
    const child = chain[chain.length - 1]![part];
    if (typeof child !== "object" || child === null) return false;
    chain.push(child as Record<string, unknown>);
  }
  const last = parts[parts.length - 1]!;
  if (!Object.hasOwn(chain[chain.length - 1]!, last)) return false;
  delete chain[chain.length - 1]![last];
  // Drop the objects the removal left empty.
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]!).length > 0) break;
    delete chain[i - 1]![parts[i - 1]!];
  }
  writeSettings(settings);
  return true;
}
