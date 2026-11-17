import type { Branch, Location, Snapshot } from "./model.js";
import type { Exec } from "./git.js";
export class BranchesController {
  constructor(options: { exec: Exec; location: () => Location; changed?: () => void; loadPins: (key: string) => string[]; savePins: (key: string, refs: string[]) => void });
  snapshot: Snapshot | null;
  error: string | null;
  loading: boolean;
  closed: boolean;
  pins: Set<string>;
  context: string;
  transition(context?: Location): boolean;
  refresh(): Promise<void>;
  togglePin(branch: Branch): void;
  close(): void;
}
