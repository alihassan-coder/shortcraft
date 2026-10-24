import { Check, Minus } from "lucide-react";
import { COMPARE, PLANS } from "@/lib/content/pricing";

export function CompareTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[15px]">
        <thead>
          <tr>
            <th className="w-[40%] py-4 text-left font-normal text-muted-foreground">Compare plans</th>
            {PLANS.map((p) => (
              <th key={p.id} className="py-4 text-left font-semibold">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        {COMPARE.map((group) => (
          <tbody key={group.group}>
            <tr>
              <th colSpan={4} className="pt-10 pb-3 text-left text-sm font-semibold">
                {group.group}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.label} className="border-t">
                <td className="py-3.5 pr-4 text-ink-2">{row.label}</td>
                {row.values.map((v, i) => (
                  <td key={i} className="py-3.5">
                    {v === true ? (
                      <Check className="size-4" aria-label="Included" />
                    ) : v === false ? (
                      <Minus className="size-4 text-line" aria-label="Not included" />
                    ) : (
                      v
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
