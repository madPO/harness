import type { Location, ChangeFile, DiffRow, Draft } from "./model.js";
import type { Exec, Snapshot, Action } from "./git.js";
export class ChangesController {
  constructor(options: { exec: Exec; location: () => Location; changed?: () => void; publish?: () => void });
  snapshot: Snapshot | null;
  selected: ChangeFile | null;
  diff: DiffRow[] | null;
  error: string | null;
  loading: boolean;
  busy: boolean;
  closed: boolean;
  context?: string;
  transition(context?: Location): boolean;
  draft(snapshot?: Snapshot | null): Draft;
  setDraft(message: string): void;
  refresh(): Promise<void>;
  select(file: ChangeFile | null): Promise<void>;
  mutate(action: Action): Promise<void>;
  close(): void;
}
