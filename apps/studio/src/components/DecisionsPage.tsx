// apps/studio/src/components/DecisionsPage.tsx
import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { formatAttachment } from "../lib/hierarchy";

export const DecisionsPage: React.FC = () => {
  const { graph, notify, run } = useStore();
  const [questions, setQuestions] = useState<any[]>([]);
  const [guides, setGuides] = useState<any[]>([]);
  const [proposals, setProposals] = useState<any[]>([]);
  const [memories, setMemories] = useState<any[]>([]);
  const [selectedQuestion, setSelectedQuestion] = useState<any | null>(null);
  const [answerInput, setAnswerInput] = useState<string>("");
  const [makePin, setMakePin] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [qsRes, gsRes, psRes, msRes] = await Promise.all([
        api.calibration.questions(true),
        api.calibration.guides(true),
        api.proposals(),
        api.memory.list(),
      ]);
      const qs = Array.isArray(qsRes)
        ? qsRes
        : Array.isArray(qsRes?.questions)
        ? qsRes.questions
        : [];
      const gs = Array.isArray(gsRes)
        ? gsRes
        : Array.isArray(gsRes?.guides)
        ? gsRes.guides
        : [];
      const ps = Array.isArray(psRes)
        ? psRes
        : Array.isArray(psRes?.proposals)
        ? psRes.proposals
        : [];
      const ms = Array.isArray(msRes)
        ? msRes
        : Array.isArray(msRes?.memory)
        ? msRes.memory
        : [];
      setQuestions(qs);
      setGuides(gs);
      setProposals(ps);
      setMemories(ms);
      if (qs.length > 0) {
        setSelectedQuestion(qs[0]);
      }
    } catch (e: any) {
      notify(`Could not load decisions: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerQuestion = async () => {
    if (!selectedQuestion || !answerInput.trim()) return;
    await run(`Answering Question`, async () => {
      await api.calibration.answerQuestion(selectedQuestion.id, answerInput.trim(), makePin);
      notify(`Answered ambiguity question and ${makePin ? "created pin" : "saved decision"}`);
      setAnswerInput("");
      loadData();
    });
  };

  const handleConfirmGuide = async (id: string) => {
    await run(`Graduating Guide`, async () => {
      await api.calibration.confirmGuide(id);
      notify(`Graduated probing guide ${id} to standing check!`);
      loadData();
    });
  };

  const handleRejectGuide = async (id: string) => {
    await run(`Rejecting Guide`, async () => {
      await api.calibration.rejectGuide(id);
      notify(`Rejected probing guide ${id}`);
      loadData();
    });
  };

  const handleResolveProposal = async (id: string, action: "accept" | "revert" | "review") => {
    await run(`Resolving Proposal`, async () => {
      await api.proposal(id, action);
      notify(`Proposal ${action}ed`);
      loadData();
    });
  };

  return (
    <div className="decisions-page" style={{ height: "100%", width: "100%", overflowY: "auto", background: "#FAF8F3", padding: "24px 32px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "26px", fontWeight: 600, color: "#1D1C1A", margin: "0 0 4px 0" }}>
          Human Queue & Intent Decisions
        </h2>
        <div style={{ fontSize: "13px", color: "#6B675D", fontFamily: "'IBM Plex Sans', sans-serif" }}>
          Ambiguity questions (&lt;85%), evidence-based probing guides ready to graduate (85%–90%), staged proposals, and durable architectural memory.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "24px" }}>
        {/* Left Column: Ambiguity Questions & Probing Guides */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Ambiguity Questions Card */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "20px" }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "#C98A3C" }}>?</span> Ambiguity Questions ({questions.filter((q) => q.status === "open").length})
            </div>
            {questions.filter((q) => q.status === "open").length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878" }}>All ambiguity questions resolved. Confidence is high.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {questions
                  .filter((q) => q.status === "open")
                  .map((q) => (
                    <div
                      key={q.id}
                      onClick={() => setSelectedQuestion(q)}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        background: selectedQuestion?.id === q.id ? "#FAF3DB" : "#FAF8F3",
                        border: `1px solid ${selectedQuestion?.id === q.id ? "#87661A" : "#ECE7D9"}`,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#1D1C1A", fontSize: "13px" }}>{q.question}</div>
                      <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "3px" }}>
                        Scope: {formatAttachment(q.attaches)} · Blast score: {q.blast_score ?? 5}
                      </div>
                      {selectedQuestion?.id === q.id && (
                        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                          <input
                            type="text"
                            value={answerInput}
                            onChange={(e) => setAnswerInput(e.target.value)}
                            placeholder="Type human decision or clarification..."
                            style={{
                              padding: "8px 10px",
                              borderRadius: "5px",
                              border: "1px solid #DCD9D0",
                              fontSize: "12px",
                            }}
                          />
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <label style={{ fontSize: "11.5px", color: "#4A463E", display: "flex", alignItems: "center", gap: "6px" }}>
                              <input
                                type="checkbox"
                                checked={makePin}
                                onChange={(e) => setMakePin(e.target.checked)}
                              />
                              Lock answer as standing pin
                            </label>
                            <button
                              onClick={handleAnswerQuestion}
                              style={{
                                background: "#2E7A57",
                                color: "#FFFFFF",
                                border: "none",
                                padding: "6px 14px",
                                borderRadius: "5px",
                                fontSize: "11.5px",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Submit Answer
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Probing Guides Ready to Graduate */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "20px" }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>⚖</span> Probing Guides Ready to Graduate ({guides.filter((g) => g.status === "ready_to_graduate").length})
            </div>
            {guides.filter((g) => g.status === "ready_to_graduate").length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878" }}>No probing guides awaiting graduation confirmation.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {guides
                  .filter((g) => g.status === "ready_to_graduate")
                  .map((g) => (
                    <div
                      key={g.id}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        background: "#E8F3ED",
                        border: "1px solid #B8DCBF",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{g.title || g.claim?.text || g.id}</div>
                      <div style={{ fontSize: "11px", color: "#2E7A57", marginTop: "3px" }}>
                        Score: {Math.round(((g.score ?? g.confidence) || 0.88) * 100)}% · Scope: {formatAttachment(g.attaches)} · {g.probes?.length || 0} session probe(s)
                      </div>
                      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                        <button
                          onClick={() => handleConfirmGuide(g.id)}
                          style={{
                            background: "#2E7A57",
                            color: "#FFFFFF",
                            border: "none",
                            padding: "4px 12px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Confirm & Graduate to Blocking Check
                        </button>
                        <button
                          onClick={() => handleRejectGuide(g.id)}
                          style={{
                            background: "#FFFFFF",
                            border: "1px solid #DCD9D0",
                            padding: "4px 10px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            color: "#8E8878",
                            cursor: "pointer",
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Staged Proposals & Architectural Memory */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Staged Proposals */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "20px" }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", marginBottom: "12px" }}>
              Staged Proposals ({proposals.length})
            </div>
            {proposals.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#8E8878" }}>No proposals pending human resolution.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {proposals.map((p: any) => (
                  <div
                    key={p.id}
                    style={{
                      padding: "12px",
                      borderRadius: "8px",
                      background: "#FAF8F3",
                      border: "1px solid #ECE7D9",
                      fontSize: "12px",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{p.finding?.summary || p.title || p.id}</div>
                    <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "3px" }}>
                      Status: {p.status || "pending"} · Kind: {p.finding?.kind || p.kind || "drift"}
                    </div>
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      <button
                        onClick={() => handleResolveProposal(p.id, "accept")}
                        style={{
                          background: "#2E7A57",
                          color: "#FFFFFF",
                          border: "none",
                          padding: "4px 10px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleResolveProposal(p.id, "revert")}
                        style={{
                          background: "#FFFFFF",
                          border: "1px solid #DCD9D0",
                          padding: "4px 10px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          color: "#8E8878",
                          cursor: "pointer",
                        }}
                      >
                        Revert
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Durable Architectural Memory */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E0D5", borderRadius: "10px", padding: "20px" }}>
            <div style={{ fontWeight: 600, fontSize: "15px", color: "#1D1C1A", marginBottom: "12px" }}>
              Architectural Memory ({memories.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {memories.map((m: any) => (
                <div
                  key={m.id || m.title}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "6px",
                    background: "#FAF8F3",
                    border: "1px solid #ECE7D9",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{m.title || m.id}</div>
                  <div style={{ fontSize: "11px", color: "#6B675D", marginTop: "2px" }}>
                    Kind: {m.kind || "decision"} · Applies to: {(m.applies_to || []).join(", ") || "Global"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
