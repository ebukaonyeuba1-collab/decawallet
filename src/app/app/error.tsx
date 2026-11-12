"use client";
import { Alert, Button } from "@/components/ui";
export default function Err({ reset }: { error: Error; reset: () => void }) {
  return <div className="space-y-4"><Alert tone="bad" title="We could not load this page">Your money and data are safe. Please try again.</Alert><Button onClick={reset}>Try again</Button></div>;
}
