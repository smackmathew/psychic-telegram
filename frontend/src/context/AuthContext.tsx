import { useQueryClient } from "@tanstack/react-query";
import { onAuthStateChanged } from "firebase/auth";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { auth } from "../firebase/app";
import { AuthApi, loadProfile, setUpHousehold } from "../firebase/household";
import type { User } from "../types";

interface SignupPayload {
  full_name: string;
  email: string;
  password: string;
  household_name?: string;
  invite_code?: string;
}

interface AuthContextValue {
  /** The signed-in user, once they belong to a household. */
  user: User | null;
  loading: boolean;
  /** Signed in, but hasn't created or joined a household yet (e.g. an account made in the Firebase console). */
  needsHousehold: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (payload: SignupPayload) => Promise<void>;
  finishSetup: (payload: { full_name: string; household_name?: string; invite_code?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [needsHousehold, setNeedsHousehold] = useState(false);
  const [loading, setLoading] = useState(true);
  // Signup creates the account before the household exists; don't let the auth listener
  // report "no household" in between.
  const settingUp = useRef(false);

  function applyProfile(profile: User | null) {
    setUser(profile);
    setNeedsHousehold(profile === null && auth.currentUser !== null);
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (settingUp.current) return;
      try {
        applyProfile(firebaseUser ? await loadProfile(firebaseUser) : null);
      } catch {
        applyProfile(null);
      } finally {
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    applyProfile(await AuthApi.login(email, password));
  }

  async function signup(payload: SignupPayload) {
    settingUp.current = true;
    try {
      applyProfile(await AuthApi.signup(payload));
    } catch (error) {
      // The account may exist even though the household step failed (e.g. a mistyped invite code).
      setNeedsHousehold(auth.currentUser !== null);
      throw error;
    } finally {
      settingUp.current = false;
    }
  }

  async function finishSetup(payload: { full_name: string; household_name?: string; invite_code?: string }) {
    applyProfile(await setUpHousehold(payload));
  }

  async function logout() {
    await AuthApi.logout();
    queryClient.clear();
    applyProfile(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, needsHousehold, login, signup, finishSetup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
