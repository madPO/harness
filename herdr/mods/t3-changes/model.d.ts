export interface Location { space?: string | null; cwd?: string | null; on?: string | null }
export interface StatusFile { path: string; xy: string; conflict: boolean; untracked: boolean }
export interface ChangeFile extends StatusFile { group: "staged" | "unstaged" | "previous"; status: string }
export interface Groups { staged: ChangeFile[]; unstaged: ChangeFile[] }
export interface TreeNode { name: string; path: string; file?: ChangeFile; children?: TreeNode[] }
export interface TreeRow extends TreeNode { depth: number }
export interface DiffRow { kind: string; text: string; old?: number; next?: number }
export interface Draft { message: string }
export function displayPath(path: string): string;
export function contextKey(context: Location): string;
export function repositoryKey(context: { root: string; on?: string | null }): string;
export function selectionKey(file?: ChangeFile | null): string;
export function validPath(path: unknown): boolean;
export function parseStatus(text: string): StatusFile[];
export function groupsOf(files: StatusFile[]): Groups;
export function unifiedFiles(snapshot: { groups: Groups } | null, previous?: ChangeFile[]): ChangeFile[];
export function parsePrevious(text: string): ChangeFile[];
export function fileTree(files: ChangeFile[]): TreeNode[];
export function treeRows(tree: TreeNode[], collapsed: Set<string>, group: string, depth?: number): TreeRow[];
export function parseDiff(text: string): DiffRow[];
export function commitArgs(message: string): string[];
