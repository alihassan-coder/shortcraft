import type { Metadata } from "next";
import Link from "next/link";
import { AuthDivider, AuthShell, GoogleButton, fieldClass } from "@/components/site/auth-shell";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      lead="Log in to keep editing your videos."
      footer={
        <>
          New to Shortcraft?{" "}
          <Link href="/signup" className="font-medium text-ink underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      <GoogleButton label="Continue with Google" />
      <AuthDivider />
      <form className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" placeholder="you@example.com" className={fieldClass} />
        </div>
        <div>
          <div className="mb-2 flex justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <a href="#" className="text-sm text-muted-foreground hover:text-ink">
              Forgot password?
            </a>
          </div>
          <input id="password" type="password" autoComplete="current-password" className={fieldClass} />
        </div>
        <button type="submit" className="h-12 w-full rounded-full bg-ink text-[15px] font-medium text-white transition-colors hover:bg-ink-2">
          Log in
        </button>
      </form>
    </AuthShell>
  );
}
