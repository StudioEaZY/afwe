// apps/studio/src/components/BlueprintPage.tsx
import React, { useState } from "react";
import { FolderGit2, Plus, Edit2, Layers } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { EditNodeModal, MappingModal, ConstraintModal } from "./BlueprintModals";
import { HarnessFixButton } from "./HarnessFixPrompt";

export const BlueprintPage: React.FC = () => {
  const { graph, notify, run, jumpToNodeOnMap, openCodePreview } = useStore();
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [editingNode, setEditingNode] = useState<any | null>(null);
  const [mappingNode, setMappingNode] = useState<any | null>(null);
  const [constrainingNode, setConstrainingNode] = useState<any | null>(null);

  const nodes = graph?.nodes || [];
  const constraints = graph?.constraints || [];
  const unmapped = graph?.unmapped || [];

  const filteredNodes = nodes.filter(
    (n) =>
      n.id.toLowerCase().includes(search.toLowerCase()) ||
      (n.name && n.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div
      className="blueprint-page"
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#FAF8F4",
        color: "#1D1C1A",
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ padding: "20px 28px 14px 28px", borderBottom: "1px solid #ECE7D9", background: "#FFFFFF" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <h2 style={{ fontFamily: "Newsreader, serif", fontSize: "28px", fontWeight: 600, margin: 0, color: "#1D1C1A" }}>
              Architectural Blueprint
            </h2>
            <div style={{ fontSize: "13px", color: "#6E685F", marginTop: "3px" }}>
              Hierarchical domain models, assigned source globs, relations, and unmapped codebase parcels.
            </div>
          </div>
          <button
            onClick={() => notify("New blueprint node draft ready in editor")}
            style={{
              background: "#1D1C1A",
              color: "#FFFFFF",
              border: "none",
              padding: "7px 16px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Add Domain Node
          </button>
        </div>
      </div>

      {/* Main Split: Nodes & Unmapped (Left) + Detail & Relations Inspector (Right) */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left List Pane */}
        <div style={{ width: "420px", borderRight: "1px solid #ECE7D9", background: "#FFFFFF", display: "flex", flexDirection: "column" }}>
          {/* Search bar */}
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #ECE7D9", background: "#FAF8F4" }}>
            <input
              type="text"
              placeholder="Filter blueprint nodes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #DCD9D0",
                fontSize: "12px",
                background: "#FFFFFF",
                outline: "none",
              }}
            />
          </div>

          {/* Unmapped code parcels alert strip if any */}
          {unmapped.length > 0 && (
            <div style={{ padding: "12px 16px", background: "#FAF5E9", borderBottom: "1px solid #EEDEA8" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 600, fontSize: "12px", color: "#87661A", display: "flex", alignItems: "center", gap: "6px" }}>
                  <FolderGit2 size={14} />
                  <span>{unmapped.length} Unmapped Code Parcel(s)</span>
                </div>
                <HarnessFixButton
                  compact
                  issueType="unmapped_code"
                  title={`${unmapped.length} unmapped code parcel(s)`}
                  offendingFiles={unmapped}
                  suggestedAction="Anchor discovered unmapped directories to blueprint nodes using 'afwe bp map <node> <files>'."
                  cliCommand={`afwe bp map ${nodes[0]?.id || "app"} ${unmapped.slice(0, 3).join(" ")}`}
                />
              </div>
              <div style={{ fontSize: "11px", color: "#6A4E11", marginTop: "4px" }}>
                Folders discovered by static analysis not yet anchored to blueprint.
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                {unmapped.slice(0, 4).map((f: string, idx: number) => (
                  <span
                    key={idx}
                    onClick={() => {
                      setSelectedNode(nodes[0] || null);
                      setMappingNode(nodes[0] || null);
                    }}
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #E0CCA0",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "10px",
                      fontFamily: "'IBM Plex Mono', monospace",
                      cursor: "pointer",
                      color: "#6A4E11",
                    }}
                  >
                    + Map {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Node items */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {filteredNodes.map((n) => {
                const isSelected = (selectedNode?.id || nodes[0]?.id) === n.id;
                return (
                  <div
                    key={n.id}
                    onClick={() => setSelectedNode(n)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "6px",
                      background: isSelected ? "#F4EFE6" : "#FAF8F4",
                      border: `1px solid ${isSelected ? "#1D1C1A" : "#ECE7D9"}`,
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "12.5px", color: "#1D1C1A" }}>{n.name || n.id}</div>
                      <div style={{ fontSize: "11px", color: "#6E685F", marginTop: "2px", fontFamily: "'IBM Plex Mono', monospace" }}>
                        {n.id} {n.parent && `· in ${n.parent}`}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        jumpToNodeOnMap(n.id);
                      }}
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #DCD9D0",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "10.5px",
                        color: "#1D1C1A",
                        cursor: "pointer",
                      }}
                    >
                      View Map ↗
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Detail & Constraints Inspector */}
        <div style={{ flex: 1, padding: "24px 32px", overflowY: "auto", background: "#FAF8F4" }}>
          {selectedNode || nodes[0] ? (
            (() => {
              const node = selectedNode || nodes[0];
              const relevantConstraints = constraints.filter(
                (c: any) => c.from === node.id || (Array.isArray(c.to) ? c.to.includes(node.id) : c.to === node.id)
              );

              return (
                <div style={{ maxWidth: "700px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#8E8878", textTransform: "uppercase" }}>
                        Domain Node Specification
                      </div>
                      <h3 style={{ fontFamily: "Newsreader, serif", fontSize: "24px", fontWeight: 600, margin: "4px 0 0 0", color: "#1D1C1A" }}>
                        {(node as any).name || (node as any).label || node.id}
                      </h3>
                      <div style={{ fontSize: "12px", color: "#6E685F", marginTop: "2px", fontFamily: "'IBM Plex Mono', monospace" }}>
                        ID: {node.id}
                      </div>
                    </div>
                    <button
                      onClick={() => jumpToNodeOnMap(node.id)}
                      style={{
                        background: "#2E7A57",
                        color: "#FFFFFF",
                        border: "none",
                        padding: "6px 14px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Inspect on Map ↗
                    </button>
                  </div>

                  {/* Summary & Intent Box */}
                  <div style={{ background: "#FFFFFF", border: "1px solid #ECE7D9", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#6E685F", textTransform: "uppercase", marginBottom: "6px" }}>
                      Description & Intent
                    </div>
                    <div style={{ fontSize: "13px", color: "#1D1C1A", lineHeight: "1.4" }}>
                      {node.description || "Core architectural domain anchored in .afwe/blueprint.yaml."}
                    </div>
                  </div>

                  {/* File Globs & Sources */}
                  <div style={{ background: "#FFFFFF", border: "1px solid #ECE7D9", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#6E685F", textTransform: "uppercase", marginBottom: "8px" }}>
                      Associated Files & Globs
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {(node.files && node.files.length > 0 ? node.files : [`src/${node.id}/**`]).map((f: string, idx: number) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", background: "#FAF8F4", padding: "6px 10px", borderRadius: "4px" }}>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{f}</span>
                          <button
                            onClick={() => openCodePreview({ filePath: f, title: f })}
                            style={{ background: "none", border: "none", color: "#2E7A57", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}
                          >
                            Browse →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Boundary Constraints */}
                  <div style={{ background: "#FFFFFF", border: "1px solid #ECE7D9", borderRadius: "8px", padding: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#6E685F", textTransform: "uppercase" }}>
                        Active Boundary Constraints ({relevantConstraints.length})
                      </div>
                      <button
                        onClick={() => setConstrainingNode(node)}
                        style={{ background: "none", border: "1px solid #DCD9D0", padding: "2px 8px", borderRadius: "4px", fontSize: "10.5px", cursor: "pointer" }}
                      >
                        + Add Rule
                      </button>
                    </div>

                    {relevantConstraints.length === 0 ? (
                      <div style={{ fontSize: "12px", color: "#8E8878" }}>No specific boundary constraints applied to this domain yet.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {relevantConstraints.map((c: any) => (
                          <div key={c.id} style={{ padding: "8px 10px", borderRadius: "4px", background: "#FAF8F4", border: "1px solid #ECE7D9", fontSize: "11.5px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ fontWeight: 600, color: "#1D1C1A" }}>{c.id}</div>
                              <HarnessFixButton
                                compact
                                issueType="constraint_violation"
                                title={`Rule ${c.id}: ${c.from} ${c.rule} ${Array.isArray(c.to) ? c.to.join(", ") : c.to}`}
                                sourceNode={c.from}
                                targetNode={Array.isArray(c.to) ? c.to[0] : c.to}
                                ruleId={c.id}
                                rationale={c.rationale}
                              />
                            </div>
                            <div style={{ color: "#6E685F", marginTop: "2px" }}>
                              {c.from} <span style={{ color: "#C94A38", fontWeight: 600 }}>{c.rule || c.kind}</span> {Array.isArray(c.to) ? c.to.join(", ") : c.to}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <div style={{ color: "#8E8878", fontSize: "13px" }}>Select a node on the left to inspect.</div>
          )}
        </div>
      </div>

      {editingNode && (
        <EditNodeModal
          node={editingNode}
          onClose={() => setEditingNode(null)}
          onSave={async (patch) => {
            await run("Updating node", async () => {
              await api.bp.update(editingNode.id, patch);
              notify(`Updated node ${editingNode.name || editingNode.id}`);
            });
            setEditingNode(null);
          }}
        />
      )}

      {mappingNode && (
        <MappingModal
          node={mappingNode}
          onClose={() => setMappingNode(null)}
          onSave={async (files, symbols) => {
            await run("Updating mapping", async () => {
              await api.bp.update(mappingNode.id, { files, symbols });
              notify(`Updated mapping for ${mappingNode.name || mappingNode.id}`);
            });
            setMappingNode(null);
          }}
        />
      )}

      {constrainingNode && (
        <ConstraintModal
          from={constrainingNode.id}
          onClose={() => setConstrainingNode(null)}
        />
      )}
    </div>
  );
};
