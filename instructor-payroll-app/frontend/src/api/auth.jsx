import { createContext, useContext, useState, useCallback, useEffect } from "react";
import client from "./client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("payroll_user");
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (email, password) => {
    const form = new URLSearchParams();
    form.append("username", email);
    form.append("password", password);
    const res = await client.post("/auth/login", form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    localStorage.setItem("payroll_token", res.data.access_token);
    localStorage.setItem("payroll_user", JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data.user;
  }, []);

  // Refresh the stored user on load so access changes made in Settings
  // (instructors / costs access) apply without logging out and in again.
  useEffect(() => {
    if (!localStorage.getItem("payroll_token")) return;
    client
      .get("/auth/me")
      .then((res) => {
        localStorage.setItem("payroll_user", JSON.stringify(res.data));
        setUser(res.data);
      })
      .catch(() => {});
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("payroll_token");
    localStorage.removeItem("payroll_user");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
