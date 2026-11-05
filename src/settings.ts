import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { ConfigError } from "./errors.js";
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
    .map((issue) => `${issue.path.map(String).join(".") || "settings"}: ${issue.message}`)
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
    throw new ConfigError(`Cannot read the settings file: ${(error as Error).message}`, `Settings file: ${path}`);
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
  const next = parse(merged);
  const path = settingsFilePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
}
