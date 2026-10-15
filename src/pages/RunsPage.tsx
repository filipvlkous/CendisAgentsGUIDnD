import { api } from "../api";
import { go } from "../App";
import { RunView } from "../components/RunView";
import { ErrorBox, fmtCost, fmtDuration, StatusBadge, useAsync } from "../components/ui";

export function RunsPage({ params }: { params: string[] }) {
  const [id] = params;
  const { data: runs, error, reload } = useAsync(() => api.runs(), [id]);

  if (id)
    return (
      <div className="page">
        <a href="#/runs" className="sub">
          ← Back to the chronicle
        </a>
        <div style={{ height: 10 }} />
        <RunView id={id} />
      </div>
    );

  const remove = async (rid: string) => {
    await api.deleteRun(rid);
    void reload();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Chronicle Tower</h1>
        <span className="sub">Every quest ever attempted (stored in data/runs)</span>
        <span className="spacer" />
        <button onClick={() => reload()}>Refresh</button>
      </div>
      <ErrorBox error={error} />
      {runs && !runs.length ? (
        <div className="empty">No tales yet. Send a hero on a quest from the town, the Quest Board or the Training Grounds.</div>
      ) : (
        <div className="panel" style={{ padding: 0, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Quest</th>
                <th>Status</th>
                <th>Briefing</th>
                <th>Stages</th>
                <th>Duration</th>
                <th>Gold</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs?.map((r) => (
                <tr key={r.id} className="click" onClick={() => go("runs", r.id)}>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>{r.workflowName}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="sub">{r.input.slice(0, 70)}</td>
                  <td>{r.stepCount}</td>
                  <td>{fmtDuration(r.startedAt, r.finishedAt)}</td>
                  <td>{fmtCost(r.costUsd)}</td>
                  <td>
                    {r.status !== "running" && (
                      <button
                        className="small ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(r.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
