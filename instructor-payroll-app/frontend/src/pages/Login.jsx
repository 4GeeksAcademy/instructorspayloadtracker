import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../api/auth.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-rigo">
          <img src="/brand/rigo.svg" alt="" />
        </div>
        <img className="brand-logo" src="/brand/logo-dark.svg" alt="4Geeks" />
        <p className="small-muted" style={{ marginBottom: 26 }}>
          Instructor Payroll — hours &amp; payment tracking
        </p>
        {error && <div className="banner">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@4geeksacademy.com"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="primary" style={{ width: "100%" }} disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="small-muted" style={{ marginTop: 18 }}>
          Demo users (seeded): programlead@4geeksacademy.com,
          admin@4geeksacademy.com, mricigliano@4geeksacademy.com — password
          for all: <code>password</code>
        </p>
      </div>
    </div>
  );
}
