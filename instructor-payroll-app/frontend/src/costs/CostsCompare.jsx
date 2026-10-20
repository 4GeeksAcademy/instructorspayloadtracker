import { useEffect, useMemo, useState } from "react";
import client from "../api/client";
import { DeltaBar, Sparkline } from "./charts.jsx";
import { money, signed, pct, SECTION_ORDER, shortMonth } from "./format";
import { useCosts, MonthPicker } from "./useCosts.jsx";

function TwoMonths({ periods, sectionLabel, defaultB }) {
  const withData = periods.filter((p) => p.entry_count > 0);
  const [b, setB] = useState(defaultB || withData[0]?.period_id);
  const [a, setA] = useState(() => {
    const i = withData.findIndex((p) => p.period_id === (defaultB || withData[0]?.period_id));
    return withData[i + 1]?.period_id || withData[0]?.period_id;
  });
  const [section, setSection] = useState("");
  const [basis, setBasis] = useState("usa");
  const [change, setChange] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!a || !b) return;
    client.get(`/costs/compare?a=${a}&b=${b}${section ? `&section=${section}` : ""}`).then((r) => setData(r.data));
  }, [a, b, section]);

  const secRows = useMemo(() => {
    if (!data) return [];
    return data.by_section
      .map((r) => ({ ...r, va: basis === "usa" ? r.a_usa : r.a, vb: basis === "usa" ? r.b_usa : r.b, d: basis === "usa" ? r.delta_usa : r.delta }))
      .filter((r) => r.va || r.vb)
      .sort((x, y) => SECTION_ORDER.indexOf(x.section) - SECTION_ORDER.indexOf(y.section));
  }, [data, basis]);
  const maxD = Math.max(...secRows.map((r) => Math.abs(r.d)), 1);
  const items = (data?.items || []).filter((i) => !change || i.change === change || (change === "changed" && i.change === "same" && Math.abs(i.delta) >= 1));
  const maxI = Math.max(...items.map((r) => Math.abs(r.delta)), 1);
  const ta = data?.a, tb = data?.b;
  const net = (t) => (t ? (basis === "usa" ? t.net_usa : t.gross) : 0);

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          <MonthPicker periods={withData} value={a} onChange={setA} label="From" />
          <MonthPicker periods={withData} value={b} onChange={setB} label="To" />
          <div className="field month-picker">
            <label>Category</label>
            <select value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">All categories</option>
              {SECTION_ORDER.filter((k) => k !== "instructors").map((k) => <option key={k} value={k}>{sectionLabel[k] || k}</option>)}
            </select>
          </div>
        </div>
        <div className="seg">
          <button className={basis === "usa" ? "on" : ""} onClick={() => setBasis("usa")}>Net USA</button>
          <button className={basis === "gross" ? "on" : ""} onClick={() => setBasis("gross")}>Gross</button>
        </div>
      </div>

      {ta && tb && (
        <div className="grid cols-3" style={{ marginBottom: 16 }}>
          <div className="stat-card tone-gray"><div className="stat-label">{ta.label}</div><div className="stat-value">{money(net(ta))}</div></div>
          <div className="stat-card tone-blue"><div className="stat-label">{tb.label}</div><div className="stat-value">{money(net(tb))}</div></div>
          <div className={`stat-card ${net(tb) > net(ta) ? "tone-red" : "tone-cream"}`}>
            <div className="stat-label">Change</div>
            <div className="stat-value">{signed(net(tb) - net(ta))}</div>
            <div className="stat-sub">{pct(net(ta), net(tb)) != null ? `${pct(net(ta), net(tb)).toFixed(1)}%` : ""}</div>
          </div>
        </div>
      )}

      {!section && (
        <div className="card">
          <h3>By category</h3>
          <table className="cmp-table">
            <thead>
              <tr><th>Category</th><th className="num">{ta && shortMonth(ta.label)}</th><th className="num">{tb && shortMonth(tb.label)}</th><th className="num">Δ</th><th style={{ width: "34%" }}>cheaper ◀ ▶ more expensive</th></tr>
            </thead>
            <tbody>
              {secRows.map((r) => (
                <tr key={r.section}>
                  <td>{sectionLabel[r.section] || r.label}</td>
                  <td className="num">{money(r.va)}</td>
                  <td className="num strong">{money(r.vb)}</td>
                  <td className={`num ${r.d > 0 ? "txt-up" : r.d < 0 ? "txt-down" : ""}`}>{signed(r.d)}</td>
                  <td><DeltaBar value={r.d} max={maxD} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Line by line</h3>
          <div className="seg">
            {[["", "All"], ["changed", "Changed"], ["new", "New"], ["gone", "Gone"]].map(([k, l]) => (
              <button key={k} className={change === k ? "on" : ""} onClick={() => setChange(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table className="cmp-table">
            <thead>
              <tr><th>Line</th><th>Category</th><th>Paga</th><th className="num">{ta && shortMonth(ta.label)}</th><th className="num">{tb && shortMonth(tb.label)}</th><th className="num">Δ</th><th style={{ width: "22%" }} /></tr>
            </thead>
            <tbody>
              {items.map((i, n) => (
                <tr key={n}>
                  <td>
                    {i.name} {i.change !== "same" && <span className={`tag ${i.change}`}>{i.change}</span>}
                  </td>
                  <td className="muted-cell">{sectionLabel[i.section] || i.section}</td>
                  <td className="muted-cell">{i.paid_by}</td>
                  <td className="num">{i.a ? money(i.a) : "—"}</td>
                  <td className="num strong">{i.b ? money(i.b) : "—"}</td>
                  <td className={`num ${i.delta > 0 ? "txt-up" : i.delta < 0 ? "txt-down" : ""}`}>{signed(i.delta)}</td>
                  <td><DeltaBar value={i.delta} max={maxI} /></td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={7}><div className="empty-state">Nothing here.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function History({ sectionLabel }) {
  const [data, setData] = useState(null);
  const [basis, setBasis] = useState("usa");
  useEffect(() => {
    client.get("/costs/summary").then((r) => setData(r.data));
  }, []);
  if (!data) return <div className="empty-state">Loading…</div>;
  const months = data.months.filter((m) => m.entry_count > 0);
  const key = basis === "usa" ? "by_section_usa" : "by_section";
  const today = new Date().toISOString().slice(0, 10);
  const isProj = (m) => m.start_date > today || (m.projection_count > 0 && m.projection_count >= m.entry_count / 2);
  const secs = SECTION_ORDER.filter((s) => months.some((m) => m[key][s]));
  const actuals = months.filter((m) => !isProj(m));

  return (
    <div className="card">
      <div className="card-head">
        <h3>History by category</h3>
        <div className="seg">
          <button className={basis === "usa" ? "on" : ""} onClick={() => setBasis("usa")}>Net USA</button>
          <button className={basis === "gross" ? "on" : ""} onClick={() => setBasis("gross")}>Gross</button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="cmp-table history">
          <thead>
            <tr>
              <th>Category</th>
              {months.map((m) => <th key={m.period_id} className={`num${isProj(m) ? " proj" : ""}`}>{shortMonth(m.label)}{isProj(m) ? "*" : ""}</th>)}
              <th className="num">Avg actual</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {secs.map((s) => {
              const vals = months.map((m) => m[key][s] || 0);
              const avs = actuals.map((m) => m[key][s] || 0);
              const avg = avs.length ? avs.reduce((x, y) => x + y, 0) / avs.length : 0;
              return (
                <tr key={s}>
                  <td>{sectionLabel[s] || s}</td>
                  {vals.map((v, i) => {
                    const hot = !isProj(months[i]) && avg > 0 && v > avg * 1.15;
                    return <td key={i} className={`num${isProj(months[i]) ? " proj" : ""}${hot ? " hot" : ""}`}>{v ? money(v) : "—"}</td>;
                  })}
                  <td className="num strong">{money(avg)}</td>
                  <td><Sparkline values={vals} width={90} height={26} /></td>
                </tr>
              );
            })}
            <tr className="total-row">
              <td>Total</td>
              {months.map((m) => <td key={m.period_id} className="num">{money(basis === "usa" ? m.net_usa : m.gross)}</td>)}
              <td className="num">{money(actuals.reduce((x, m) => x + (basis === "usa" ? m.net_usa : m.gross), 0) / (actuals.length || 1))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="hint">* projection (copied from the month before; edit it in Monthly costs). Red cells are more than 15% above the category's average.</p>
    </div>
  );
}

export default function CostsCompare() {
  const { periods, periodId, loading, error, sectionLabel } = useCosts();
  const [tab, setTab] = useState("two");
  if (loading) return <div className="empty-state">Loading…</div>;
  if (error) return <div className="banner">{error}</div>;
  return (
    <>
      <h1>Compare</h1>
      <p className="subhead">Month vs. month, and how each category moved over time — including projections vs. what really happened.</p>
      <div className="seg big" style={{ marginBottom: 18 }}>
        <button className={tab === "two" ? "on" : ""} onClick={() => setTab("two")}>Two months</button>
        <button className={tab === "hist" ? "on" : ""} onClick={() => setTab("hist")}>History by category</button>
      </div>
      {tab === "two" ? <TwoMonths periods={periods} sectionLabel={sectionLabel} defaultB={periodId} /> : <History sectionLabel={sectionLabel} />}
    </>
  );
}
