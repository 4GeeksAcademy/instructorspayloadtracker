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
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    client.get("/costs/summary").then((r) => setSummary(r.data)).catch(() => setSummary(null));
  }, [periods]);

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

      <CategoryShare period={period} previous={previous} summary={summary} view={view} setView={setView} sectionLabel={sectionLabel} />

      <div className="grid dash-even">
        <div className="card">
          <h3>Who pays this month</h3>
          <SplitBar parts={paidBy} />
        </div>
        <div className="card">
          {loans && (
            <>
              <div className="card-head">
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


// How much each category is this month and over the year so far, and its share of the total.
function CategoryShare({ period, previous, summary, view, setView, sectionLabel }) {
  const key = view === "usa" ? "by_section_usa" : "by_section";
  const totalKey = view === "usa" ? "net_usa" : "gross";
  const year = period.start_date.slice(0, 4);
  const months = (summary?.months || []).filter((m) => m.start_date.slice(0, 4) === year && m.start_date <= period.start_date);
  const monthTotal = period[totalKey] || 0;
  const yearTotal = months.reduce((s, m) => s + (m[totalKey] || 0), 0);
  const keys = [...new Set([...SECTION_ORDER, ...Object.keys(period[key] || {}), ...months.flatMap((m) => Object.keys(m[key] || {}))])];
  const rows = keys
    .map((k) => {
      const yr = months.reduce((s, m) => s + ((m[key] || {})[k] || 0), 0);
      return {
        key: k,
        label: sectionLabel[k] || k,
        month: (period[key] || {})[k] || 0,
        prev: previous ? (previous[key] || {})[k] || 0 : null,
        year: yr,
        avg: months.length ? yr / months.length : 0,
      };
    })
    .filter((r) => r.month || r.year)
    .sort((a, b) => b.month - a.month);
  const max = Math.max(...rows.map((r) => Math.abs(r.month)), 1);
  const share = (v, t) => (t ? `${((v / t) * 100).toFixed(1)}%` : "—");
  const first = months[0]?.label?.split(" ")[0]?.slice(0, 3);
  const last = period.label.split(" ")[0].slice(0, 3);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h3>Categories — month and year</h3>
          <div className="small-muted">
            How much each category is, and its share of the total. Year = {first && first !== last ? `${first}–${last}` : last} {year} ({months.length} month{months.length === 1 ? "" : "s"} with data).
          </div>
        </div>
        <div className="seg">
          <button className={view === "usa" ? "on" : ""} onClick={() => setView("usa")}>Net USA</button>
          <button className={view === "gross" ? "on" : ""} onClick={() => setView("gross")}>Gross</button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="cmp-table share-table">
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ width: "22%" }} />
              <th className="num">{period.label.split(" ")[0]}</th>
              <th className="num">% of month</th>
              {previous && <th className="num">vs {previous.label.split(" ")[0].slice(0, 3)}</th>}
              <th className="num">Year so far</th>
              <th className="num">% of year</th>
              <th className="num">Avg / month</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = r.prev == null ? 0 : r.month - r.prev;
              return (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td><div className="bar-track"><div className={`bar-fill${r.month < 0 ? " neg" : ""}`} style={{ width: `${Math.max((Math.abs(r.month) / max) * 100, r.month ? 2 : 0)}%` }} /></div></td>
                  <td className="num strong">{money(r.month)}</td>
                  <td className="num">{share(r.month, monthTotal)}</td>
                  {previous && <td className={`num ${d > 0.5 ? "txt-up" : d < -0.5 ? "txt-down" : "muted-cell"}`}>{Math.abs(d) < 0.5 ? "—" : signed(d)}</td>}
                  <td className="num">{money(r.year)}</td>
                  <td className="num">{share(r.year, yearTotal)}</td>
                  <td className="num muted-cell">{money(r.avg)}</td>
                </tr>
              );
            })}
            <tr className="total-row">
              <td>Total</td>
              <td />
              <td className="num">{money(monthTotal)}</td>
              <td className="num">100%</td>
              {previous && <td className="num">{signed(monthTotal - (previous[totalKey] || 0))}</td>}
              <td className="num">{money(yearTotal)}</td>
              <td className="num">100%</td>
              <td className="num">{money(months.length ? yearTotal / months.length : 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="hint">Instructors come from the Instructors section. Reimbursements from Spain/LATAM are negative, so they lower the total.</p>
    </div>
  );
}
