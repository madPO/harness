import type { Location, ChangeFile, Draft } from "./model.js";
import type { Exec, Snapshot, Action } from "./git.js";
export class ChangesController {
  constructor(options: { exec: Exec; location: () => Location; changed?: () => void; publish?: () => void });
  snapshot: Snapshot | null;
  error: string | null;
  loading: boolean;
  busy: boolean;
  closed: boolean;
  context?: string;
  checked: Set<string>;
  amend: boolean;
  files(): ChangeFile[];
  toggleFiles(paths: string[]): void;
  setAmend(enabled: boolean): Promise<void>;
  transition(context?: Location): boolean;
  draft(snapshot?: Snapshot | null): Draft;
  setDraft(message: string): void;
  refresh(): Promise<void>;
  mutate(action: Action): Promise<void>;
  close(): void;
}
