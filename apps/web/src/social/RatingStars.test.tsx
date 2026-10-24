import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RatingInput, RatingStars } from "./RatingStars";

describe("RatingStars (read-only)", () => {
  it("exposes the rating as a single accessible label, never colour alone", () => {
    render(<RatingStars value={4} label="4 out of 5 stars" />);
    expect(screen.getByRole("img", { name: "4 out of 5 stars" })).toBeInTheDocument();
  });
});

describe("RatingInput (master prompt §41: keyboard-accessible rating picker)", () => {
  it("is built from real radio inputs, one per star, grouped under one accessible name", () => {
    render(<RatingInput value={0} onChange={vi.fn()} label="Your rating" />);
    const group = screen.getByRole("radiogroup", { name: "Your rating" });
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(group).toContainElement(radios[0]);
    // Real inputs mean Tab/arrow-key navigation and screen readers work without any extra wiring.
    radios.forEach((r) => expect(r.tagName).toBe("INPUT"));
  });

  it("selecting a star calls onChange with that star's value", () => {
    const onChange = vi.fn();
    render(<RatingInput value={0} onChange={onChange} label="Your rating" />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    fireEvent.click(radios[2]); // third star
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("reflects the selected value as the checked radio", () => {
    function Harness() {
      const [v, setV] = useState(0);
      return <RatingInput value={v} onChange={setV} label="Your rating" />;
    }
    render(<Harness />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    fireEvent.click(radios[3]); // fourth star
    expect(radios[3].checked).toBe(true);
    expect(radios[0].checked).toBe(false);
  });
});
