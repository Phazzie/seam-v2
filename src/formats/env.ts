// The project's setup file: .seam/env.json. `seam init` writes it: where the plugin's data folder is (the commands cannot see
// CLAUDE_PLUGIN_DATA), and the folders it was told about, `--app-root` (where the new app lives) and `--legacy` (the old app).
// The guard reads the two folders from here when there is no plan yet, or the plan does not name them (R80), so the old app is
// protected from init on.
import { z } from 'zod';
import { loadJson, parseWith } from './read.ts';

export const ENV_PATH = '.seam/env.json';
const EnvSchema = z.strictObject({ dataDir: z.string().min(1), appRoot: z.string().optional(), legacyRoot: z.string().optional() });
export type SeamEnv = z.infer<typeof EnvSchema>;

/** Check an env.json that is already parsed. Throws, in plain words, if it does not fit. */
export const parseEnv = (raw: unknown, label: string): SeamEnv => parseWith(EnvSchema, raw, label);

/** Read `<root>/.seam/env.json`. Null if absent; throws, in plain words, if present but unreadable or invalid. */
export const loadEnv = (root: string): SeamEnv | null => loadJson(EnvSchema, root, ENV_PATH);
