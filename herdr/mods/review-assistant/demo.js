import { reviewLaunchers } from "./provider.js";

const [launcher] = reviewLaunchers([{
  key: "review-omp-demo",
  name: "Sandboxed OMP",
  argv: ["/usr/local/bin/example-review-wrapper", "--profile", "review demo"],
  installed: true,
}]);

const result = {
  groups: [
    {
      id: "authorization",
      title: "Authorization flow",
      importance: "high",
      description: "Rejects revoked tokens before they reach request handlers.",
      keyToReview: "Verify that revocation checks reject inactive sessions without blocking legitimate requests.",
      files: ["src/auth/middleware.ts", "src/auth/token-service.ts", "src/auth/controller.ts"],
    },
    {
      id: "api-errors",
      title: "API error handling",
      importance: "medium",
      description: "Normalizes retry behavior and maps network failures to user-facing errors.",
      keyToReview: "Confirm the retry rules preserve existing API contracts and don't repeat writes.",
      files: ["src/api/client.ts", "src/api/errors.ts"],
    },
    {
      id: "ui-filters",
      title: "UI filter state",
      importance: "low",
      description: "Restores the selected status and date filters after a page reload.",
      keyToReview: "Check that restored filters don't override filters in an existing URL.",
      files: ["src/search/filter-state.ts"],
    },
    {
      id: "tests",
      title: "Test updates",
      importance: "medium",
      description: "Adds regression coverage for revoked tokens, retry behavior, and restored filters.",
      keyToReview: "Verify the tests cover a revoked token and an active session.",
      files: ["tests/auth.test.ts", "tests/api-client.test.ts", "tests/filter-state.test.ts"],
    },
  ],
  influence: [
    {
      name: "Session lifecycle",
      description: "Verify that refresh rejects revoked sessions without signing out active users.",
      references: [{ path: "src/session/refresh.ts", symbol: "refreshSession", line: 24 }],
    },
    {
      name: "Route guards",
      description: "Check that guarded routes still reject inactive sessions.",
      references: [{ path: "src/routes/guard.ts", symbol: "requireSession", line: 16 }],
    },
    {
      name: "Error surfaces",
      description: "Verify that existing screens still recognize retryable errors.",
      references: [{ path: "src/ui/error-state.ts", symbol: "showError", line: 31 }],
    },
    {
      name: "Saved URLs",
      description: "Confirm that previously shared URLs still restore the expected filters.",
      references: [{ path: "src/search/url.ts", symbol: "readFilters", line: 12 }],
    },
  ],
};

export function demoReview() {
  return {
    status: "ready",
    message: null,
    launcherOptions: [],
    selectedLauncher: launcher,
    launcherLocation: { on: "demo-linux", cwd: "/home/demo/example-project" },
    launcherMessage: "This is an example launcher. The demo doesn't run reviews.",
    result,
    expanded: new Set([result.groups[0].id]),
    detail: null,
    canNavigate: false,
  };
}
