export interface Location { space: string | null; cwd: string | null; on: string | null }
export interface Branch { ref: string; name: string; kind: "local" | "remote"; current: boolean }
export interface Snapshot extends Location { state: "ready" | "nofolder" | "norepo"; root?: string; branches: Branch[] }
export interface Node { id: string; name: string; children?: Node[]; branch?: Branch }
export interface Row extends Node { depth: number }
export function contextKey(location: Location): string;
export function repositoryKey(snapshot: Snapshot): string;
export function parseRefs(text: string): Branch[];
export function branchTree(branches: Branch[], pins: Set<string>): Node[];
export function treeRows(nodes: Node[], collapsed: Set<string>): Row[];
