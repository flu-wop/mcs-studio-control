"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@flu-wop/design-system";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"owner" | "engineer">("owner");
  const [name, setName] = useState("Dashboard");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const engineer = mode === "engineer";
  const ready = engineer ? code.replace(/\D/g, "").length === 6 : password.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(engineer ? "/api/auth/pair" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(engineer ? { code: code.replace(/\D/g, "") } : { password }),
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
        <p className="mt-3 text-body-sm text-ink-muted">
          {engineer ? "Enter the 6-digit code from the studio owner." : "Private. Recording and cameras for both rooms."}
        </p>

        <div className="mt-8 space-y-4">
          {engineer ? (
            <Input
              key="code"
              label="Engineer code"
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              error={error}
            />
          ) : (
            <>
              <Input
                key="name"
                label="Name"
                type="text"
                name="username"
                autoComplete="username"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                key="password"
                label="Password"
                type="password"
                name="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error}
              />
            </>
          )}
        </div>

        <div className="mt-6">
          <Button type="submit" size="lg" disabled={busy || !ready} className="w-full">
            {busy ? "Signing in…" : engineer ? "Join session" : "Sign in"}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => {
            setMode(engineer ? "owner" : "engineer");
            setError(undefined);
          }}
          className="mt-5 min-h-[44px] w-full text-center text-body-sm text-ink-muted underline-offset-4 transition-colors duration-fast hover:text-ink hover:underline"
        >
          {engineer ? "Back to owner sign in" : "I have an engineer code"}
        </button>
      </form>
    </main>
  );
}
