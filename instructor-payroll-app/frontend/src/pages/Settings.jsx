import { useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../api/auth.jsx";

const ROLE_LABELS = {
  program_lead: "Program lead",
  admin: "Admin",
  owner: "Owner",
};

function ChangeOwnPassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    setSaving(true);
    try {
      await client.patch("/auth/me/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.response?.data?.detail || "Could not change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20, maxWidth: 420 }}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>New password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        {error && <div className="banner">{error}</div>}
        {success && (
          <div className="banner" style={{ background: "var(--green-soft)", color: "var(--green)" }}>
            Password updated.
          </div>
        )}
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}

function ResetRow({ user, onDone }) {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Must be at least 8 characters");
      return;
    }
    setSaving(true);
    try {
      await client.patch(`/users/${user.id}/password`, { new_password: newPassword });
      setDone(true);
      setNewPassword("");
      setOpen(false);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not set password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.email}</td>
      <td>{ROLE_LABELS[user.role] || user.role}</td>
      <td>{user.active ? "Active" : "Deactivated"}</td>
      <td>
        {open ? (
          <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ width: 150 }}
              minLength={8}
              autoFocus
              required
            />
            <button className="primary" style={{ padding: "6px 12px", fontSize: 12 }} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="secondary"
              style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button className="secondary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setOpen(true)}>
            {done ? "Reset again" : "Reset password"}
          </button>
        )}
        {error && (
          <div className="small-muted" style={{ color: "var(--red)", marginTop: 6 }}>
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}

function ManageUserPasswords() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    client.get("/users").then((res) => {
      setUsers(res.data);
      setLoading(false);
    });
  };

  useEffect(load, []);

  return (
    <>
      <div className="section-title">Reset a teammate's password</div>
      <div className="card">
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          As owner, you can set a new password directly for anyone locked out or who forgot theirs —
          no need to know their current one.
        </p>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <ResetRow key={u.id} user={u} onDone={load} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function Settings() {
  const { user } = useAuth();

  return (
    <>
      <h1>Settings</h1>
      <p className="subhead">Manage your account.</p>

      <div className="section-title">Change your password</div>
      <ChangeOwnPassword />

      {user.role === "owner" && <ManageUserPasswords />}
    </>
  );
}
