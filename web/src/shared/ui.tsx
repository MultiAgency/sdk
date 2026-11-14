import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge as BadgePrimitive } from "@/components/ui/badge";
import { Card as CardPrimitive } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export { Button };
export type Tone = "neutral" | "success" | "warning" | "info" | "destructive";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <BadgePrimitive variant={tone}>{children}</BadgePrimitive>;
}

export function Card({ className = "", size = "default", children }: { className?: string; size?: "default" | "sm"; children: ReactNode }) {
  // Existing feature cards contain direct children; keep their horizontal padding.
  return <CardPrimitive size={size} className={cn("px-(--card-spacing)", className)}>{children}</CardPrimitive>;
}

export function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

/** Why an action failed, in the server's or wallet's words; nothing when it didn't. */
export function ErrorBox({ error }: { error?: string }) {
  return <div role="alert" aria-atomic="true" className={error ? undefined : "sr-only"}>
    {error && <Alert variant="destructive" role="presentation"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}

/** A query still on its way: what is loading, so an empty list is never shown in its place. */
export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
      <Spinner /> {label}
    </p>
  );
}
