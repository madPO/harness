import type { Location, StatusFile, ChangeFile, Groups, DiffRow, Draft } from "./model.js";
export interface GitResult { code: number; stdout: string; stderr: string }
export type Exec = (program: string, argv: string[], options: { cwd: string; on?: string | null }) => Promise<GitResult>;
export interface Snapshot extends Location { state: "ready" | "nofolder" | "norepo"; root?: string; head?: string | null; branch?: string | null; files: StatusFile[]; groups: Groups }
export type Action = { type: "stage" | "unstage"; path?: string } | ({ type: "commit" } & Partial<Draft>);
export interface ActionResult { ok: boolean; attempted: boolean; message?: string }
export const READ: string[];
export const STATUS: string[];
export function readIdentity(context: Location & { root?: string }, exec: Exec): Promise<{ head: string | null; branch: string | null }>;
export function readSnapshot(context: Location, exec: Exec): Promise<Snapshot>;
export function readDiff(snapshot: Snapshot, file: ChangeFile, exec: Exec): Promise<DiffRow[]>;
export function perform(snapshot: Snapshot, action: Action, exec: Exec, isCurrent?: () => boolean): Promise<ActionResult>;
