"use client";

import { createContext, useContext, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

interface ImmersiveContextValue {
  /** When true, the app chrome (nav header) is hidden to reclaim space. */
  immersive: boolean;
  setImmersive: (v: boolean) => void;
}

const ImmersiveContext = createContext<ImmersiveContextValue>({
  immersive: false,
  setImmersive: () => {},
});

/**
 * Lets a page (currently /live during recording) hide the nav header for a
 * distraction-free, more-vertical-space view. The header and main padding are
 * rendered here so both react to the same state; the toggling page reads
 * `useImmersive()`.
 */
export function useImmersive(): ImmersiveContextValue {
  return useContext(ImmersiveContext);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [immersive, setImmersive] = useState(false);
  return (
    <ImmersiveContext.Provider value={{ immersive, setImmersive }}>
      {!immersive && <SiteHeader />}
      <main
        className={cn(
          "mx-auto w-full max-w-5xl px-6",
          immersive ? "py-5" : "py-10",
        )}
      >
        {children}
      </main>
    </ImmersiveContext.Provider>
  );
}
