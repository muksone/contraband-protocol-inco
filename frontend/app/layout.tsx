import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Toaster } from "sonner";

// DepartureMono - the pixel-mono face from the hangman/mines apps.
const departureMono = localFont({
  src: "./fonts/DepartureMono-Regular.woff",
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Confidential Deck",
  description: "Confidential card games on Inco - War, Blackjack, Raffle, Mafia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="en" className="dark">
      <body suppressHydrationWarning className={`min-h-screen font-mono ${departureMono.variable}`}>
        <Providers>
          <Header />
          {children}
        </Providers>
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "hsl(var(--card))",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--border))",
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: "13px",
              borderRadius: "0",
            },
          }}
        />
      </body>
    </html>
  );
}
