"use client";

import Link from "next/link";

// Brand only. Wallet connect lives on each game page.
const Header = () => {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-amber-300 bg-black/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <Link href="/" className="text-sm uppercase tracking-widest text-amber-200">
          contraband_protocol
        </Link>
        <span className="text-[11px] uppercase tracking-widest text-cyan-100">inco customs lane</span>
      </div>
    </header>
  );
};

export { Header };
