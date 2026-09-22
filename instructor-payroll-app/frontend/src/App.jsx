import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./api/auth.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import SubmitHours from "./pages/SubmitHours.jsx";
import ReviewQueue from "./pages/ReviewQueue.jsx";
import ApprovalQueue from "./pages/ApprovalQueue.jsx";
import Revenue from "./pages/Revenue.jsx";
import Settings from "./pages/Settings.jsx";

function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RequireOwner({ children }) {
  const { user } = useAuth();
  if (user.role !== "owner") return <Navigate to="/" replace />;
  return children;
}

function RequireAdminOrOwner({ children }) {
  const { user } = useAuth();
  if (user.role !== "owner" && user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

function Shell() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src="/brand/logo-dark.png" alt="4Geeks" />
          <span className="brand-badge">Payroll</span>
        </div>
        <div className="nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/submit">Submit Hours</NavLink>
          {(user.role === "admin" || user.role === "owner") && (
            <NavLink to="/review">Admin Review</NavLink>
          )}
          {user.role === "owner" && <NavLink to="/approve">Final Approval</NavLink>}
          {(user.role === "admin" || user.role === "owner") && (
            <NavLink to="/revenue">{user.role === "owner" ? "Revenue" : "Students"}</NavLink>
          )}
        </div>
        <div className="user-chip">
          <span>
            {user.name} <span className="small-muted">({user.role.replace("_", " ")})</span>
          </span>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : undefined)}>
            Settings
          </NavLink>
          <button onClick={logout}>Log out</button>
        </div>
      </div>
      <div className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/submit" element={<SubmitHours />} />
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/approve" element={<ApprovalQueue />} />
          <Route
            path="/revenue"
            element={
              <RequireAdminOrOwner>
                <Revenue />
              </RequireAdminOrOwner>
            }
          />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
      <div className="footer-note">4Geeks Instructor Payroll</div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
