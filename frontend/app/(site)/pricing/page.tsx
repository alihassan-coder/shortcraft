import type { Metadata } from "next";
import { CompareTable } from "@/components/marketing/compare-table";
import { FaqList } from "@/components/marketing/faq-list";
import { PricingPlans } from "@/components/marketing/pricing-plans";
import { CtaBand } from "@/components/site/cta-band";
import { Container, PageIntro, Section } from "@/components/site/layout-primitives";
import { PRICING_FAQ } from "@/lib/content/faq";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free for 5 videos a month. Pro and Business plans when you post more.",
};

export default function PricingPage() {
  return (
    <>
      <PageIntro
        title="Simple pricing"
        lead="Start free with every caption style and auto edit. Upgrade when you post more."
      />
      <Container>
        <PricingPlans />
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Prices in USD. Paid plans include a 7-day free trial and can be cancelled any time.
        </p>
      </Container>
      <Section>
        <CompareTable />
      </Section>
      <Section tone="surface">
        <FaqList items={PRICING_FAQ} title="Billing questions" />
      </Section>
      <CtaBand title="Try it on your next video." />
    </>
  );
}
