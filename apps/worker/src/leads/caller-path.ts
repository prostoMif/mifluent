import { isAbsolute, resolve } from "node:path";

/**
 * A path as the person typed it. `npm run x --workspace` runs the script in
 * the workspace's folder, so `export.csv` typed at the repository root would
 * otherwise be looked for in `apps/worker/`. npm keeps the folder the command
 * was typed in as INIT_CWD.
 */
export function fromCallerDir(path: string): string {
  if (isAbsolute(path)) return path;
  return resolve(process.env["INIT_CWD"] ?? process.cwd(), path);
}
