import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Logo, LogoMark } from "@/components/brand/logo";
import { FaqList } from "@/components/marketing/faq-list";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { GENERAL_FAQ } from "@/lib/content/faq";
import { PLANS } from "@/lib/content/pricing";

describe("PricingPlans", () => {
  const pro = PLANS.find((p) => p.id === "pro")!;
  const proCard = () => screen.getByRole("heading", { name: pro.name }).closest("div")!.parentElement!;

  it("defaults to yearly pricing", () => {
    render(<PricingPlans />);
    const period = screen.getByRole("group", { name: "Billing period" });
    expect(within(period).getByRole("button", { name: /Yearly/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(proCard()).getByText(`$${pro.yearly}`)).toBeInTheDocument();
    expect(within(proCard()).getByText(`$${pro.yearly * 12} billed yearly`)).toBeInTheDocument();
  });

  it("switches to monthly and back", async () => {
    render(<PricingPlans />);
    await userEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
    expect(within(proCard()).getByText(`$${pro.monthly}`)).toBeInTheDocument();
    expect(within(proCard()).getByText("Billed monthly")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Yearly/ }));
    expect(within(proCard()).getByText(`$${pro.yearly}`)).toBeInTheDocument();
  });

  it("renders one card per plan, free plan says free forever", () => {
    render(<PricingPlans />);
    for (const plan of PLANS) expect(screen.getByRole("heading", { name: plan.name })).toBeInTheDocument();
    expect(screen.getByText("Free forever")).toBeInTheDocument();
  });
});

describe("FaqList", () => {
  it("renders every question and opens an answer", async () => {
    render(<FaqList items={GENERAL_FAQ} title="Common questions" />);
    expect(screen.getByRole("heading", { name: "Common questions" })).toBeInTheDocument();
    const triggers = screen.getAllByRole("button");
    expect(triggers).toHaveLength(GENERAL_FAQ.length);

    const first = screen.getByRole("button", { name: GENERAL_FAQ[0].q });
    expect(first).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(GENERAL_FAQ[0].a)).toBeVisible();
  });
});

describe("Logo", () => {
  it("links home with an accessible name", () => {
    render(<Logo />);
    const link = screen.getByRole("link", { name: "Shortcraft home" });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveTextContent("Shortcraft");
  });

  it("supports a custom href and a decorative mark", () => {
    const { container } = render(
      <>
        <Logo href="/editor/demo" />
        <LogoMark />
      </>,
    );
    expect(screen.getByRole("link", { name: "Shortcraft home" })).toHaveAttribute("href", "/editor/demo");
    expect(container.querySelectorAll("svg[aria-hidden]")).toHaveLength(2);
  });
});
