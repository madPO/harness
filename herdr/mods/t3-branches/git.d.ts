import type { Location, Snapshot } from "./model.js";
export type { Snapshot } from "./model.js";
export interface GitResult { code: number; stdout: string; stderr: string }
export type Exec = (program: string, argv: string[], options: { cwd: string; on?: string | null }) => Promise<GitResult>;
export const READ: string[];
export const REFS: string[];
export function readSnapshot(context: Location, exec: Exec): Promise<Snapshot>;
