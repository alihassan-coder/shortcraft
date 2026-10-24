"use client";

import { useState } from "react";
import { buttonLinkClass } from "@/components/site/layout-primitives";
import Link from "next/link";
import { PLANS } from "@/lib/content/pricing";
import { cn } from "@/lib/utils";

export function PricingPlans() {
  const [yearly, setYearly] = useState(true);

  return (
    <div>
      <div className="flex justify-center">
        <div className="inline-flex rounded-full bg-surface p-1 text-sm" role="group" aria-label="Billing period">
          {[
            { value: false, label: "Monthly" },
            { value: true, label: "Yearly" },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => setYearly(opt.value)}
              aria-pressed={yearly === opt.value}
              className={cn(
                "rounded-full px-5 py-2 transition",
                yearly === opt.value ? "bg-white font-medium shadow-sm" : "text-muted-foreground hover:text-ink",
              )}
            >
              {opt.label}
              {opt.value && <span className="ml-1.5 text-rec">−20%</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const price = yearly ? plan.yearly : plan.monthly;
          return (
            <div
              key={plan.id}
              className={cn(
                "flex flex-col rounded-[20px] p-8",
                plan.featured ? "bg-ink text-white" : "border bg-white",
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                {plan.featured && (
                  <span className="rounded-full bg-rec px-2.5 py-1 text-xs font-medium text-white">Most popular</span>
                )}
              </div>
              <p className={cn("mt-2 text-[15px]", plan.featured ? "text-white/65" : "text-muted-foreground")}>
                {plan.description}
              </p>
              <p className="mt-8 flex items-baseline gap-1.5">
                <span className="text-5xl font-semibold tracking-[-0.04em]">${price}</span>
                <span className={cn("text-[15px]", plan.featured ? "text-white/60" : "text-muted-foreground")}>
                  per month
                </span>
              </p>
              <p className={cn("mt-1 h-5 text-sm", plan.featured ? "text-white/50" : "text-muted-foreground")}>
                {price === 0 ? "Free forever" : yearly ? `$${price * 12} billed yearly` : "Billed monthly"}
              </p>
              <Link
                href="/signup"
                className={buttonLinkClass({
                  variant: plan.featured ? "accent" : "secondary",
                  size: "lg",
                  className: "mt-8 w-full",
                })}
              >
                {plan.cta}
              </Link>
              <ul className={cn("mt-8 space-y-3 text-[15px]", plan.featured ? "text-white/85" : "text-ink-2")}>
                {plan.highlights.map((f) => (
                  <li key={f} className="flex gap-3">
                    <svg viewBox="0 0 16 16" className={cn("mt-1 size-4 shrink-0", plan.featured ? "text-rec" : "text-ink")} fill="none" aria-hidden>
                      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
