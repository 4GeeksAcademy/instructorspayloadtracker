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

const COSTS_LABELS = { none: "No access", viewer: "View only", editor: "Can edit" };

function AccessSummary({ u }) {
  if (u.role === "owner") return <span className="pill approved">Super admin — everything</span>;
  return (
    <div className="access-pills">
      <span className={`pill ${u.instructors_access || u.view_all ? "admin_reviewed" : "draft"}`}>
        Instructors: {u.instructors_access || u.view_all ? "yes" : "no"}
      </span>
      <span className={`pill ${u.costs_access === "editor" ? "approved" : u.costs_access === "viewer" || u.view_all ? "admin_reviewed" : "draft"}`}>
        Costs: {u.view_all && u.costs_access === "none" ? "view only" : COSTS_LABELS[u.costs_access] || "No access"}
      </span>
      {u.view_all && <span className="pill submitted">Sees everything</span>}
    </div>
  );
}

function UserForm({ initial, programs, onSave, onCancel, saving, isNew }) {
  const [d, setD] = useState(initial);
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const isOwnerRow = initial.role === "owner";
  return (
    <form
      className="user-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...d, program_id: d.program_id ? Number(d.program_id) : null });
      }}
    >
      <div className="form-grid four">
        <div className="field"><label>Name</label><input value={d.name} onChange={set("name")} required /></div>
        {isNew && <div className="field"><label>Email</label><input type="email" value={d.email} onChange={set("email")} required /></div>}
        {isNew && <div className="field"><label>Temporary password</label><input type="text" value={d.password} onChange={set("password")} minLength={8} required /></div>}
        <div className="field">
          <label>Role (Instructors section)</label>
          <select value={d.role} onChange={set("role")} disabled={isOwnerRow}>
            {isOwnerRow && <option value="owner">Owner</option>}
            <option value="admin">Admin (reviews hours)</option>
            <option value="program_lead">Program lead (submits hours)</option>
          </select>
        </div>
        {d.role === "program_lead" && (
          <div className="field">
            <label>Program</label>
            <select value={d.program_id || ""} onChange={set("program_id")}>
              <option value="">—</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        {!isOwnerRow && (
          <>
            <div className="field">
              <label>Costs Hub</label>
              <select value={d.costs_access} onChange={set("costs_access")}>
                <option value="none">No access</option>
                <option value="viewer">View only</option>
                <option value="editor">Can edit (until Marcelo confirms)</option>
              </select>
            </div>
            <label className="check-field"><input type="checkbox" checked={!!d.instructors_access} onChange={set("instructors_access")} /> Instructors section</label>
            <label className="check-field"><input type="checkbox" checked={!!d.view_all} onChange={set("view_all")} /> Sees everything (incl. Revenue), read only</label>
            {!isNew && <label className="check-field"><input type="checkbox" checked={d.active !== false} onChange={set("active")} /> Active (can log in)</label>}
          </>
        )}
      </div>
      <div className="actions">
        <button className="primary" disabled={saving}>{saving ? "Saving…" : isNew ? "Create user" : "Save"}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ResetPassword({ user }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [state, setState] = useState("");
  if (!open) return <button className="secondary sm" onClick={() => setOpen(true)}>{state === "done" ? "Reset again" : "Reset password"}</button>;
  return (
    <form
      style={{ display: "flex", gap: 6, alignItems: "center" }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await client.patch(`/users/${user.id}/password`, { new_password: pw });
          setState("done");
          setOpen(false);
          setPw("");
        } catch (err) {
          setState(err.response?.data?.detail || "Could not set password");
        }
      }}
    >
      <input type="password" className="cell-input" style={{ width: 140 }} placeholder="New password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required />
      <button className="primary sm">Save</button>
      <button type="button" className="secondary sm" onClick={() => setOpen(false)}>×</button>
      {state && state !== "done" && <span className="small-muted" style={{ color: "var(--red)" }}>{String(state)}</span>}
    </form>
  );
}

function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    client.get("/users").then((res) => {
      setUsers(res.data);
      setLoading(false);
    });
  };
  useEffect(() => {
    load();
    client.get("/programs").then((r) => setPrograms(r.data)).catch(() => {});
  }, []);

  const save = async (payload, id) => {
    setSaving(true);
    setError("");
    try {
      if (id) {
        const { name, role, program_id, instructors_access, costs_access, view_all, active } = payload;
        await client.patch(`/users/${id}`, role === "owner"
          ? { name }
          : { name, role, program_id, instructors_access, costs_access, view_all, active });
        setEditId(null);
      } else {
        await client.post("/users", payload);
        setCreating(false);
      }
      load();
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(Array.isArray(d) ? d.map((x) => x.msg).join("; ") : d || "Could not save user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Users &amp; access</span>
        {!creating && <button className="primary sm" onClick={() => { setCreating(true); setEditId(null); }}>+ New user</button>}
      </div>
      <div className="card">
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          Two sections: <strong>Instructors</strong> (hours &amp; payroll) and <strong>Costs Hub</strong> (team, contractors,
          marketing, tech, loans). Editors can change a month until you confirm it; then it's locked for them.
        </p>
        {error && <div className="banner">{error}</div>}
        {creating && (
          <div className="user-card editing-card">
            <UserForm
              isNew
              programs={programs}
              initial={{ name: "", email: "", password: "", role: "admin", program_id: null, instructors_access: true, costs_access: "none", view_all: false }}
              onSave={(p) => save(p)}
              onCancel={() => setCreating(false)}
              saving={saving}
            />
          </div>
        )}
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Access</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) =>
                editId === u.id ? (
                  <tr key={u.id} className="row-editing">
                    <td colSpan={5}>
                      <UserForm initial={u} programs={programs} onSave={(p) => save(p, u.id)} onCancel={() => setEditId(null)} saving={saving} />
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id} className={u.active ? "" : "row-muted"}>
                    <td><strong>{u.name}</strong><div className="small-muted">{ROLE_LABELS[u.role] || u.role}</div></td>
                    <td>{u.email}</td>
                    <td><AccessSummary u={u} /></td>
                    <td>{u.active ? "Active" : "Deactivated"}</td>
                    <td className="row-actions">
                      <button className="secondary sm" onClick={() => { setEditId(u.id); setCreating(false); }}>Edit access</button>
                      <ResetPassword user={u} />
                    </td>
                  </tr>
                )
              )}
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
      <p className="subhead">{user.role === "owner" ? "Your account, plus who can see the Instructors section and the Costs Hub." : "Manage your account."}</p>

      <div className="section-title">Change your password</div>
      <ChangeOwnPassword />

      {user.role === "owner" && <ManageUsers />}
    </>
  );
}
