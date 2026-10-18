import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import type {
	ContextEvent,
	ContextEventResult,
	CustomMessage,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionEvent,
	ExtensionHandler,
	InputEventResult,
} from "@oh-my-pi/pi-coding-agent";

// Preserve the package's other exports and restore the provider boundary for other suites.
const actualAI = { ...(await import("@oh-my-pi/pi-ai")) };
const originalCompleteSimple = actualAI.completeSimple;
const primary: Model = {
	id: "reviewer-a",
	name: "Test English reviewer",
	api: "english-reviewer-test",
	provider: "test-provider",
	baseUrl: "https://reviewer.invalid",
	identity: { class: "unknown" },
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 4096,
	maxTokens: 512,
	compat: undefined,
};
const secondary: Model = { ...primary, id: "reviewer-b" };

type Request = {
	model: Model;
	context: Context;
	options: SimpleStreamOptions | undefined;
	result: {
		promise: Promise<AssistantMessage>;
		resolve: (message: AssistantMessage) => void;
		reject: (reason: unknown) => void;
	};
};
let requests: Request[];
let intercept = false;
mock.module("@oh-my-pi/pi-ai", () => ({
	...actualAI,
	completeSimple: (model: Model, context: Context, options?: SimpleStreamOptions) => {
		if (!intercept) return originalCompleteSimple(model, context, options);
		const result = Promise.withResolvers<AssistantMessage>();
		requests.push({ model, context, options, result });
		return result.promise;
	},
}));
const { default: englishReviewer } = await import("../omp/extensions/english-reviewer/index.ts");
afterAll(() => mock.module("@oh-my-pi/pi-ai", () => actualAI));

function response(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: primary.api,
		provider: primary.provider,
		model: primary.id,
		stopReason,
		errorMessage: stopReason === "error" ? "Provider failed" : undefined,
		usage: {
			input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: 0,
	};
}

function checkpoint(): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setImmediate(resolve);
	return promise;
}
type SentMessage = Exclude<Parameters<ExtensionAPI["sendMessage"]>[0], string>;
type CapturedHandler = ExtensionHandler<ExtensionEvent, unknown>;
const harnesses: Harness[] = [];

class Harness {
	readonly handlers = new Map<string, CapturedHandler[]>();
	readonly commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	readonly sent: { message: SentMessage; options: Parameters<ExtensionAPI["sendMessage"]>[1] }[] = [];
	readonly notifications: { message: string; type: string | undefined }[] = [];
	readonly work: Promise<unknown>[] = [];
	sessionId = "session-a";
	lookup: (selector: string) => Model | undefined = selector => {
		if (selector === "reviewer-a" || selector === "@smol") return primary;
		if (selector === "reviewer-b") return secondary;
		return undefined;
	};
	credentials: () => Promise<string | undefined> = async () => "test-api-key";
	readonly ctx: ExtensionContext;

	constructor(mode: "async" | "off" | "strict", kind: "main" | "sub") {
		// Only the host services exercised by the extension are faked.
		this.ctx = {
			agent: { kind, id: kind === "main" ? "Main" : "Advisor", name: kind, depth: 0 },
			hasUI: true,
			mode: "tui",
			models: {
				resolve: (selector: string) => this.lookup(selector),
				list: () => [primary, secondary],
				current: () => secondary,
				family: (model: Model) => model.id,
			},
			modelRegistry: {
				resolver: () => this.credentials(),
				find: (provider: string, id: string) => [primary, secondary].find(model => model.provider === provider && model.id === id),
				getAvailable: () => [primary, secondary],
			},
			sessionManager: { getSessionId: () => this.sessionId, getBranch: () => [] },
			ui: {
				setStatus: () => {},
				setWidget: () => {},
				notify: (message: string, type?: string) => this.notifications.push({ message, type }),
			},
		} as unknown as ExtensionContext;
		const api = {
			on: ((name: string, handler: CapturedHandler) => {
				const handlers = this.handlers.get(name) ?? [];
				handlers.push(handler);
				this.handlers.set(name, handlers);
			}) as ExtensionAPI["on"],
			registerCommand: (name, options) => { this.commands.set(name, options); },
			registerFlag: () => {},
			getFlag: name => name === "english-mode" ? mode : name === "english-model" ? "reviewer-a" : undefined,
			registerMessageRenderer: () => {},
			sendMessage: (message, options) => {
				if (typeof message === "string") throw new Error("Expected structured review feedback");
				this.sent.push({ message, options });
			},
		} satisfies Pick<ExtensionAPI, "on" | "registerCommand" | "registerFlag" | "getFlag" | "registerMessageRenderer" | "sendMessage">;
		englishReviewer(api as unknown as ExtensionAPI);
	}

	emit(event: ExtensionEvent): Promise<unknown[]> {
		const task = Promise.all((this.handlers.get(event.type) ?? []).map(handler => Promise.resolve().then(() => handler(event, this.ctx))));
		this.work.push(task);
		return task;
	}

	async input(text: string): Promise<InputEventResult | undefined> {
		const results = await this.emit({ type: "input", text, source: "interactive" });
		return results[0] as InputEventResult | undefined;
	}

	stop() {
		return this.emit({
			type: "session_stop", messages: [], turn_id: 1, session_id: this.sessionId,
			stop_hook_active: false, signal: new AbortController().signal,
		});
	}

	async end(willContinue = false) {
		if (!willContinue) await this.stop();
		return this.emit({ type: "agent_end", messages: [], willContinue });
	}

	async command(args: string) {
		const command = this.commands.get("english");
		if (!command) throw new Error("English command is unavailable");
		const task = Promise.resolve(command.handler(args, this.ctx as ExtensionCommandContext));
		this.work.push(task);
		await task;
	}

	reviews() {
		return this.sent.filter(entry => entry.message.customType === "english-review").map(entry => ({
			...entry,
			details: entry.message.details as { review: string; model: string },
		}));
	}
}

async function setup(mode: "async" | "off" | "strict" = "async", kind: "main" | "sub" = "main") {
	const harness = new Harness(mode, kind);
	harnesses.push(harness);
	await harness.emit({ type: "session_start" });
	return harness;
}

function expectUnchanged(result: InputEventResult | undefined) {
	expect(result?.handled).not.toBe(true);
	expect(result?.text).toBeUndefined();
}

beforeEach(() => {
	requests = [];
	intercept = true;
});
afterEach(async () => {
	// Release even deliberately unresolved providers when an assertion fails.
	await Promise.all(harnesses.map(harness => harness.emit({ type: "session_shutdown" })));
	for (const request of requests) request.result.resolve(response("SKIP"));
	await Promise.allSettled(requests.map(request => request.result.promise));
	await Promise.allSettled(harnesses.flatMap(harness => harness.work));
	await checkpoint();
	harnesses.length = 0;
	intercept = false;
});

describe("English reviewer asynchronous lifecycle", () => {
	test("async input returns to coding while its provider is still pending", async () => {
		const harness = await setup();
		const input = harness.input("I has a question about this function.");
		const outcome = await Promise.race([input.then(() => "returned"), checkpoint().then(() => "blocked")]);
		expect(outcome).toBe("returned");
		expectUnchanged(await input);
		expect(requests).toHaveLength(1);
		expect(harness.reviews()).toHaveLength(0);
		requests[0]!.result.resolve(response("A useful correction"));
		await harness.end();
	});

	test("queues every raw submission, waits for terminal settle, and publishes in submission order exactly once", async () => {
		const harness = await setup();
		await harness.input("First sentence need correction.");
		await harness.input("Second sentence have another issue.");
		await checkpoint();
		expect(requests).toHaveLength(2);
		requests[1]!.result.resolve(response("second review"));
		await checkpoint();
		await harness.end(true);
		expect(harness.reviews()).toHaveLength(0);
		const end = harness.end();
		const repeatedEnd = harness.end();
		await checkpoint();
		expect(harness.reviews()).toHaveLength(0);
		requests[0]!.result.resolve(response("first review"));
		await Promise.all([end, repeatedEnd]);
		expect(harness.reviews().map(entry => entry.details.review)).toEqual(["first review", "second review"]);
		await harness.end();
		expect(harness.reviews()).toHaveLength(2);
		for (const entry of harness.reviews()) {
			expect(entry.message.content).toBe("");
			expect(entry.message.display).toBe(true);
			expect(entry.message.attribution).toBe("agent");
			expect(entry.options?.triggerTurn).toBe(false);
			expect(entry.options?.deliverAs).toBe("nextTurn");
		}
	});

	test("strict review publishes before input returns without replacing the coding request", async () => {
		const harness = await setup("strict");
		let inputReturned = false;
		const input = harness.input("How I can fix this?").then(result => { inputReturned = true; return result; });
		await checkpoint();
		expect(requests).toHaveLength(1);
		expect(inputReturned).toBe(false);
		expect(harness.reviews()).toHaveLength(0);
		requests[0]!.result.resolve(response("Strict review"));
		expectUnchanged(await input);
		expect(harness.reviews()).toHaveLength(1);
		await harness.end();
		expect(harness.reviews()).toHaveLength(1);
	});

	test("session_stop joins pending review without requesting continuation or changing coding policy", async () => {
		const harness = await setup();
		await harness.input("It do not work.");
		let stopped = false;
		const stop = harness.stop().then(results => { stopped = true; return results; });
		await checkpoint();
		expect(stopped).toBe(false);
		expect(harness.reviews()).toHaveLength(0);
		requests[0]!.result.resolve(response("Late review"));
		const results = await stop;
		for (const result of results) {
			expect(result ?? {}).not.toHaveProperty("continue", true);
			expect(result ?? {}).not.toHaveProperty("decision", "block");
			expect(result ?? {}).not.toHaveProperty("additionalContext");
			expect(result ?? {}).not.toHaveProperty("reason");
		}
		expect(harness.reviews()).toHaveLength(0);
		await harness.end();
		expect(harness.reviews()).toHaveLength(1);
	});
});

describe("English reviewer result and error boundaries", () => {
	test.each(["SKIP", "  SKIP\n", "", " \n "])("suppresses non-feedback result %j", async text => {
		const harness = await setup();
		await harness.input("const result = run();");
		await checkpoint();
		requests[0]!.result.resolve(response(text));
		await harness.end();
		expect(harness.reviews()).toHaveLength(0);
		expect(harness.notifications).toHaveLength(0);
	});

	test("retains a positive review while excluding reasoning and trimming text blocks", async () => {
		const harness = await setup();
		await harness.input("Could you explain this function?");
		await checkpoint();
		const result = response("  Looks good.\n");
		result.content.unshift({ type: "thinking", thinking: "Private chain of thought" });
		requests[0]!.result.resolve(result);
		await harness.end();
		expect(harness.reviews().map(entry => entry.details.review)).toEqual(["Looks good."]);
	});

	test.each(["error", "aborted"] as const)("a provider %s result is a warning, not feedback", async stopReason => {
		const harness = await setup();
		await harness.input("This sentence have a problem.");
		await checkpoint();
		requests[0]!.result.resolve(response("Partial text must not appear", stopReason));
		await harness.end();
		expect(harness.reviews()).toHaveLength(0);
		expect(harness.notifications.some(notification => notification.type === "warning")).toBe(true);
	});

	test("a rejected strict review warns and releases the unchanged input; the next review still works", async () => {
		const harness = await setup("strict");
		const first = harness.input("Why this fail?");
		await checkpoint();
		requests[0]!.result.reject(new Error("Network unavailable"));
		expectUnchanged(await first);
		expect(harness.reviews()).toHaveLength(0);
		expect(harness.notifications.some(notification => notification.type === "warning")).toBe(true);
		const next = harness.input("Why does this fail?");
		await checkpoint();
		requests[1]!.result.resolve(response("Looks good."));
		expectUnchanged(await next);
		expect(harness.reviews()).toHaveLength(1);
	});

	test("model lookup failure does not fall back to the coding model or consume input", async () => {
		const harness = await setup("strict");
		harness.lookup = () => undefined;
		expectUnchanged(await harness.input("Can you help me?"));
		expect(requests).toHaveLength(0);
		expect(harness.reviews()).toHaveLength(0);
		expect(harness.notifications.some(notification => notification.type === "warning")).toBe(true);
	});
});

describe("English reviewer cancellation", () => {
	test.each(["off", "strict", "model reviewer-b"])("configuration change %j aborts and discards stale work", async command => {
		const harness = await setup();
		await harness.input("An old sentence need review.");
		await checkpoint();
		const old = requests[0]!;
		await harness.command(command);
		expect(old.options?.signal?.aborted).toBe(true);
		old.result.resolve(response("Obsolete review"));
		await harness.end();
		expect(harness.reviews()).toHaveLength(0);
		expect(harness.notifications.some(notification => notification.type === "warning")).toBe(false);
	});

	const resets = [
		{ type: "session_switch", reason: "new", previousSessionFile: undefined },
		{ type: "session_branch", reason: "branch", previousSessionFile: undefined },
		{ type: "session_tree", newLeafId: "new-leaf", oldLeafId: "old-leaf" },
		{ type: "session_shutdown" },
	] as const satisfies readonly ExtensionEvent[];
	test.each(resets)("%j suppresses even a late provider failure", async event => {
		const harness = await setup();
		await harness.input("This is the old session input.");
		await checkpoint();
		const old = requests[0]!;
		const oldEnd = harness.end();
		await checkpoint();
		harness.sessionId = "session-b";
		await harness.emit(event);
		expect(old.options?.signal?.aborted).toBe(true);
		old.result.reject(new Error("Old session request failed late"));
		await oldEnd;
		await harness.end();
		expect(harness.reviews()).toHaveLength(0);
		expect(harness.notifications).toHaveLength(0);
	});

	test("changing models publishes only new-model feedback and invalid selection preserves that model", async () => {
		const harness = await setup();
		await harness.input("Old model request.");
		await checkpoint();
		await harness.command("model reviewer-b");
		await harness.command("model missing-model");
		await harness.input("New model request.");
		await checkpoint();
		expect(requests[1]!.model.id).toBe(secondary.id);
		requests[1]!.result.resolve(response("Current feedback"));
		requests[0]!.result.resolve(response("Stale feedback"));
		await harness.end();
		expect(harness.reviews().map(entry => entry.details.model)).toEqual([`${secondary.provider}/${secondary.id}`]);
	});

	test("off ignores new input and on resumes without reviving cancelled reviews", async () => {
		const harness = await setup();
		await harness.input("Before disabling.");
		await checkpoint();
		await harness.command("off");
		expectUnchanged(await harness.input("While disabled."));
		await harness.command("on");
		await harness.input("After enabling.");
		await checkpoint();
		expect(requests).toHaveLength(2);
		requests[0]!.result.resolve(response("Old feedback"));
		requests[1]!.result.resolve(response("New feedback"));
		await harness.end();
		expect(harness.reviews().map(entry => entry.details.review)).toEqual(["New feedback"]);
	});
});

describe("English reviewer source and history isolation", () => {
	test("sends only raw input, not transformed prompts, history, tools, or main system instructions", async () => {
		const harness = await setup();
		const raw = "Please explain why this function don't work.\n```ts\nrun();\n```";
		await harness.input(raw);
		await harness.emit({ type: "before_agent_start", prompt: "Expanded project prompt with private context", systemPrompt: ["Private coding instructions"] });
		await harness.end(true);
		await harness.emit({ type: "before_agent_start", prompt: "Automatic continuation", systemPrompt: ["More private instructions"] });
		await checkpoint();
		expect(requests).toHaveLength(1);
		const context = requests[0]!.context;
		expect(context.messages).toHaveLength(1);
		expect(context.messages[0]).toMatchObject({ role: "user", content: raw });
		expect(context.tools ?? []).toHaveLength(0);
		expect(JSON.stringify(context)).not.toContain("Private coding instructions");
		expect(JSON.stringify(context)).not.toContain("Expanded project prompt");
		requests[0]!.result.resolve(response("SKIP"));
		await harness.end();
	});

	test("reviews a positional initial prompt once, but accepts a new initial prompt after session switch", async () => {
		const harness = await setup();
		const initial = { type: "before_agent_start", prompt: "Initial sentence need help.", systemPrompt: [] } as const;
		await harness.emit({ ...initial, systemPrompt: [] });
		await harness.emit({ ...initial, systemPrompt: [] });
		await checkpoint();
		expect(requests).toHaveLength(1);
		await harness.emit({ type: "session_switch", reason: "new", previousSessionFile: undefined });
		await harness.emit({ type: "before_agent_start", prompt: "Another initial prompt.", systemPrompt: [] });
		await checkpoint();
		expect(requests).toHaveLength(2);
		requests[0]!.result.resolve(response("Old prompt review"));
		requests[1]!.result.resolve(response("New prompt review"));
		await harness.end();
		expect(harness.reviews().map(entry => entry.details.review)).toEqual(["New prompt review"]);
	});

	test.each(["/help", "!echo hello", "$print('hello')", ".", "c"])("does not turn control input %j into review work or a fallback initial prompt", async text => {
		const harness = await setup();
		expectUnchanged(await harness.input(text));
		await harness.emit({ type: "before_agent_start", prompt: "Expanded command or continuation", systemPrompt: [] });
		await harness.end();
		expect(requests).toHaveLength(0);
		expect(harness.reviews()).toHaveLength(0);
	});

	test("headless sessions don't spend a reviewer request on feedback they can't display", async () => {
		const harness = await setup();
		harness.ctx.hasUI = false;
		expectUnchanged(await harness.input("This sentence need correction."));
		await harness.emit({ type: "before_agent_start", prompt: "Initial request", systemPrompt: [] });
		await harness.end();
		expect(requests).toHaveLength(0);
		expect(harness.reviews()).toHaveLength(0);
	});

	test("a depth-zero subagent never reviews input or initial prompts", async () => {
		const harness = await setup("async", "sub");
		expectUnchanged(await harness.input("Please review this sentence."));
		await harness.emit({ type: "before_agent_start", prompt: "Subagent assignment", systemPrompt: [] });
		await harness.end();
		expect(requests).toHaveLength(0);
		expect(harness.reviews()).toHaveLength(0);
	});

	test("separate extension instances cannot cancel or publish each other's review", async () => {
		const first = await setup();
		const second = await setup();
		await first.input("First session input.");
		await second.input("Second session input.");
		await checkpoint();
		await first.command("off");
		expect(requests[0]!.options?.signal?.aborted).toBe(true);
		expect(requests[1]!.options?.signal?.aborted).toBe(false);
		requests[0]!.result.resolve(response("First session feedback"));
		requests[1]!.result.resolve(response("Second session feedback"));
		await Promise.all([first.end(), second.end()]);
		expect(first.reviews()).toHaveLength(0);
		expect(second.reviews()).toHaveLength(1);
	});

	test("provider context excludes only English review entries without changing retained history", async () => {
		const harness = await setup();
		const custom = (customType: string): CustomMessage => ({
			role: "custom", customType, content: "Visible context", details: { review: "Stored review" }, display: true, timestamp: 0,
		});
		const user = { role: "user", content: "Keep my English-review discussion", timestamp: 0 } as const;
		const assistant = response("An assistant discussing english-review");
		const otherExtension = custom("another-extension");
		const review = custom("english-review");
		const event: ContextEvent = { type: "context", messages: [user, review, assistant, otherExtension] };
		const original = structuredClone(event.messages);
		const results = await harness.emit(event);
		const result = results.find(value => value && typeof value === "object" && "messages" in value) as ContextEventResult | undefined;
		const messages = result?.messages ?? event.messages;
		expect(messages).toEqual([user, assistant, otherExtension]);
		expect(messages[0]).toBe(user);
		expect(messages[1]).toBe(assistant);
		expect(messages[2]).toBe(otherExtension);
		expect(event.messages).toEqual(original);
	});
});
