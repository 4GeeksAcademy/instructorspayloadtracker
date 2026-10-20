import { useEffect, useState } from "react";
import client from "../api/client";
import { Sparkline } from "./charts.jsx";
import { money } from "./format";
import { errText } from "./useCosts.jsx";

// Side drawer: history of one cost line + AI (or rule-based) advice on how to
// lower, fix or improve it.
export default function LineInsight({ entry, sectionLabel, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setData(null);
    client.post(`/costs/entries/${entry.id}/insight`).then((r) => setData(r.data)).catch((e) => setErr(errText(e)));
  }, [entry.id]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hist = data?.history || [];
  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-x" onClick={onClose} aria-label="Close">×</button>
        <div className="small-muted">{sectionLabel[entry.section] || entry.section} · {entry.division}</div>
        <h2>{entry.name}</h2>
        <div className="drawer-amount">{money(entry.amount, { cents: true })}<span className="small-muted"> / {entry.frequency || "month"} · paid by {entry.paid_by}</span></div>

        {hist.length > 1 && (
          <div className="drawer-block">
            <h4>History</h4>
            <Sparkline values={hist.map((h) => h.amount)} width={300} height={56} highlight={hist.findIndex((h) => h.current)} />
            <table className="mini-table">
              <tbody>
                {hist.map((h) => (
                  <tr key={h.month} className={h.current ? "strong" : ""}>
                    <td>{h.month}</td>
                    <td className="num">{money(h.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="drawer-block">
          <h4>
            How to lower or improve it{" "}
            {data && <span className={`pill ${data.source === "ai" ? "approved" : "draft"}`}>{data.source === "ai" ? "AI" : "Rules"}</span>}
          </h4>
          {err && <div className="banner">{err}</div>}
          {!data && !err && <div className="empty-state">Thinking…</div>}
          {data && (
            <ol className="insight-list">
              {data.items.map((it, i) => (
                <li key={i}>
                  <strong>{it.title}</strong>
                  <p>{it.detail}</p>
                </li>
              ))}
            </ol>
          )}
          {data?.source === "rules" && (
            <p className="hint">AI advice turns on when an Anthropic API key is set on the server. These are rule-based checks.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
