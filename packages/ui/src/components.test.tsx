import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { OtpInput, ShopStatusToggle, StatusBadge, TextField } from "./components";

describe("design system", () => {
  it("status badge always shows text, not colour alone", () => {
    render(<StatusBadge kind="out_of_stock" label="Out of stock" />);
    const el = screen.getByText("Out of stock");
    expect(el).toHaveAttribute("data-status", "out_of_stock");
  });

  it("OTP input accepts digits only and caps length", () => {
    function Harness() {
      const [v, setV] = useState("");
      return <OtpInput label="Code" value={v} onChange={setV} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText("Code") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12a3-45678" } });
    expect(input.value).toBe("123456");
  });

  it("text field links error to input for screen readers", () => {
    render(<TextField label="Mobile" error="Enter a valid number" />);
    const input = screen.getByLabelText("Mobile");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid number");
  });

  it("shop toggle shows state word and action", () => {
    const onToggle = vi.fn();
    const labels = { title: "SHOP STATUS", open: "OPEN", closed: "CLOSED", openAction: "Open Shop", closeAction: "Close Shop" };
    const { rerender } = render(<ShopStatusToggle isOpen={false} onToggle={onToggle} labels={labels} />);
    expect(screen.getByTestId("shop-state")).toHaveTextContent("CLOSED");
    fireEvent.click(screen.getByRole("button", { name: /Open Shop/ }));
    expect(onToggle).toHaveBeenCalled();
    rerender(<ShopStatusToggle isOpen onToggle={onToggle} labels={labels} />);
    expect(screen.getByTestId("shop-state")).toHaveTextContent("OPEN");
    expect(screen.getByRole("button", { name: /Close Shop/ })).toBeInTheDocument();
  });
});
