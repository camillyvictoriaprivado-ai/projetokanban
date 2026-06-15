// src/useAuth.ts
import { useState, useEffect } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth, provider } from "./firebase";

export function useAuth() {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Escuta mudanças de sessão automaticamente (refresh da página mantém login)
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const login  = () => signInWithPopup(auth, provider);
  const logout = () => signOut(auth);

  return { user, loading, login, logout };
}
