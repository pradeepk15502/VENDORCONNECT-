import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest's `globals` option is off (tests import `describe`/`it`/etc. explicitly), so
// @testing-library/react's own auto-cleanup — which detects a global test framework — never
// registers. Without this, DOM from one test stays mounted into the next, which silently breaks
// any query that isn't scoped to unique text (e.g. `getAllByRole`, `getAllByText`).
afterEach(() => {
  cleanup();
});
