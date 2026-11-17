import type { CustomCommandAPI } from "@oh-my-pi/pi-coding-agent";

type Exec = CustomCommandAPI["exec"];
const OPERATION_TIMEOUT_MS = 60_000;

export class GitError extends Error {
  constructor(
    readonly code: number,
    readonly stderr: string,
    readonly killed: boolean,
  ) {
    super(killed ? "Git operation was cancelled or timed out." : `Git exited with code ${code}: ${stderr.trim()}`);
    this.name = "GitError";
  }
}

function revision(value: string): string {
  if (!value || value.startsWith("-") || /[\0\r\n]/.test(value)) {
    throw new Error("Invalid revision reference.");
  }
  return value;
}

function nulPaths(output: string): string[] {
  return output.split("\0").filter((path) => path !== "");
}

/** Read-only Git access. All process execution belongs to the host. */
export class Repository {
  private constructor(
    private readonly root: string,
    private readonly exec: Exec,
  ) {}

  static async open(cwd: string, exec: Exec, signal?: AbortSignal, timeout = OPERATION_TIMEOUT_MS): Promise<Repository> {
    const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, signal, timeout });
    if (result.killed || result.code !== 0) {
      throw new GitError(result.code, result.stderr, result.killed);
    }
    // Git appends one record terminator; whitespace can belong to the directory name.
    const root = result.stdout.replace(/\r?\n$/, "");
    if (!root) throw new Error("Git returned an empty repository root.");
    return new Repository(root, exec);
  }

  info(): { repoRoot: string } {
    return { repoRoot: this.root };
  }

  private async run(args: string[], signal?: AbortSignal, allowedCodes: number[] = [], timeout = OPERATION_TIMEOUT_MS) {
    const result = await this.exec("git", args, { cwd: this.root, signal, timeout });
    if (result.killed || (result.code !== 0 && !allowedCodes.includes(result.code))) {
      throw new GitError(result.code, result.stderr, result.killed);
    }
    return result;
  }

  async listBranches(all: boolean, signal?: AbortSignal, timeout = OPERATION_TIMEOUT_MS): Promise<string[]> {
    const result = await this.run([
      "for-each-ref", "--format=%(refname)", "refs/heads/", ...(all ? ["refs/remotes/"] : []),
    ], signal, [], timeout);
    return result.stdout.split("\n").filter(Boolean).map((ref) =>
      ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : `remotes/${ref.slice("refs/remotes/".length)}`,
    );
  }

  async headSha(signal?: AbortSignal): Promise<string | null> {
    const result = await this.run(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], signal, [1]);
    return result.code === 1 ? null : result.stdout.trim();
  }

  async currentBranch(signal?: AbortSignal): Promise<string | null> {
    const result = await this.run(["symbolic-ref", "--quiet", "--short", "HEAD"], signal, [1]);
    return result.code === 1 ? null : result.stdout.trim();
  }

  async commitDetails(reference: string, signal?: AbortSignal): Promise<{ sha: string; parents: string[] }> {
    const resolved = await this.run(["rev-parse", "--verify", "--end-of-options", `${revision(reference)}^{commit}`], signal);
    const sha = resolved.stdout.trim();
    const result = await this.run(["rev-list", "--parents", "-n", "1", sha, "--"], signal);
    const [recordedSha, ...parents] = result.stdout.trim().split(/\s+/);
    if (recordedSha !== sha) throw new Error(`Cannot resolve commit: ${reference}`);
    return { sha, parents };
  }

  async mergeBase(base: string, head: string, signal?: AbortSignal): Promise<string | null> {
    const result = await this.run(["merge-base", revision(base), revision(head)], signal, [1]);
    return result.code === 1 ? null : result.stdout.trim();
  }

  async changedFiles(options: { base?: string; head?: string; cached?: boolean }, signal?: AbortSignal): Promise<string[]> {
    const args = ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames"];
    if (options.cached) args.push("--cached");
    if (options.base) args.push(revision(options.base));
    if (options.head) args.push(revision(options.head));
    args.push("--");
    const result = await this.run(args, signal);
    const records = nulPaths(result.stdout);
    const paths: string[] = [];
    for (let index = 0; index < records.length;) {
      const status = records[index++];
      const count = /^[RC]/.test(status) ? 2 : 1;
      for (let part = 0; part < count; part++) {
        const path = records[index++];
        if (path === undefined) throw new Error("Git returned an incomplete changed-file inventory.");
        paths.push(path);
      }
    }
    return paths;
  }

  async lsTree(head: string, paths: string[], signal?: AbortSignal): Promise<string[]> {
    const result = await this.run(["ls-tree", "-r", "--name-only", "-z", revision(head), "--", ...paths], signal);
    return nulPaths(result.stdout);
  }

  async lsFiles(others: boolean, excludeStandard: boolean, signal?: AbortSignal): Promise<string[]> {
    const result = await this.run([
      "ls-files", "-z", ...(others ? ["--others"] : []), ...(excludeStandard ? ["--exclude-standard"] : []), "--",
    ], signal);
    return nulPaths(result.stdout);
  }
}
