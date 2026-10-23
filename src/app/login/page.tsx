"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@flu-wop/design-system";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("Dashboard");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not sign in");
    } catch {
      setError("Could not reach the server");
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <form onSubmit={submit} className="w-full max-w-sm">
        <p className="text-eyebrow uppercase text-accent-text">Mid City Sound</p>
        <h1 className="mt-3 font-display text-heading-2 text-ink">
          Studio <em className="text-accent-text">Control</em>
        </h1>
        <p className="mt-3 text-body-sm text-ink-muted">Private. Recording and cameras for both rooms.</p>

        <div className="mt-8 space-y-4">
          <Input
            label="Name"
            type="text"
            name="username"
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
        </div>

        <div className="mt-6">
          <Button type="submit" size="lg" disabled={busy || password.length === 0} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </main>
  );
}
