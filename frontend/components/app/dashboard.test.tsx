import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Dashboard } from "./dashboard";
import { VibePicker } from "./vibe-picker";
import type { Vibe } from "@/lib/upload/project-index";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
}));

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Dashboard", () => {
  it("shows a clear message and the demo link when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<Dashboard />);
    expect(await screen.findByText("Can’t reach the Shortcraft server")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open demo editor" })).toHaveAttribute("href", "/editor/demo");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the upload dropzone when there are no projects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
    render(<Dashboard />);
    expect(await screen.findByText("Drop your first video here")).toBeInTheDocument();
  });

  it("lists projects and filters them by search", async () => {
    const project = (id: string, title: string) => ({
      id,
      title,
      created_at: "2026-10-24T10:00:00Z",
      updated_at: "2026-10-24T10:00:00Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/projects?limit=200&offset=0")
          ? json([project("a", "Morning routine"), project("b", "Podcast clip")])
          : json({ error: { code: "not_found", message: "Not found" } }, 404),
      ),
    );
    render(<Dashboard />);
    expect(await screen.findByText("Morning routine")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search projects"), "podcast");
    expect(screen.queryByText("Morning routine")).not.toBeInTheDocument();
    expect(screen.getByText("Podcast clip")).toBeInTheDocument();
  });
});

describe("VibePicker", () => {
  function Harness() {
    const [vibe, setVibe] = useState<Vibe>("energetic");
    return <VibePicker value={vibe} onChange={setVibe} />;
  }

  it("is a radio group that moves with the arrow keys", async () => {
    render(<Harness />);
    const energetic = screen.getByRole("radio", { name: /Energetic/ });
    expect(energetic).toHaveAttribute("aria-checked", "true");
    energetic.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Clean/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Clean/ })).toHaveFocus();
  });
});
