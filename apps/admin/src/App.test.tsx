import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { hasPerm, orderStatusKind, Pagination, rowActivation, useStaleGuard, type Who } from "./App";

function who(permissions: string[]): Who {
  return { id: "u1", name: "Admin", roles: ["admin"], permissions };
}

describe("hasPerm (Phase 11: permission-aware UI, ARCHITECTURE D32)", () => {
  it("a superuser's wildcard ['*'] grants every permission", () => {
    expect(hasPerm(who(["*"]), "accounts.manage_users")).toBe(true);
    expect(hasPerm(who(["*"]), "vendors.verify_vendor")).toBe(true);
  });

  it("grants only a permission actually present in who.permissions", () => {
    const w = who(["vendors.verify_vendor"]);
    expect(hasPerm(w, "vendors.verify_vendor")).toBe(true);
    expect(hasPerm(w, "vendors.suspend_vendor")).toBe(false);
    expect(hasPerm(w, "accounts.manage_users")).toBe(false);
  });

  it("a staff role with no fine-grained permission at all sees nothing action-gated", () => {
    expect(hasPerm(who([]), "accounts.manage_users")).toBe(false);
  });
});

describe("orderStatusKind (admin Orders section status colouring)", () => {
  it("maps terminal success statuses to in_stock (green)", () => {
    expect(orderStatusKind("completed")).toBe("in_stock");
    expect(orderStatusKind("delivered")).toBe("in_stock");
    expect(orderStatusKind("picked_up")).toBe("in_stock");
  });

  it("maps terminal failure statuses to out_of_stock (red)", () => {
    expect(orderStatusKind("cancelled")).toBe("out_of_stock");
    expect(orderStatusKind("rejected")).toBe("out_of_stock");
  });

  it("maps every in-flight status to low_stock (amber, in-progress)", () => {
    for (const s of ["placed", "accepted", "preparing", "ready", "out_for_delivery"] as const) {
      expect(orderStatusKind(s)).toBe("low_stock");
    }
  });
});

describe("Pagination (shared server-side pagination control, Phase 11)", () => {
  it("renders nothing when everything fits on one page", () => {
    const { container } = render(<Pagination page={1} pageSize={20} count={5} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the current page, total pages and item count", () => {
    render(<Pagination page={2} pageSize={20} count={45} onChange={vi.fn()} />);
    expect(screen.getByText("Page 2 of 3 · 45 total")).toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last page", () => {
    const { rerender } = render(<Pagination page={1} pageSize={20} count={45} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    rerender(<Pagination page={3} pageSize={20} count={45} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("calls onChange with page ± 1 when Next/Previous is clicked", () => {
    const onChange = vi.fn();
    render(<Pagination page={2} pageSize={20} count={45} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});

describe("useStaleGuard (Phase 12 hardening, ARCHITECTURE D33 — admin list race guard)", () => {
  it("a stale (earlier) request's isCurrent() returns false once a newer request has started", () => {
    const { result } = renderHook(() => useStaleGuard());
    const guard = result.current;

    const firstIsCurrent = guard(); // simulates the first list request firing
    const secondIsCurrent = guard(); // a newer request fires before the first resolves (e.g. fast typing)

    // The first (now stale) response must not be allowed to win...
    expect(firstIsCurrent()).toBe(false);
    // ...but the second (latest) one still should.
    expect(secondIsCurrent()).toBe(true);
  });

  it("a single in-flight request's isCurrent() stays true when it is the only one", () => {
    const { result } = renderHook(() => useStaleGuard());
    const isCurrent = result.current();
    expect(isCurrent()).toBe(true);
    expect(isCurrent()).toBe(true); // calling it again doesn't itself invalidate it
  });

  it("returns a stable callback across re-renders, safe to depend on in useCallback", () => {
    const { result, rerender } = renderHook(() => useStaleGuard());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("rowActivation (Phase 12 hardening — keyboard/screen-reader access for clickable table rows)", () => {
  it("marks the row as a focusable button and fires onActivate on click", () => {
    const onActivate = vi.fn();
    render(
      <table>
        <tbody>
          <tr data-testid="row" {...rowActivation(onActivate)}>
            <td>Row</td>
          </tr>
        </tbody>
      </table>,
    );
    const row = screen.getByTestId("row");
    expect(row).toHaveAttribute("role", "button");
    expect(row).toHaveAttribute("tabIndex", "0");
    fireEvent.click(row);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("activates on Enter and Space, not on other keys", () => {
    const onActivate = vi.fn();
    render(
      <table>
        <tbody>
          <tr data-testid="row" {...rowActivation(onActivate)}>
            <td>Row</td>
          </tr>
        </tbody>
      </table>,
    );
    const row = screen.getByTestId("row");
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(row, { key: "Tab" });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});
