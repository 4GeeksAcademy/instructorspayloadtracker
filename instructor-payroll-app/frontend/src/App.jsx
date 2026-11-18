import { NavLink, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./api/auth.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import SubmitHours from "./pages/SubmitHours.jsx";
import ReviewQueue from "./pages/ReviewQueue.jsx";
import Overview from "./pages/Overview.jsx";
import Revenue from "./pages/Revenue.jsx";
import Payments from "./pages/Payments.jsx";
import Settings from "./pages/Settings.jsx";
import CostsDashboard from "./costs/CostsDashboard.jsx";
import CostsEntries from "./costs/CostsEntries.jsx";
import CostsCompare from "./costs/CostsCompare.jsx";
import CostsAdjust from "./costs/CostsAdjust.jsx";
import CostsLoans from "./costs/CostsLoans.jsx";
import { canCosts, canInstructors } from "./api/access.js";

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

function RequireInstructors({ children }) {
  const { user } = useAuth();
  if (!canInstructors(user)) return <Navigate to={canCosts(user) ? "/costs" : "/settings"} replace />;
  return children;
}

function RequireCosts({ children }) {
  const { user } = useAuth();
  if (!canCosts(user)) return <Navigate to="/" replace />;
  return children;
}

function SectionSwitch({ inCosts }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const both = canInstructors(user) && canCosts(user);
  if (!both) return <span className="brand-badge">{inCosts ? "Costs Hub" : "Payroll"}</span>;
  return (
    <div className="section-switch" role="tablist" aria-label="Section">
      <button className={!inCosts ? "on" : ""} onClick={() => navigate("/")}>Instructors</button>
      <button className={inCosts ? "on" : ""} onClick={() => navigate("/costs")}>Costs Hub</button>
    </div>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const inCosts = location.pathname.startsWith("/costs") || (location.pathname === "/settings" && !canInstructors(user));
  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src="/brand/logo-dark.png" alt="4Geeks" />
          <SectionSwitch inCosts={inCosts} />
        </div>
        {inCosts ? (
          <div className="nav">
            <NavLink to="/costs" end>Dashboard</NavLink>
            <NavLink to="/costs/entries">Monthly costs</NavLink>
            <NavLink to="/costs/loans">Loans</NavLink>
            <NavLink to="/costs/compare">Compare</NavLink>
            <NavLink to="/costs/adjust">Adjust</NavLink>
          </div>
        ) : canInstructors(user) ? (
        <div className="nav">
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/submit">{user.role === "program_lead" ? "My hours" : "Enter hours"}</NavLink>
          {(user.role === "admin" || user.role === "owner") && <NavLink to="/review">Approvals</NavLink>}
          {(user.role === "admin" || user.role === "owner") && <NavLink to="/payments">Payments</NavLink>}
          {(user.role === "admin" || user.role === "owner") && (
            <NavLink to="/revenue">{user.role === "owner" || user.view_all ? "Revenue" : "Students"}</NavLink>
          )}
        </div>
        ) : <div className="nav" />}
        <div className="user-chip">
          <span>
            {user.name} <span className="small-muted">({{ owner: "super admin", admin: "approvals & payments", program_lead: "program lead" }[user.role] || user.role})</span>
          </span>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : undefined)}>
            Settings
          </NavLink>
          <button onClick={logout}>Log out</button>
        </div>
      </div>
      <div className="container">
        <Routes>
          <Route path="/" element={<RequireInstructors><Overview /></RequireInstructors>} />
          <Route path="/dashboard" element={<RequireInstructors><Dashboard /></RequireInstructors>} />
          <Route path="/submit" element={<RequireInstructors><SubmitHours /></RequireInstructors>} />
          <Route path="/review" element={<RequireInstructors><RequireAdminOrOwner><ReviewQueue /></RequireAdminOrOwner></RequireInstructors>} />
          <Route path="/approve" element={<Navigate to="/review" replace />} />
          <Route path="/costs" element={<RequireCosts><CostsDashboard /></RequireCosts>} />
          <Route path="/costs/entries" element={<RequireCosts><CostsEntries /></RequireCosts>} />
          <Route path="/costs/loans" element={<RequireCosts><CostsLoans /></RequireCosts>} />
          <Route path="/costs/compare" element={<RequireCosts><CostsCompare /></RequireCosts>} />
          <Route path="/costs/adjust" element={<RequireCosts><CostsAdjust /></RequireCosts>} />
          <Route
            path="/payments"
            element={
              <RequireInstructors>
                <RequireAdminOrOwner>
                  <Payments />
                </RequireAdminOrOwner>
              </RequireInstructors>
            }
          />
          <Route
            path="/revenue"
            element={
              <RequireInstructors>
                <RequireAdminOrOwner>
                  <Revenue />
                </RequireAdminOrOwner>
              </RequireInstructors>
            }
          />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
      <div className="footer-note">4Geeks Costs Hub · Instructors &amp; company costs</div>
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
