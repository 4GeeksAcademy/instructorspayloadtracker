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
  const [past, setPast] = useState([]);
  const [asking, setAsking] = useState(false);
  const [openPast, setOpenPast] = useState(null);

  const ask = () => {
    setAsking(true);
    setErr("");
    client
      .post(`/costs/entries/${entry.id}/insight`)
      .then((r) => {
        setData(r.data);
        return client.get("/costs/insights/history", { params: { entry_name: entry.name } });
      })
      .then((h) => setPast(h.data))
      .catch((e) => setErr(errText(e)))
      .finally(() => setAsking(false));
  };

  // Show the last advice for this line if there is one; only ask again on demand.
  useEffect(() => {
    setData(null);
    client.get("/costs/insights/history", { params: { entry_name: entry.name } }).then((h) => {
      setPast(h.data);
      if (h.data.length) {
        const last = h.data[0];
        setData({ source: last.source, items: last.items, at: last.at, user: last.user });
      } else ask();
    }).catch(() => ask());
  }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [hist, setHist] = useState([]);
  useEffect(() => {
    client.get(`/costs/entries/${entry.id}/history`).then((r) => setHist(r.data)).catch(() => setHist([]));
  }, [entry.id]);
  const fmt = (t) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
          {data?.at && <div className="small-muted" style={{ marginBottom: 8 }}>Saved advice from {fmt(data.at)}{data.user ? ` · asked by ${data.user}` : ""}</div>}
          <button className="secondary sm" style={{ marginBottom: 12 }} disabled={asking} onClick={ask}>{asking ? "Thinking…" : data ? "Ask again" : "Get advice"}</button>
          {err && <div className="banner">{err}</div>}
          {!data && !err && <div className="empty-state">{asking ? "Thinking…" : ""}</div>}
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
          {past.length > 1 && (
            <div className="drawer-block">
              <h4>Advice history ({past.length})</h4>
              <ul className="hist-list">
                {past.map((p) => (
                  <li key={p.id}>
                    <button className="linklike" onClick={() => setOpenPast(openPast === p.id ? null : p.id)}>
                      {fmt(p.at)} · {p.period} · {p.user} · {p.source === "ai" ? "AI" : "Rules"}
                    </button>
                    {openPast === p.id && (
                      <ol className="insight-list" style={{ marginTop: 8 }}>
                        {p.items.map((it, i) => <li key={i}><strong>{it.title}</strong><p>{it.detail}</p></li>)}
                      </ol>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data?.source === "rules" && (
            <p className="hint">AI advice turns on when an Anthropic API key is set on the server. These are rule-based checks.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
