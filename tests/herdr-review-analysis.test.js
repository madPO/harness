import { describe, expect, test } from "bun:test";
import { validateAnalysis } from "../herdr/mods/review-assistant/analysis.js";

const middleware = "src/auth middleware.js";
const sessions = "src/session\nstore.js";
const oldSessions = "src/old-session.js";
const files = [
  { path: middleware, status: "M" },
  { path: sessions, status: "R", oldPath: oldSessions },
];
const group = {
  id: "session-revocation",
  title: "Session revocation",
  importance: "high",
  description: "Rejects revoked sessions in middleware and looks up active sessions in the store.",
  keyToReview: "Verify that active sessions still reach request handlers.",
  files: [middleware, sessions],
};
const influence = {
  name: "Session refresh",
  description: "Confirm that refresh still accepts active sessions.",
  evidenceIds: ["refresh:24"],
};
const review = (overrides) => ({ groups: [{ ...group, ...overrides }], influence: [] });
const withInfluence = (overrides) => ({ groups: [group], influence: [{ ...influence, ...overrides }] });
const invalid = "The analysis provider returned an invalid review. Try again or check the provider configuration.";

function expectInvalid(raw, inventory = files) {
  expect(() => validateAnalysis(raw, inventory)).toThrow(invalid);
}

describe("Review Assistant analysis validation", () => {
  test("accepts multi-file groups and allows exact changed paths to appear in multiple groups", () => {
    const storage = {
      id: "store-compatibility_2",
      title: "Store compatibility",
      importance: "medium",
      description: "Moves the session lookup into the renamed store.",
      keyToReview: "Ensure store readers retain access to active sessions.",
      files: [sessions],
    };
    const naming = {
      id: "store-naming",
      title: "Store naming",
      importance: "low",
      description: "Renames the backing store to match the session API.",
      keyToReview: "Check that store imports use the renamed path.",
      files: [sessions],
    };
    const raw = { groups: [group, storage, naming], influence: [] };
    const result = validateAnalysis(raw, files);
    expect(result).toEqual(raw);
    expect(result.groups[0].files).not.toBe(group.files);
  });

  test("keeps markup-looking text literal and trims outer prose whitespace", () => {
    const raw = review({ title: "  Check <token>  ", description: "Uses <token> for the session key." });
    expect(validateAnalysis(raw, files).groups[0]).toEqual({
      ...group,
      title: "Check <token>",
      description: "Uses <token> for the session key.",
    });
  });

  test("accepts an empty result for an empty inventory", () => {
    const raw = { groups: [], influence: [] };
    expect(validateAnalysis(raw, [])).toEqual(raw);
    expectInvalid(review(), []);
  });

  for (const [name, raw] of [
    ["a null result", null],
    ["a serialized result", JSON.stringify(review())],
    ["missing Influence", { groups: [group] }],
    ["a group list that is not an array", { groups: group, influence: [] }],
    ["an Influence list that is not an array", { groups: [group], influence: {} }],
    ["a sparse group list", { groups: [group, ,], influence: [] }],
    ["a null group", { groups: [null], influence: [] }],
    ["an empty result for nonempty changes", { groups: [], influence: [] }],
    ["a group without files", review({ files: [] })],
    ["an omitted changed file", review({ files: [middleware] })],
    ["a duplicate path in one group", review({ files: [middleware, middleware] })],
    ["a fabricated path", review({ files: [middleware, "private-provider-output.js"] })],
    ["a rename source instead of the changed path", review({ files: [middleware, oldSessions] })],
    ["a path with different case", review({ files: [middleware.toUpperCase(), sessions] })],
    ["a path with added whitespace", review({ files: [` ${middleware}`, sessions] })],
    ["duplicate group IDs", { groups: [group, { ...group, files: [sessions] }], influence: [] }],
    ["a path-like group ID", review({ id: "../session" })],
    ["a group ID with a trailing newline", review({ id: "session\n" })],
    ["an oversized group ID", review({ id: "a".repeat(65) })],
    ["an oversized group list", { groups: Array(257).fill(group), influence: [] }],
    ["an invalid importance label", review({ importance: "High" })],
    ["a missing description", review({ description: undefined })],
    ["an invalid description type", review({ description: {} })],
    ["a blank title", review({ title: "   " })],
    ["an oversized title", review({ title: "a".repeat(121) })],
    ["an oversized review action", review({ keyToReview: `Verify ${"x".repeat(480)}` })],
    ["a review action with a control character", review({ keyToReview: "Verify active\0 sessions." })],
    ["a non-actionable review concern", review({ keyToReview: "Sessions should stay active." })],
    ["a review action without a target", review({ keyToReview: "Verify ..." })],
    ["a review action that repeats the description", review({ description: group.keyToReview })],
    ["a null Influence entry", { groups: [group], influence: [null] }],
    ["a non-actionable Influence recommendation", withInfluence({ description: "Refresh might break." })],
    ["a non-array evidence list", withInfluence({ evidenceIds: "refresh:24" })],
    ["an evidence ID that is not a string", withInfluence({ evidenceIds: [{ id: "refresh:24" }] })],
    ["an oversized evidence ID", withInfluence({ evidenceIds: ["x".repeat(129)] })],
    ["an oversized evidence list", withInfluence({ evidenceIds: Array(65).fill("refresh:24") })],
    ["an oversized Influence list", { groups: [group], influence: Array(65).fill(influence) }],
  ]) {
    test(`rejects ${name}`, () => expectInvalid(raw));
  }

  test("rejects an oversized path even when it appears in the inventory", () => {
    const path = "a".repeat(4097);
    expectInvalid(review({ files: [path] }), [{ path, status: "M" }]);
  });

  test("does not include provider content in validation errors", () => {
    const marker = "private-provider-output.js";
    const run = () => validateAnalysis(review({ files: [middleware, marker] }), files);
    expect(run).toThrow(invalid);
    expect(run).not.toThrow(marker);
  });

  test("drops unsupported Influence entries when evidence is not available", () => {
    const raw = withInfluence({ references: [{ path: "src/refresh.js", symbol: "refresh", line: 24 }] });
    expect(validateAnalysis(raw, files)).toEqual({ groups: [group], influence: [] });
  });

  test("resolves only canonical unchanged references from vetted evidence", () => {
    const evidence = [
      { id: "refresh:24", path: "src/account/refresh.js", symbol: "refreshSession", line: 24, text: "function refreshSession() {}" },
      { id: "timer:11", path: "src/account/timer.js", symbol: "refreshTimer", line: 11, text: "function refreshTimer() {}" },
      { id: "middleware", path: middleware, symbol: "authorize", line: 1, text: "function authorize() {}" },
      { id: "old-store", path: oldSessions, symbol: "lookup", line: 1, text: "function lookup() {}" },
      { id: "no-line", path: "src/account/expiry.js", symbol: "expires", line: 0, text: "function expires() {}" },
    ];
    const raw = {
      groups: [group],
      influence: [
        {
          ...influence,
          evidenceIds: ["fabricated", "timer:11", "refresh:24", "timer:11", "middleware", "old-store", "no-line"],
          references: [{ path: "fictional.js", symbol: "madeUp", line: 1 }],
        },
        { ...influence, name: "Unsupported entry", evidenceIds: ["other-id"] },
        { ...influence, name: "Empty entry", evidenceIds: [] },
      ],
    };
    expect(validateAnalysis(raw, files, evidence)).toEqual({
      groups: [group],
      influence: [{
        name: influence.name,
        description: influence.description,
        references: [
          { path: "src/account/timer.js", symbol: "refreshTimer", line: 11 },
          { path: "src/account/refresh.js", symbol: "refreshSession", line: 24 },
        ],
      }],
    });
  });
});
