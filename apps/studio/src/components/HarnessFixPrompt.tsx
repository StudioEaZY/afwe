// apps/studio/src/components/HarnessFixPrompt.tsx
import React, { useState } from "react";
import { Terminal, Copy, Check, Sparkles, ExternalLink, ShieldAlert, X } from "lucide-react";

export interface HarnessFixProps {
  issueType: "constraint_violation" | "undeclared_edge" | "unmapped_code" | "failed_check" | "pin_conflict" | "ambiguity_question" | "drift_proposal";
  title: string;
  sourceNode?: string;
  targetNode?: string;
  ruleId?: string;
  offendingFiles?: string[];
  rationale?: string;
  suggestedAction?: string;
  cliCommand?: string;
  compact?: boolean;
}

export const HarnessFixButton: React.FC<HarnessFixProps> = (props) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  const generatePrompt = (): string => {
    const scopeNodes = [props.sourceNode, props.targetNode].filter(Boolean) as string[];
    const targetFlag = scopeNodes.length > 0 ? scopeNodes.map((n) => `--target ${n}`).join(" ") : "--target studio";
    const filesList = (props.offendingFiles && props.offendingFiles.length > 0)
      ? props.offendingFiles.map((f) => `  - ${f}`).join("\n")
      : "  - [In-scope files identified in briefing]";

    return `Resolve the following AFWE architectural issue in this workspace:
- Type: [${props.issueType}] ${props.title}
${props.ruleId ? `- Violated Invariant/Rule ID: \`${props.ruleId}\`` : ""}
${props.sourceNode && props.targetNode ? `- Dependency Boundary: ${props.sourceNode} -> ${props.targetNode}` : ""}
- Offending Paths:
${filesList}
${props.rationale ? `- Architectural Rationale: ${props.rationale}` : ""}

Follow the mandatory AFWE 3-Phase Turn Protocol:
1. Phase 0 (Pre-Plan Briefing): Run \`afwe turn begin "Fix ${props.title}" ${targetFlag}\`
2. Phase 1 (Declare Assumptions): Run \`afwe turn assume <turn_id> --file <assumptions.json>\` declaring structural intents and claims (e.g. forbid_import or export_exists).
3. Implementation: ${props.suggestedAction || "Repair the boundary violation without deleting pinned behaviors or unmounting existing capabilities."}
4. Phase 2 (Verify & Commit): Run \`afwe verify --changed <files>\` and \`afwe turn commit <turn_id> --summary "Resolve ${props.title}"\`.`;
  };

  const promptText = generatePrompt();
  const cliText = props.cliCommand || (props.sourceNode && props.targetNode
    ? `afwe bp relate ${props.sourceNode} ${props.targetNode} --kind depends_on`
    : `afwe verify`);

  const handleCopy = (text: string, tab: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    setTimeout(() => setCopiedTab(null), 2000);
  };

  if (props.compact) {
    return (
      <>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setModalOpen(true);
          }}
          style={{
            background: "var(--amberbg)",
            color: "var(--amber)",
            border: "1px solid var(--amber)",
            borderRadius: "4px",
            padding: "2px 6px",
            fontSize: "10.5px",
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
          title="Open Harness Remediation Prompt & CLI generator"
        >
          <Sparkles size={11} />
          <span>Fix in Harness</span>
        </button>
        {modalOpen && (
          <RemediationModal
            props={props}
            promptText={promptText}
            cliText={cliText}
            copiedTab={copiedTab}
            onCopy={handleCopy}
            onClose={() => setModalOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        style={{
          background: "var(--side)",
          border: "1px solid var(--line)",
          borderRadius: "6px",
          padding: "6px 12px",
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--ink)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <Sparkles size={13} style={{ color: "var(--amber)" }} />
        <span>Fix in Harness / Copy Agent Prompt</span>
      </button>

      {modalOpen && (
        <RemediationModal
          props={props}
          promptText={promptText}
          cliText={cliText}
          copiedTab={copiedTab}
          onCopy={handleCopy}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
};

interface ModalProps {
  props: HarnessFixProps;
  promptText: string;
  cliText: string;
  copiedTab: string | null;
  onCopy: (text: string, tab: string) => void;
  onClose: () => void;
}

const RemediationModal: React.FC<ModalProps> = ({ props, promptText, cliText, copiedTab, onCopy, onClose }) => {
  const [activeTab, setActiveTab] = useState<"agent" | "cli">("agent");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(2px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "12px",
          width: "680px",
          maxWidth: "95vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 40px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: "var(--bg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ background: "var(--amberbg)", padding: "6px", borderRadius: "6px", color: "var(--amber)" }}>
              <ShieldAlert size={18} />
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Harness Remediation Generator
              </div>
              <h3 style={{ margin: "2px 0 0 0", fontSize: "16px", fontWeight: 600, color: "var(--ink)" }}>
                {props.title}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--mute)", cursor: "pointer", padding: "4px" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--line)", background: "var(--side)", padding: "0 24px" }}>
          <button
            onClick={() => setActiveTab("agent")}
            style={{
              padding: "10px 16px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "agent" ? "2px solid var(--accent)" : "2px solid transparent",
              color: activeTab === "agent" ? "var(--ink)" : "var(--mute)",
              fontWeight: activeTab === "agent" ? 600 : 500,
              fontSize: "12.5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Sparkles size={13} style={{ color: activeTab === "agent" ? "var(--amber)" : "inherit" }} />
            <span>Agent Prompt (Claude Code / Cursor / AGY)</span>
          </button>
          <button
            onClick={() => setActiveTab("cli")}
            style={{
              padding: "10px 16px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "cli" ? "2px solid var(--accent)" : "2px solid transparent",
              color: activeTab === "cli" ? "var(--ink)" : "var(--mute)",
              fontWeight: activeTab === "cli" ? 600 : 500,
              fontSize: "12.5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Terminal size={13} />
            <span>Direct AFWE CLI Command</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ fontSize: "12px", color: "var(--mute)", lineHeight: "1.4" }}>
            {activeTab === "agent"
              ? "Copy this structured prompt into your AI coding assistant. It instructs the agent to run Phase 0 (turn begin), declare claims before touching code, and verify before commit."
              : "Execute this command directly in your terminal to remediate or verify the architectural configuration."}
          </div>

          <div style={{ position: "relative" }}>
            <pre
              style={{
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                padding: "14px 16px",
                fontSize: "11.5px",
                fontFamily: "'IBM Plex Mono', monospace",
                color: "var(--ink)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "260px",
                overflowY: "auto",
                margin: 0,
              }}
            >
              {activeTab === "agent" ? promptText : cliText}
            </pre>
            <button
              onClick={() => onCopy(activeTab === "agent" ? promptText : cliText, activeTab)}
              style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "11px",
                fontWeight: 600,
                color: copiedTab === activeTab ? "var(--accent)" : "var(--ink)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.06)",
              }}
            >
              {copiedTab === activeTab ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedTab === activeTab ? "Copied!" : "Copy"}</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid var(--line)", background: "var(--bg)", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            onClick={onClose}
            style={{
              background: "var(--side)",
              border: "1px solid var(--line)",
              padding: "6px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 500,
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            Close
          </button>
          <button
            onClick={() => onCopy(activeTab === "agent" ? promptText : cliText, activeTab)}
            style={{
              background: "var(--accent)",
              border: "none",
              padding: "6px 16px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--accent-ink)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {copiedTab === activeTab ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedTab === activeTab ? "Copied to Clipboard!" : "Copy to Clipboard"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
