import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { Faq } from "@/lib/content/faq";

export function FaqList({ items, title = "Questions" }: { items: Faq[]; title?: string }) {
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.7fr]">
      <div>
        <h2 className="text-[2rem] leading-tight font-semibold tracking-[-0.03em] md:text-h2">{title}</h2>
        <p className="mt-4 text-muted-foreground">
          Something else?{" "}
          <a href="mailto:hello@shortcraft.app" className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            Email us
          </a>
          .
        </p>
      </div>
      <Accordion type="single" collapsible className="border-t">
        {items.map((item) => (
          <AccordionItem key={item.q} value={item.q} className="border-b">
            <AccordionTrigger className="py-6 text-[17px] font-medium hover:no-underline">{item.q}</AccordionTrigger>
            <AccordionContent className="pb-6 text-base leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
