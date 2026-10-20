import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";
import StatCard from "../components/StatCard.jsx";
import { MonthColumns, SplitBar } from "./charts.jsx";
import { money, signed, pct, SECTION_ORDER, shortMonth } from "./format";
import { useCosts, MonthPicker, MonthBadge } from "./useCosts.jsx";

export default function CostsDashboard() {
  const { periods, period, previous, periodId, setPeriodId, loading, error, sectionLabel } = useCosts();
  const [adjust, setAdjust] = useState(null);
  const [loans, setLoans] = useState(null);
  const [view, setView] = useState("usa");

  useEffect(() => {
    if (!periodId) return;
    client.get(`/costs/adjust?period_id=${periodId}`).then((r) => setAdjust(r.data)).catch(() => setAdjust(null));
  }, [periodId]);
  useEffect(() => {
    client.get("/costs/loans/schedule?weeks=4").then((r) => setLoans(r.data)).catch(() => setLoans(null));
  }, []);

  if (loading) return <div className="empty-state">Loading…</div>;
  if (error) return <div className="banner">{error}</div>;
  if (!period) return <div className="empty-state">No months yet.</div>;

  const months = [...periods].filter((p) => p.entry_count > 0).reverse();
  const bySec = view === "usa" ? period.by_section_usa : period.by_section;
  const prevSec = previous ? (view === "usa" ? previous.by_section_usa : previous.by_section) : {};
  const rows = SECTION_ORDER.filter((k) => (bySec[k] || 0) !== 0 || (prevSec[k] || 0) !== 0).map((k) => ({
    key: k,
    label: sectionLabel[k] || k,
    value: bySec[k] || 0,
    prev: prevSec[k] || 0,
  }));
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const delta = previous ? period.net_usa - previous.net_usa : 0;
  const deltaPct = previous ? pct(previous.net_usa, period.net_usa) : null;
  const paidBy = Object.entries(period.by_paid_by || {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label: label === "4Geeks USA" ? "4Geeks USA" : `${label} pays`, value }));
  const attention = adjust ? adjust.increases.length + adjust.new_lines.length + adjust.usa_pays_for_others.length : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Costs <em>Hub</em></h1>
          <p className="subhead">
            Every monthly cost: team, contractors, marketing, tech, loans. Net = what 4Geeks USA actually pays,
            after Spain/LATAM pay their part.
          </p>
        </div>
        <div className="page-head-tools">
          <MonthPicker periods={periods} value={periodId} onChange={setPeriodId} />
          <MonthBadge period={period} />
        </div>
      </div>

      <div className="grid cols-4">
        <StatCard
          tone="blue"
          label={`Net USA · ${shortMonth(period.label)}`}
          value={money(period.net_usa)}
          sub={previous ? `${signed(delta)} vs ${previous.label}${deltaPct != null ? ` (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%)` : ""}` : "First month"}
        />
        <StatCard tone="gray" label="Gross (all who pay)" value={money(period.gross)}
                  sub={`${money(period.gross - period.net_usa)} paid by Spain / LATAM or reimbursed`} />
        <StatCard tone="amber" label="Loans & financing" value={money(period.by_section_usa.debt || 0)}
                  sub={loans ? `${money(loans.per_week_avg)} / week on average` : "Debt section"} />
        <StatCard
          tone={period.month_confirmed ? "cream" : "gray"}
          label="Confirmation"
          value={period.month_confirmed ? "Locked" : `${period.confirmed_count}/${period.entry_count}`}
          sub={period.month_confirmed ? "Confirmed by Marcelo — read only" : "lines confirmed by Marcelo"}
        />
      </div>

      <div className="grid dash-2">
        <div className="card">
          <div className="card-head">
            <h3>Month by month</h3>
            <span className="small-muted">Click a month to open it</span>
          </div>
          <MonthColumns months={months} onPick={setPeriodId} activeId={periodId} />
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Needs attention</h3>
            <Link to="/costs/adjust" className="small-link">Open Adjust →</Link>
          </div>
          {!adjust ? (
            <div className="empty-state">Loading…</div>
          ) : attention === 0 ? (
            <div className="empty-state">Nothing flagged vs. {adjust.previous?.label || "last month"}.</div>
          ) : (
            <ul className="attn-list">
              {adjust.increases.slice(0, 3).map((x) => (
                <li key={`i${x.id}`}>
                  <span className="attn-dot up" />
                  <div><strong>{x.name}</strong><div className="small-muted">{money(x.before)} → {money(x.now)}</div></div>
                  <span className="attn-val up">{signed(x.delta)}</span>
                </li>
              ))}
              {adjust.new_lines.slice(0, 3).map((x) => (
                <li key={`n${x.id}`}>
                  <span className="attn-dot new" />
                  <div><strong>{x.name}</strong><div className="small-muted">New this month</div></div>
                  <span className="attn-val">{money(x.amount)}</span>
                </li>
              ))}
              {adjust.usa_pays_for_others.length > 0 && (
                <li>
                  <span className="attn-dot warn" />
                  <div>
                    <strong>USA pays {adjust.usa_pays_for_others.length} Latam/Spain lines</strong>
                    <div className="small-muted">Could be charged back to the region</div>
                  </div>
                  <span className="attn-val">{money(adjust.usa_pays_for_others.reduce((s, x) => s + x.amount, 0))}</span>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      <div className="grid dash-2">
        <div className="card">
          <div className="card-head">
            <h3>By category</h3>
            <div className="seg">
              <button className={view === "usa" ? "on" : ""} onClick={() => setView("usa")}>Net USA</button>
              <button className={view === "gross" ? "on" : ""} onClick={() => setView("gross")}>Gross</button>
            </div>
          </div>
          {rows.map((r) => {
            const d = r.value - r.prev;
            return (
              <div className="bar-row cat-row" key={r.key}>
                <div className="bar-label" title={r.label}>{r.label}</div>
                <div className="bar-track">
                  <div className={`bar-fill${r.value < 0 ? " neg" : ""}`} style={{ width: `${Math.max((Math.abs(r.value) / max) * 100, r.value ? 2 : 0)}%` }} />
                </div>
                <div>
                  <div className="bar-value">{money(r.value)}</div>
                  {previous && Math.abs(d) >= 1 && (
                    <div className={`bar-sub ${d > 0 ? "txt-up" : "txt-down"}`}>{signed(d)}</div>
                  )}
                </div>
              </div>
            );
          })}
          <p className="hint">Instructors come from the Instructors section (approved hours). Reimbursements from Spain/LATAM show as negatives.</p>
        </div>
        <div className="card">
          <h3>Who pays this month</h3>
          <SplitBar parts={paidBy} />
          {loans && (
            <>
              <div className="card-head" style={{ marginTop: 26 }}>
                <h3>Loans — next 4 weeks</h3>
                <Link to="/costs/loans" className="small-link">Loans →</Link>
              </div>
              <div className="week-mini">
                {loans.weeks.map((w, i) => (
                  <div key={w}>
                    <div className="small-muted">Week of {new Date(w + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                    <strong>{money(loans.totals[i])}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
