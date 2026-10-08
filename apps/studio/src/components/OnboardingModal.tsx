import { useEffect, useState } from "react";
import { call } from "../api";
import { useStore } from "../store";
import { Modal } from "./Modal";

/** Set-up wizard: what was detected, which profile, and exactly what will be written. Nothing silent. */
export function OnboardingModal() {
  const { setOnboardOpen, setConfigured, notify, refresh } = useStore();
  const [d, setD] = useState<any>(null);
  const [profile, setProfile] = useState<"normie" | "engineer">("normie");
  const [gitInit, setGitInit] = useState(true);
  const [baseline, setBaseline] = useState(true);
  const [ci, setCi] = useState(true);
  const [agents, setAgents] = useState(true);
  const [testCmd, setTestCmd] = useState("");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call("onboard.detect", {})
      .then((v: any) => {
        setD(v);
        setTestCmd(v.test_command_suggestion || "");
        setGitInit(!v.git?.repo);
      })
      .catch((e) => notify(String(e?.message || e)));
  }, []);

  const later = () => {
    sessionStorage.setItem("afwe.onboard.later", "1");
    setOnboardOpen(false);
  };

  const apply = async () => {
    setBusy(true);
    try {
      const r: any = await call("onboard.apply", {
        profile,
        init_git: gitInit,
        baseline_commit: baseline,
        ci,
        agents_md: agents,
        test_command: testCmd.trim() || null,
      });
      setResult(r);
      setConfigured(true);
      await refresh();
    } catch (e: any) {
      notify(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Set up AFWE for this project" onClose={later} wide>
      {!d && <p className="muted">Looking at the project…</p>}
      {d && !result && (
        <div className="onb">
          <section>
            <div className="onb-h">What was found</div>
            <div className="onb-kv">
              <span>stacks</span>
              <b>{(d.stacks || []).map((s: any) => s.stack).join(", ") || "none detected"}</b>
              <span>git</span>
              <b>{d.git?.repo ? `repository${d.git?.head ? "" : " (no commits yet)"}` : "not a repository"}</b>
              <span>blueprint</span>
              <b>{d.blueprint_nodes} nodes</b>
              <span>CI gate / AGENTS.md</span>
              <b>
                {d.ci_present ? "present" : "absent"} / {d.agents_md ? "present" : "absent"}
              </b>
            </div>
          </section>

          <section>
            <div className="onb-h">Profile</div>
            <label className="onb-opt">
              <input type="radio" checked={profile === "normie"} onChange={() => setProfile("normie")} />
              <span>
                <b>Zero friction</b> — AFWE commits passing turns itself; anything doubtful waits as a proposal; checks are generated from
                confirmed claims.
              </span>
            </label>
            <label className="onb-opt">
              <input type="radio" checked={profile === "engineer"} onChange={() => setProfile("engineer")} />
              <span>
                <b>Engineer</b> — turns end ready and you commit with git (the trailer is already in the record); stricter pins. Same gate, same engine.
              </span>
            </label>
          </section>

          <section>
            <div className="onb-h">What will be written</div>
            <label className="onb-opt">
              <input type="checkbox" checked={gitInit} disabled={!!d.git?.repo} onChange={(e) => setGitInit(e.target.checked)} />
              <span>{d.git?.repo ? "git repository already exists" : "initialise a git repository (with a starter .gitignore)"}</span>
            </label>
            {!d.git?.repo && gitInit && (
              <label className="onb-opt indent">
                <input type="checkbox" checked={baseline} onChange={(e) => setBaseline(e.target.checked)} />
                <span>make a baseline commit of the current project first</span>
              </label>
            )}
            <label className="onb-opt">
              <input type="checkbox" checked={ci} onChange={(e) => setCi(e.target.checked)} />
              <span>
                CI gate <code>.github/workflows/afwe-gate.yml</code> (set the repository variable <code>AFWE_INSTALL_COMMAND</code>)
              </span>
            </label>
            <label className="onb-opt">
              <input type="checkbox" checked={agents} onChange={(e) => setAgents(e.target.checked)} />
              <span>
                the AFWE contract block in <code>AGENTS.md</code> (replaced in place on re-run)
              </span>
            </label>
            <label className="onb-opt">
              <span>project test command (runs on every turn that changes code; leave empty for none)</span>
              <input value={testCmd} onChange={(e) => setTestCmd(e.target.value)} placeholder="e.g. cargo test" />
            </label>
          </section>

          <div className="onb-actions">
            <button className="ghost" onClick={later}>
              Not now
            </button>
            <button disabled={busy} onClick={apply}>
              {busy ? "Setting up…" : "Set up"}
            </button>
          </div>
        </div>
      )}
      {result && (
        <div className="onb">
          <div className="onb-h">Done</div>
          <ul className="onb-list">
            {(result.actions || []).map((a: string, i: number) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <p className="muted">Next: start a turn with <code>afwe turn begin "…"</code>, or let your harness call the MCP tools.</p>
          <div className="onb-actions">
            <button onClick={() => setOnboardOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
