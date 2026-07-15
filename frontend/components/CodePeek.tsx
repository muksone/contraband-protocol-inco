"use client";

import { useState } from "react";

// Collapsible Solidity peek. Collapsed by default so it never crowds the UI;
// comments are dimmed so the kit calls read clearly.
export function CodePeek({ code, title = "see the solidity" }: { code: string; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
      >
        <span>{title}</span>
        <span className="text-primary">{open ? "-" : "+"}</span>
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-border bg-background/60 p-3 text-[11px] leading-relaxed">
          <code>
            {code.split("\n").map((line, i) => {
              const idx = line.indexOf("//");
              const codePart = idx >= 0 ? line.slice(0, idx) : line;
              const comment = idx >= 0 ? line.slice(idx) : "";
              return (
                <div key={i}>
                  <span className="text-foreground/90">{codePart}</span>
                  {comment && <span className="text-muted-foreground">{comment}</span>}
                </div>
              );
            })}
          </code>
        </pre>
      )}
    </div>
  );
}
