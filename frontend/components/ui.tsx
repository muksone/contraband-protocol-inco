"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// Full-screen blur + pulsing dots for a multi-step wait (e.g. dealer playing).
export function FullScreenLoader({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[100] grid place-items-center bg-background/70 backdrop-blur-md"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2.5 w-2.5 bg-primary"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
        <span className="text-sm uppercase tracking-widest text-primary">{text}</span>
      </div>
    </motion.div>
  );
}

// High-contrast customs button; outline variant stays readable on scanner panels.
export function Button({
  className,
  variant = "solid",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "outline" }) {
  return (
    <button
      className={cn(
        "min-h-11 px-4 py-2.5 text-sm uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        variant === "solid"
          ? "border-2 border-primary bg-primary text-primary-foreground hover:bg-amber-200"
          : "border-2 border-cyan-200 text-cyan-100 hover:bg-cyan-200 hover:text-black",
        className,
      )}
      {...props}
    />
  );
}

// Bordered scanner panel.
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("border-2 border-border bg-card/80 p-5 backdrop-blur-sm", className)} {...props} />
  );
}

// Live status line: pending tx phase, or a loading hint. Renders nothing when idle.
export function TxBar({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="mt-4 flex items-center gap-2 border border-amber-300/70 bg-amber-300/10 px-3 py-2 text-xs uppercase tracking-widest text-amber-100">
      <span className="h-1.5 w-1.5 animate-pulse bg-primary" />
      {text}...
    </div>
  );
}

// A numbered step so the flow reads top to bottom.
export function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <span className="grid h-5 w-5 place-items-center border border-primary text-primary">{n}</span>
        {title}
      </div>
      {children}
    </div>
  );
}
