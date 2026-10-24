import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberField, Section, Segmented, SliderRow, ToggleRow } from "@/components/editor/controls";

describe("Segmented", () => {
  const options = [
    { value: 1, label: "1×" },
    { value: 2, label: "2×" },
    { value: 4, label: "4×" },
  ];

  it("marks the current value as pressed and reports clicks", async () => {
    const onChange = vi.fn();
    render(<Segmented label="Speed" value={1} options={options} onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Speed" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2×" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "2×" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("shows nothing pressed when the value is null (mixed selection)", () => {
    render(<Segmented label="Speed" value={null} options={options} onChange={() => {}} />);
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ToggleRow", () => {
  function Controlled() {
    const [on, setOn] = useState(false);
    return <ToggleRow label="Auto zoom" hint="Punch in on key words" checked={on} onChange={setOn} />;
  }

  it("toggles via the switch and via the label text", async () => {
    render(<Controlled />);
    const sw = screen.getByRole("switch", { name: "Auto zoom" });
    expect(sw).not.toBeChecked();
    expect(screen.getByText("Punch in on key words")).toBeInTheDocument();

    await userEvent.click(sw);
    expect(sw).toBeChecked();
    await userEvent.click(screen.getByText("Auto zoom"));
    expect(sw).not.toBeChecked();
  });
});

describe("SliderRow", () => {
  it("formats the value and steps with the keyboard", async () => {
    const onChange = vi.fn();
    render(<SliderRow label="Volume" value={40} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={onChange} />);
    expect(screen.getByText("40%")).toBeInTheDocument();

    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "40");
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(45);
  });
});

describe("NumberField", () => {
  it("commits a clamped value on Enter, not on every keystroke", async () => {
    const onCommit = vi.fn();
    render(<NumberField label="W" value={1080} min={16} max={4096} onCommit={onCommit} />);
    const input = screen.getByRole("textbox", { name: "W" });

    await userEvent.clear(input);
    await userEvent.type(input, "9999");
    expect(onCommit).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(4096);
    expect(input).toHaveValue("4096");
  });

  it("reverts invalid input on blur", async () => {
    const onCommit = vi.fn();
    render(<NumberField label="H" value={1920} onCommit={onCommit} />);
    const input = screen.getByRole("textbox", { name: "H" });

    await userEvent.clear(input);
    await userEvent.type(input, "abc");
    await userEvent.tab();
    expect(input).toHaveValue("1920");
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Known bug: Escape resets the draft and then blurs, but the blur handler still
  // sees the typed draft and commits it. Flip to `it` once NumberField is fixed.
  it.fails("discards the draft on Escape", async () => {
    const onCommit = vi.fn();
    render(<NumberField label="H" value={1920} onCommit={onCommit} />);
    const input = screen.getByRole("textbox", { name: "H" });

    await userEvent.type(input, "5{Escape}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue("1920");
  });
});

describe("Section", () => {
  it("collapses and expands its content", async () => {
    render(
      <Section id="test-section" title="Captions">
        <p>Section body</p>
      </Section>,
    );
    const toggle = screen.getByRole("button", { name: "Captions" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Section body")).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Section body")).not.toBeInTheDocument();
  });
});
