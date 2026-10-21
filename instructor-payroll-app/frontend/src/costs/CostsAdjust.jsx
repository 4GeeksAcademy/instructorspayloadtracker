import { useEffect, useState } from "react";
import client from "../api/client";
import StatCard from "../components/StatCard.jsx";
import { money, signed } from "./format";
import { useCosts, MonthPicker, MonthBadge, errText } from "./useCosts.jsx";
import LineInsight from "./LineInsight.jsx";

function TargetCell({ line, canEdit, onSaved }) {
  const [v, setV] = useState(line.target_amount ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setV(line.target_amount ?? ""), [line.target_amount]);
  if (!canEdit) return <span>{line.target_amount != null ? money(line.target_amount) : "—"}</span>;
  const save = async () => {
    const val = v === "" ? null : Number(v);
    if (val === (line.target_amount ?? null)) return;
    setSaving(true);
    try {
      await client.patch(`/costs/entries/${line.id}`, { target_amount: val });
      onSaved();
    } finally {
      setSaving(false);
    }
  };
  return (
    <input className="cell-input num target-input" type="number" placeholder="target" value={v} disabled={saving}
           onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
  );
}

const fmtAt = (t) => (t ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default function CostsAdjust() {
  const { meta, periods, period, periodId, setPeriodId, loading, error, sectionLabel } = useCosts();
  const [data, setData] = useState(null);
  const [entries, setEntries] = useState([]);
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [insightFor, setInsightFor] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [past, setPast] = useState([]);
  const [openPast, setOpenPast] = useState(null);

  const load = () => {
    if (!periodId) return;
    client.get(`/costs/adjust?period_id=${periodId}`).then((r) => setData(r.data));
    client.get(`/costs/entries?period_id=${periodId}`).then((r) => setEntries(r.data));
  };
  const loadPast = (showLatest) =>
    periodId &&
    client.get(`/costs/insights/history?period_id=${periodId}`).then((r) => {
      setPast(r.data);
      if (showLatest && r.data.length) setAi({ ...r.data[0], saved: true });
    });
  useEffect(() => {
    setAi(null);
    load();
    loadPast(true);
  }, [periodId]); // eslint-disable-line react-hooks/exhaustive-deps

  const askAi = async () => {
    setAiBusy(true);
    setAiErr("");
    try {
      const r = await client.post(`/costs/insights?period_id=${periodId}`);
      setAi(r.data);
      loadPast(false);
    } catch (e) {
      setAiErr(errText(e));
    } finally {
      setAiBusy(false);
    }
  };

  if (loading || !meta) return <div className="empty-state">Loading…</div>;
  if (error) return <div className="banner">{error}</div>;

  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  const canEdit = meta.can_edit && (!period?.month_confirmed || meta.is_owner);
  const usaOthers = data?.usa_pays_for_others || [];
  const usaOthersTotal = usaOthers.reduce((s, x) => s + x.amount, 0);
  const incTotal = (data?.increases || []).reduce((s, x) => s + x.delta, 0);
  const editable = entries
    .filter((e) => e.paid_by === "4Geeks USA" && Number(e.amount) > 0 && !["instructors_ref", "reimbursement"].includes(e.section))
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>What to <em>adjust</em></h1>
          <p className="subhead">
            What went up, what's new, what USA pays for others — and a target per line to plan the cuts.
            {data?.previous && ` Compared with ${data.previous.label}.`}
          </p>
        </div>
        <div className="page-head-tools">
          <MonthPicker periods={periods} value={periodId} onChange={setPeriodId} />
          <MonthBadge period={period} />
        </div>
      </div>

      {data && (
        <div className="grid cols-4">
          <StatCard tone="red" label="Went up" value={signed(incTotal)} sub={`${data.increases.length} lines up ≥10% and ≥$200`} />
          <StatCard tone="amber" label="New lines" value={money(data.new_lines.reduce((s, x) => s + x.amount, 0))} sub={`${data.new_lines.length} not in ${data.previous?.label || "last month"}`} />
          <StatCard tone="gray" label="USA pays for Latam/Spain" value={money(usaOthersTotal)} sub={`${usaOthers.length} lines could be charged back`} />
          <StatCard tone="cream" label="Planned savings" value={money(data.planned_saving)} sub="from the targets you set below" />
        </div>
      )}

      <div className="card ai-card">
        <div className="card-head">
          <div>
            <h3>Advice for {period?.label}</h3>
            <div className="small-muted">How to fix, lower or improve this month's costs.{meta.ai_enabled ? "" : " (Rule-based until an AI key is set on the server.)"}</div>
          </div>
          <button className="primary" onClick={askAi} disabled={aiBusy}>{aiBusy ? "Thinking…" : ai ? "Ask again" : meta.ai_enabled ? "✨ Get AI advice" : "Get advice"}</button>
        </div>
        {aiErr && <div className="banner">{aiErr}</div>}
        {ai && (
          <ol className="insight-list">
            {ai.items.map((it, i) => (
              <li key={i}><strong>{it.title}</strong><p>{it.detail}</p></li>
            ))}
          </ol>
        )}
        {ai?.saved && <p className="hint">Saved advice from {fmtAt(ai.at)} · asked by {ai.user} · {ai.source === "ai" ? "AI" : "rule-based"}. "Ask again" gets a fresh one.</p>}
        {ai?.error && <p className="hint">{ai.error} — showing rule-based checks.</p>}
        {past.length > 0 && (
          <details className="past-advice">
            <summary>Advice history for {period?.label} ({past.length})</summary>
            <ul className="hist-list">
              {past.map((p) => (
                <li key={p.id}>
                  <button className="linklike" onClick={() => setOpenPast(openPast === p.id ? null : p.id)}>
                    {fmtAt(p.at)} · {p.user} · {p.source === "ai" ? "AI" : "Rules"} · {p.items.length} points
                  </button>
                  {openPast === p.id && (
                    <ol className="insight-list" style={{ marginTop: 8 }}>
                      {p.items.map((it, i) => <li key={i}><strong>{it.title}</strong><p>{it.detail}</p></li>)}
                    </ol>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {data && (
        <div className="grid dash-2">
          <div className="card">
            <h3>Went up vs. {data.previous?.label || "last month"}</h3>
            {data.increases.length === 0 ? <div className="empty-state">Nothing went up meaningfully.</div> : (
              <table className="cmp-table">
                <thead><tr><th>Line</th><th className="num">Before</th><th className="num">Now</th><th className="num">Δ</th><th /></tr></thead>
                <tbody>
                  {data.increases.map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}<div className="small-muted">{sectionLabel[x.section]}</div></td>
                      <td className="num">{money(x.before)}</td>
                      <td className="num strong">{money(x.now)}</td>
                      <td className="num txt-up">{signed(x.delta)}</td>
                      <td>{byId[x.id] && <button className="icon-btn" onClick={() => setInsightFor(byId[x.id])}>💡</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h3>New this month</h3>
            {data.new_lines.length === 0 ? <div className="empty-state">No new lines.</div> : (
              <table className="cmp-table">
                <tbody>
                  {data.new_lines.map((x) => (
                    <tr key={x.id}>
                      <td>{x.name}<div className="small-muted">{sectionLabel[x.section]}</div></td>
                      <td className="num strong">{money(x.amount)}</td>
                      <td>{byId[x.id] && <button className="icon-btn" onClick={() => setInsightFor(byId[x.id])}>💡</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {usaOthers.length > 0 && (
              <>
                <h3 style={{ marginTop: 22 }}>USA pays for Latam / Spain</h3>
                <table className="cmp-table">
                  <tbody>
                    {usaOthers.map((x) => (
                      <tr key={x.id}>
                        <td>{x.name}<div className="small-muted">{x.division} · {sectionLabel[x.section]}</div></td>
                        <td className="num strong">{money(x.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {data.gone_count > 0 && <p className="hint">{data.gone_count} lines from last month aren't in this month (see Compare → Gone).</p>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h3>Plan the cuts — set a target per line</h3>
            <div className="small-muted">Type the amount a line should cost. "Copy to next month" uses the target as next month's amount.</div>
          </div>
        </div>
        <div className="table-scroll">
          <table className="cmp-table">
            <thead><tr><th>Line</th><th>Category</th><th className="num">Now</th><th className="num">Target</th><th className="num">Saving</th><th /></tr></thead>
            <tbody>
              {(showAll ? editable : editable.slice(0, 20)).map((e) => {
                const sav = e.target_amount != null ? Number(e.amount) - Number(e.target_amount) : 0;
                return (
                  <tr key={e.id}>
                    <td>{e.name}<div className="small-muted">{e.department}</div></td>
                    <td className="muted-cell">{sectionLabel[e.section]}</td>
                    <td className="num strong">{money(e.amount)}</td>
                    <td className="num"><TargetCell line={e} canEdit={canEdit && (!e.confirmed || meta.is_owner)} onSaved={load} /></td>
                    <td className={`num ${sav > 0 ? "txt-down" : ""}`}>{sav ? signed(-sav) : ""}</td>
                    <td><button className="icon-btn" title="How to lower it" onClick={() => setInsightFor(e)}>💡</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable.length > 20 && (
          <button className="linklike" style={{ marginTop: 12 }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show the 20 biggest only" : `Show all ${editable.length} lines`}
          </button>
        )}
      </div>

      {insightFor && <LineInsight entry={insightFor} sectionLabel={sectionLabel} onClose={() => setInsightFor(null)} />}
    </>
  );
}
