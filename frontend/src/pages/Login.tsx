import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { user, needsHousehold, login, signup, finishSetup, logout } = useAuth();
  const [chosenMode, setMode] = useState<"login" | "signup">("login");
  // Signed in without a household: only the household part of sign-up is left.
  const mode = needsHousehold ? "setup" : chosenMode;
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const household = { full_name: fullName, household_name: householdName || undefined, invite_code: inviteCode || undefined };
      if (mode === "login") {
        await login(email, password);
      } else if (mode === "signup") {
        await signup({ ...household, email, password });
      } else {
        await finishSetup(household);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Household Financial Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "login"
            ? "Sign in to your household's dashboard."
            : mode === "setup"
              ? "You're signed in. Create your household or join your partner's to finish setting up."
              : "Create your household or join your partner's."}
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          {mode !== "login" && (
            <div>
              <label className="block text-sm font-medium text-slate-700">Full name</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
          )}
          {mode !== "setup" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Password</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
            </>
          )}

          {mode !== "login" && (
            <>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Household name <span className="text-slate-400">(leave blank if joining)</span>
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Invite code <span className="text-slate-400">(shown on your partner's dashboard)</span>
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                  />
                </div>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting ? "Please wait..." : mode === "login" ? "Sign in" : mode === "setup" ? "Finish setup" : "Create account"}
          </button>
        </form>

        {mode === "setup" ? (
          <button className="mt-4 text-sm font-medium text-brand-700 hover:underline" onClick={logout}>
            Sign out
          </button>
        ) : (
          <button
            className="mt-4 text-sm font-medium text-brand-700 hover:underline"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        )}
      </div>
    </div>
  );
}
