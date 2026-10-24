import type { Metadata } from "next";
import Link from "next/link";
import { AuthDivider, AuthShell, GoogleButton, fieldClass } from "@/components/site/auth-shell";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      lead="Free for 5 videos a month. No credit card."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-ink underline underline-offset-4">
            Log in
          </Link>
        </>
      }
    >
      <GoogleButton label="Sign up with Google" />
      <AuthDivider />
      <form className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-2 block text-sm font-medium">
            Name
          </label>
          <input id="name" autoComplete="name" placeholder="Your name" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" placeholder="you@example.com" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium">
            Password
          </label>
          <input id="password" type="password" autoComplete="new-password" placeholder="At least 8 characters" className={fieldClass} />
        </div>
        <button type="submit" className="h-12 w-full rounded-full bg-ink text-[15px] font-medium text-white transition-colors hover:bg-ink-2">
          Create account
        </button>
      </form>
    </AuthShell>
  );
}
