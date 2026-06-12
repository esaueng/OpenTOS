import { Check, Minus } from "lucide-react";

import type { ChecklistItem } from "../lib/workflow";

export function ValidationChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <div className="checklist" role="list" aria-label="Run readiness checklist">
      {items.map((item) => (
        <div key={item.id} role="listitem" className={`check ${item.done ? "done" : ""}`}>
          <span aria-hidden="true">{item.done ? <Check size={12} strokeWidth={2.4} /> : <Minus size={12} />}</span>
          {item.label}
          {item.optional && <em className="check-optional">recommended</em>}
        </div>
      ))}
    </div>
  );
}
