import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Realtime } from "ably";
import {
  LayoutGrid, Users, BarChart3, Settings, Search, Filter, ChevronDown,
  Menu, CheckCircle, X, Plus, Trash2, ChevronRight, Calendar, User,
  Tag, FileText, ClipboardList, MessageSquare, Circle, CheckCircle2,
  RefreshCw, AlertCircle, Zap
} from "lucide-react";

const API_URL = "https://script.google.com/macros/s/AKfycbwrNNlyRWYq5zayRYSlRfRSC_bFY7tjc4DXxL6TF3YSnHwMOw_h7HY2wF6qFW3MSQsXBQ/exec";

// ─── CONFIGURAÇÃO DO ABLY ───
const ABLY_API_KEY = "BUp6Lg.QfvVuw:DBQaijX7rEyBdz4A1dXnrDXE68wWcCWkQTUG_BLSk9E"; 
const ABLY_CHANNEL_NAME = "kanban-live";

// IMPORTANTE: Mudamos o sufixo das chaves para limpar o lixo do LocalStorage antigo que travava os cards juntos
const LS_ANNOTATIONS_KEY = "tlp_kanban_annotations_v2"; 
const LS_COLUMNS_KEY     = "tlp_kanban_columns_v2";     
const LS_PENDING_KEY     = "tlp_kanban_pending_v2";     
const LS_DELETED_KEY     = "tlp_kanban_deleted_v2";     
const PENDING_TTL_MS = 3 * 60 * 1000; 

const COLLABORATORS = [
  { name: "Camilly Silva",  initials: "CS", color: "#4f46e5" },
  { name: "Nicolas Oliveira",   initials: "NO", color: "#f97316" },
  { name: "Keizi Praxedes", initials: "KP", color: "#7c3aed" },
  { name: "Ana Cláudia",initials: "AC", color: "#059669" },
  { name: "Jane Gomes", initials: "JG", color: "#db2777" },
];

type Priority = "alta" | "média" | "baixa";
type StepStatus = "pendente" | "em andamento" | "concluído";
type SubtaskStatus = "pendente" | "em andamento" | "concluído";

interface ChecklistItem { id: string; label: string; done: boolean; }
interface Subtask { id: string; title: string; assignee: string; status: SubtaskStatus; }
interface Annotation { id: string; text: string; createdAt: string; }
interface Step { id: string; label: string; status: StepStatus; }

interface KanbanTask {
  id: string; title: string; ionix: string; cluster: string; uf: string;
  material: string; quantidade: string; description: string; assignee: string; 
  assigneeInitials: string; assigneeColor: string; priority: Priority; dueDate: string; 
  steps: Step[]; tags: string[]; checklist: ChecklistItem[]; subtasks: Subtask[]; 
  annotations: Annotation[]; previousColumnId?: string;
}

interface Column { id: string; title: string; color: string; accent: string; tasks: KanbanTask[]; }

function getPersistKey(task: KanbanTask): string {
  return `task:${task.id}`;
}

function getCollabMeta(name: string) {
  const found = COLLABORATORS.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const parts = name.trim().split(" ");
  const initials = parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0]?.substring(0, 2).toUpperCase() ?? "??";
  return { name, initials, color: "#6b7a99" };
}

function priorityBadge(p: Priority) {
  const map: Record<Priority, { label: string; bg: string; text: string; dot: string }> = {
    alta:  { label: "Alta",  bg: "#fff1f2", text: "#e11d48", dot: "#f43f5e" },
    média: { label: "Média", bg: "#fffbeb", text: "#d97706", dot: "#fbbf24" },
    baixa: { label: "Baixa", bg: "#f0fdf4", text: "#16a34a", dot: "#22c55e" },
  };
  return map[p] ?? map["média"];
}

function stepStatusColor(s: StepStatus) {
  if (s === "concluído")   return "#10b981";
  if (s === "em andamento") return "#f97316";
  return "#d1d5db";
}

function Toast({ message, type, onDismiss }: { message: string; type: "success" | "error" | "loading"; onDismiss: () => void }) {
  useEffect(() => {
    if (type !== "loading") {
      const t = setTimeout(onDismiss, 3500);
      return () => clearTimeout(t);
    }
  }, [type, onDismiss]);

  const colors = {
    success: { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", icon: <CheckCircle size={16} className="text-emerald-500 shrink-0" /> },
    error:   { bg: "#fff1f2", border: "#fecdd3", text: "#9f1239", icon: <AlertCircle size={16} className="text-rose-500 shrink-0" /> },
    loading: { bg: "#f8fafc", border: "#e2e8f0", text: "#1e293b", icon: <RefreshCw size={16} className="text-blue-500 shrink-0 animate-spin" /> },
  };
  const c = colors[type];
  return (
    <div
      className="fixed bottom-6 right-6 z-[100] flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl text-sm font-medium border"
      style={{ background: c.bg, borderColor: c.border, color: c.text, minWidth: 240 }}
    >
      {c.icon}
      <span className="flex-1">{message}</span>
      {type !== "loading" && (
        <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100"><X size={13} /></button>
      )}
    </div>
  );
}

function TaskDetailModal({
  task, columnId, onClose, onUpdate, onComplete, onRemove, onReturn,
}: {
  task: KanbanTask; columnId: string; onClose: () => void;
  onUpdate: (u: KanbanTask) => void;
  onComplete: (colId: string, taskId: string) => void;
  onRemove: (colId: string, taskId: string) => void;
  onReturn: (colId: string, taskId: string) => void;
}) {
  const [local, setLocal] = useState<KanbanTask>({ ...task });
  const [activeTab, setActiveTab] = useState<"info" | "checklist" | "subtasks" | "notes">("info");
  const [newCheckItem, setNewCheckItem] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newSubtask, setNewSubtask] = useState({ title: "", assignee: "", status: "pendente" as SubtaskStatus });
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);

  const save = (updated: KanbanTask) => {
    setLocal(updated);
    onUpdate(updated);
    try {
      const stored = JSON.parse(localStorage.getItem(LS_ANNOTATIONS_KEY) || "{}");
      stored[getPersistKey(updated)] = updated.annotations;
      localStorage.setItem(LS_ANNOTATIONS_KEY, JSON.stringify(stored));
    } catch {}
  };

  const addCheckItem = () => {
    if (!newCheckItem.trim()) return;
    save({ ...local, checklist: [...local.checklist, { id: `chk-${Date.now()}`, label: newCheckItem.trim(), done: false }] });
    setNewCheckItem("");
  };
  const toggleCheck = (id: string) => save({ ...local, checklist: local.checklist.map(c => c.id === id ? { ...c, done: !c.done } : c) });
  const removeCheck = (id: string) => save({ ...local, checklist: local.checklist.filter(c => c.id !== id) });

  const addSubtask = () => {
    if (!newSubtask.title.trim()) return;
    save({ ...local, subtasks: [...local.subtasks, { id: `sub-${Date.now()}`, ...newSubtask }] });
    setNewSubtask({ title: "", assignee: "", status: "pendente" });
    setShowSubtaskForm(false);
  };
  const updateSubtask = (id: string, patch: Partial<Subtask>) => save({ ...local, subtasks: local.subtasks.map(s => s.id === id ? { ...s, ...patch } : s) });
  const removeSubtask = (id: string) => save({ ...local, subtasks: local.subtasks.filter(s => s.id !== id) });

  const addNote = () => {
    if (!newNote.trim()) return;
    save({ ...local, annotations: [...local.annotations, { id: `ann-${Date.now()}`, text: newNote.trim(), createdAt: new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) }] });
    setNewNote("");
  };
  const removeNote = (id: string) => save({ ...local, annotations: local.annotations.filter(a => a.id !== id) });

  const cycleStep = (stepId: string) => {
    const order: StepStatus[] = ["pendente", "em andamento", "concluído"];
    save({ ...local, steps: local.steps.map(s => s.id !== stepId ? s : { ...s, status: order[(order.indexOf(s.status) + 1) % order.length] }) });
  };

  const prio = priorityBadge(local.priority);
  const doneChecks = local.checklist.filter(c => c.done).length;
  const tabs = [
    { id: "info" as const,      label: "Detalhes",  icon: <FileText size={13} /> },
    { id: "checklist" as const, label: `Checklist${local.checklist.length ? ` ${doneChecks}/${local.checklist.length}` : ""}`, icon: <ClipboardList size={13} /> },
    { id: "subtasks" as const,  label: `Subtarefas${local.subtasks.length ? ` (${local.subtasks.length})` : ""}`, icon: <CheckCircle2 size={13} /> },
    { id: "notes" as const,     label: `Notas${local.annotations.length ? ` (${local.annotations.length})` : ""}`, icon: <MessageSquare size={13} /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(10,16,36,0.6)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex flex-col rounded-3xl shadow-2xl overflow-hidden" style={{ width: 700, maxHeight: "92vh", background: "#fff" }}>
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #4f46e5, #7c3aed, #db2777)" }} />

        <div className="flex items-start justify-between px-7 pt-5 pb-4 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#6b7a99]">Tarefa</span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: prio.bg, color: prio.text }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: prio.dot }} />
                {prio.label}
              </span>
            </div>
            <h2 className="text-xl font-black text-[#0f172a] leading-tight">{local.title}</h2>
          </div>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            {columnId !== "concluido" ? (
              <button
                onClick={() => { onComplete(columnId, task.id); onClose(); }}
                className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl text-white transition-all"
                style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
              >
                <CheckCircle size={14} /> Concluir tarefa
              </button>
            ) : (
              <>
                <button
                  onClick={() => { onReturn(columnId, task.id); onClose(); }}
                  className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl text-white transition-all"
                  style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}
                >
                  <RefreshCw size={14} /> Retornar
                </button>
                <button
                  onClick={() => { if (confirm("Deletar permanentemente dos concluídos?")) { onRemove(columnId, task.id); onClose(); } }}
                  className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl text-white transition-all"
                  style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
                >
                  <Trash2 size={14} /> Remover
                </button>
              </>
            )}
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-[#6b7a99] transition-colors">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="flex gap-0 px-7 border-b border-gray-100" style={{ background: "#fafafa" }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-3 text-xs font-bold transition-all border-b-2"
              style={{
                borderColor: activeTab === tab.id ? "#4f46e5" : "transparent",
                color: activeTab === tab.id ? "#4f46e5" : "#94a3b8",
              }}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5">
          {activeTab === "info" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { icon: <Tag size={12} />,       label: "ID",          value: local.title },
                  { icon: <Zap size={12} />,        label: "Ionix",       value: local.ionix || "—" },
                  { icon: <LayoutGrid size={12} />, label: "Cluster",     value: local.cluster || "—" },
                  { icon: <ChevronRight size={12} />,label: "UF",         value: local.uf || "—" },
                  { icon: <FileText size={12} />,   label: "Material",    value: local.material || "—" },
                  { icon: <ClipboardList size={12} />, label: "Quantidade", value: local.quantidade || "—" },
                  { icon: <Calendar size={12} />,   label: "Vencimento",  value: local.dueDate || "—" },
                ].map(row => (
                  <div key={row.label} className="flex items-start gap-2.5 rounded-2xl px-3.5 py-3 border border-gray-100" style={{ background: "#f8fafc" }}>
                    <span className="mt-0.5 text-indigo-400 shrink-0">{row.icon}</span>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-0.5">{row.label}</p>
                      <p className="text-sm font-bold text-[#0f172a]">{row.value}</p>
                    </div>
                  </div>
                ))}
                <div className="flex items-start gap-2.5 rounded-2xl px-3.5 py-3 border border-gray-100" style={{ background: "#f8fafc" }}>
                  <User size={12} className="mt-0.5 text-indigo-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-1">Colaborador</p>
                    <select
                      value={local.assignee}
                      onChange={e => { const m = getCollabMeta(e.target.value); save({ ...local, assignee: e.target.value, assigneeInitials: m.initials, assigneeColor: m.color }); }}
                      className="w-full text-sm font-bold text-[#0f172a] bg-transparent border-none focus:outline-none cursor-pointer"
                    >
                      <option value="Não atribuído">Não atribuído</option>
                      {COLLABORATORS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {local.tags.length > 0 && (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-2">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {local.tags.map(tag => (
                      <span key={tag} className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg" style={{ background: "#fef3c7", color: "#92400e" }}>{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {local.description && (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-2">Descrição</p>
                  <p className="text-sm text-[#334155] rounded-2xl p-4 border border-gray-100 whitespace-pre-line leading-relaxed" style={{ background: "#f8fafc" }}>
                    {local.description}
                  </p>
                </div>
              )}

              {local.steps.length > 0 && (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-2">Etapas</p>
                  <div className="space-y-2">
                    {local.steps.map(step => (
                      <button key={step.id} onClick={() => cycleStep(step.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-2xl border border-gray-100 hover:border-indigo-200 transition-all text-left"
                        style={{ background: "#f8fafc" }}
                      >
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stepStatusColor(step.status) }} />
                        <span className="flex-1 text-sm font-semibold text-[#0f172a]">{step.label}</span>
                        <span className="text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg"
                          style={{
                            background: step.status === "concluído" ? "#d1fae5" : step.status === "em andamento" ? "#fff7ed" : "#f1f5f9",
                            color: step.status === "concluído" ? "#065f46" : step.status === "em andamento" ? "#c2410c" : "#64748b",
                          }}
                        >{step.status}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "checklist" && (
            <div className="space-y-4">
              {local.checklist.length > 0 && (
                <>
                  <div className="rounded-2xl p-3.5 border border-indigo-100" style={{ background: "#f5f3ff" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-indigo-700">Progresso</span>
                      <span className="text-xs font-black text-indigo-700">{doneChecks}/{local.checklist.length}</span>
                    </div>
                    <div className="h-2 rounded-full bg-indigo-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${local.checklist.length ? (doneChecks / local.checklist.length) * 100 : 0}%`, background: "linear-gradient(90deg, #4f46e5, #7c3aed)" }} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    {local.checklist.map(item => (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 rounded-2xl border border-gray-100 group transition-all hover:border-indigo-100" style={{ background: item.done ? "#f0fdf4" : "#f8fafc" }}>
                        <button onClick={() => toggleCheck(item.id)} className="shrink-0">
                          {item.done ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} className="text-gray-300 group-hover:text-indigo-300 transition-colors" />}
                        </button>
                        <span className={`flex-1 text-sm ${item.done ? "line-through text-gray-400" : "font-medium text-[#0f172a]"}`}>{item.label}</span>
                        <button onClick={() => removeCheck(item.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-rose-500 transition-all">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <input
                  value={newCheckItem}
                  onChange={e => setNewCheckItem(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addCheckItem()}
                  placeholder="Nova atividade..."
                  className="flex-1 text-sm px-4 py-2.5 rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-indigo-300"
                />
                <button onClick={addCheckItem} className="px-4 py-2.5 rounded-xl text-white transition-colors" style={{ background: "#4f46e5" }}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
          )}

          {activeTab === "subtasks" && (
            <div className="space-y-4">
              {local.subtasks.length > 0 && (
                <div className="space-y-2">
                  {local.subtasks.map(sub => (
                    <div key={sub.id} className="flex items-center gap-3 px-4 py-2.5 rounded-2xl border border-gray-100 group" style={{ background: "#f8fafc" }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#0f172a] truncate">{sub.title}</p>
                        <p className="text-xs text-[#94a3b8]">{sub.assignee || "Sem responsável"}</p>
                      </div>
                      <select
                        value={sub.status}
                        onChange={e => updateSubtask(sub.id, { status: e.target.value as SubtaskStatus })}
                        className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border-none cursor-pointer"
                        style={{ background: sub.status === "concluído" ? "#d1fae5" : sub.status === "em andamento" ? "#fff7ed" : "#f1f5f9" }}
                      >
                        <option value="pendente">Pendente</option>
                        <option value="em andamento">Em andamento</option>
                        <option value="concluído">Concluído</option>
                      </select>
                      <button onClick={() => removeSubtask(sub.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-rose-500 transition-all">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {showSubtaskForm ? (
                <div className="space-y-2 rounded-2xl p-4 border border-indigo-100" style={{ background: "#f5f3ff" }}>
                  <input
                    value={newSubtask.title}
                    onChange={e => setNewSubtask(s => ({ ...s, title: e.target.value }))}
                    placeholder="Título da subtarefa..."
                    className="w-full text-sm px-4 py-2.5 rounded-xl border border-indigo-200 focus:outline-none bg-white"
                  />
                  <div className="flex gap-2">
                    <button onClick={addSubtask} className="flex-1 text-sm font-bold py-2.5 rounded-xl text-white" style={{ background: "#4f46e5" }}>Adicionar</button>
                    <button onClick={() => { setShowSubtaskForm(false); }} className="px-4 py-2.5 rounded-xl border text-sm text-[#6b7a99]">Cancelar</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowSubtaskForm(true)} className="w-full flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-2xl border-2 border-dashed border-indigo-200 text-indigo-400 hover:bg-indigo-50 transition-colors">
                  <Plus size={15} /> Nova subtarefa
                </button>
              )}
            </div>
          )}

          {activeTab === "notes" && (
            <div className="space-y-4">
              {local.annotations.length > 0 && (
                <div className="space-y-2">
                  {local.annotations.map(ann => (
                    <div key={ann.id} className="relative rounded-2xl px-4 py-3.5 border border-amber-100 group" style={{ background: "#fffbeb" }}>
                      <p className="text-sm text-[#0f172a] leading-relaxed">{ann.text}</p>
                      <p className="text-[10px] text-amber-400 mt-1.5 font-medium">{ann.createdAt}</p>
                      <button onClick={() => removeNote(ann.id)} className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-amber-300 hover:text-rose-500 transition-all">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Escreva uma anotação..."
                  rows={3}
                  className="w-full text-sm px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:border-amber-300 resize-none"
                />
                <button onClick={addNote} className="self-end flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl text-white" style={{ background: "#d97706" }}>
                  <Plus size={14} /> Adicionar nota
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAssignee, setFilterAssignee] = useState<string>("Todos");
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeNav, setActiveNav] = useState("kanban");
  const [filterOpen, setFilterOpen] = useState(false);
  const [openTask, setOpenTask] = useState<{ task: KanbanTask; columnId: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "loading" } | null>(null);
  const [dragState, setDragState] = useState<{ taskId: string; fromColId: string } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const ablyChannelRef = useRef<any>(null);
  const myClientIdRef = useRef<string>(`client-${Math.random().toString(36).substr(2, 9)}`);

  const showToast = useCallback((message: string, type: "success" | "error" | "loading") => {
    setToast({ message, type });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const officialColumnsStructure = useMemo(() => [
    { id: "semservico",  title: "Sem Serviço",  color: "#ef4444", accent: "#fee2e2" },
    { id: "materiaiscl", title: "Materiais CL", color: "#84cc16", accent: "#f7fee7" },
    { id: "acaost",      title: "Ação ST",      color: "#3b82f6", accent: "#eff6ff" },
    { id: "concluido",   title: "Concluído",    color: "#10b981", accent: "#f0fdf4" },
  ], []);

  const persistColumnPos = (task: KanbanTask, colId: string) => {
    const key = getPersistKey(task);
    try {
      const stored = JSON.parse(localStorage.getItem(LS_COLUMNS_KEY) || "{}");
      stored[key] = colId;
      localStorage.setItem(LS_COLUMNS_KEY, JSON.stringify(stored));
    } catch {}
    try {
      const pending = JSON.parse(localStorage.getItem(LS_PENDING_KEY) || "{}");
      pending[key] = { task: { ...task, previousColumnId: undefined }, columnId: colId, ts: Date.now() };
      localStorage.setItem(LS_PENDING_KEY, JSON.stringify(pending));
    } catch {}
    try {
      const deleted = JSON.parse(localStorage.getItem(LS_DELETED_KEY) || "{}");
      if (deleted[key]) {
        delete deleted[key];
        localStorage.setItem(LS_DELETED_KEY, JSON.stringify(deleted));
      }
    } catch {}
  };

  const persistDeletion = (task: KanbanTask) => {
    const key = getPersistKey(task);
    try {
      const deleted = JSON.parse(localStorage.getItem(LS_DELETED_KEY) || "{}");
      deleted[key] = Date.now();
      localStorage.setItem(LS_DELETED_KEY, JSON.stringify(deleted));
    } catch {}
    try {
      const pending = JSON.parse(localStorage.getItem(LS_PENDING_KEY) || "{}");
      delete pending[key];
      localStorage.setItem(LS_PENDING_KEY, JSON.stringify(pending));
    } catch {}
  };

  const loadKanban = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await fetch(API_URL);
      const data = await response.json();
      
      if (data && typeof data === "object" && !Array.isArray(data)) {
        let savedAnnotations: Record<string, Annotation[]> = {};
        let savedColumns: Record<string, string> = {};
        let pending: Record<string, { task: KanbanTask; columnId: string; ts: number }> = {};
        let deleted: Record<string, number> = {};
        try { savedAnnotations = JSON.parse(localStorage.getItem(LS_ANNOTATIONS_KEY) || "{}"); } catch {}
        try { savedColumns    = JSON.parse(localStorage.getItem(LS_COLUMNS_KEY)     || "{}"); } catch {}
        try { pending         = JSON.parse(localStorage.getItem(LS_PENDING_KEY)     || "{}"); } catch {}
        try { deleted         = JSON.parse(localStorage.getItem(LS_DELETED_KEY)     || "{}"); } catch {}

        const now = Date.now();
        const allTasksFlat: { task: KanbanTask; apiColId: string; key: string }[] = [];

        officialColumnsStructure.forEach((col) => {
          const apiKey = Object.keys(data).find(k => k.toLowerCase() === col.id.toLowerCase()) || col.id;
          const rawTasks = data[apiKey] || [];
          
          if (!Array.isArray(rawTasks)) return;
          rawTasks.forEach((task: any, index: number) => {
            if (!task) return;
            
            // 🌟 ULTRA BLINDAGEM: Criamos um ID composto que une Coluna + ID do Sheets + Linha.
            // Isso impede que múltiplos cards com o mesmo número de ID fiquem idênticos para o React.
            const rawId = task.id ? String(task.id) : `task`;
            const uniqueId = `${col.id}-${rawId}-${index}`;

            const meta = getCollabMeta(task.assignee || "Não atribuído");
            const builtTask: KanbanTask = {
              id: uniqueId, 
              title: rawId, // Mantém o ID original limpo visível no card
              ionix: task.ionix || task.description?.match(/Ionix[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              cluster: task.cluster || task.description?.match(/Cluster[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              uf: task.uf || task.description?.match(/UF[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              material: task.material || task.description?.match(/Material[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              quantidade: task.quantidade || task.description?.match(/Qtd?[a-z.]*[:\s]+([^\n|]+)/i)?.[1]?.trim() || task.description?.match(/Quantidade[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              description: task.description || "",
              assignee: task.assignee || "Não atribuído",
              assigneeInitials: meta.initials,
              assigneeColor: meta.color,
              priority: "média",
              dueDate: task.dueDate || "",
              steps: [],
              tags: Array.isArray(task.tags) ? task.tags : [],
              checklist: [],
              subtasks: [],
              annotations: [],
            };
            const key = getPersistKey(builtTask);
            builtTask.annotations = (savedAnnotations[key]?.length ? savedAnnotations[key] : (Array.isArray(task.annotations) ? task.annotations : []));
            allTasksFlat.push({ apiColId: col.id, task: builtTask, key });
          });
        });

        const liveTasks = allTasksFlat.filter(({ key }) => {
          const ts = deleted[key];
          return !(ts && now - ts < PENDING_TTL_MS);
        });

        const builtColumns: Column[] = officialColumnsStructure.map((col) => {
          const tasks = liveTasks
            .filter(({ apiColId, key }) => {
              const localCol = savedColumns[key];
              return localCol ? localCol === col.id : apiColId === col.id;
            })
            .map(({ task }) => task);
          return { ...col, tasks };
        });

        const remainingPending: typeof pending = {};
        Object.entries(pending).forEach(([key, p]) => {
          if (now - p.ts > PENDING_TTL_MS) return;
          const present = liveTasks.find(t => t.key === key);
          const alreadyInTargetCol = builtColumns
            .find(c => c.id === p.columnId)
            ?.tasks.some(t => getPersistKey(t) === key);

          if (alreadyInTargetCol) return;

          if (present) {
            builtColumns.forEach(c => { c.tasks = c.tasks.filter(t => getPersistKey(t) !== key); });
          }
          const targetCol = builtColumns.find(c => c.id === p.columnId);
          if (targetCol) {
            const taskWithNotes = { ...p.task, annotations: savedAnnotations[key]?.length ? savedAnnotations[key] : p.task.annotations };
            targetCol.tasks.push(taskWithNotes);
          }
          remainingPending[key] = p;
        });
        try { localStorage.setItem(LS_PENDING_KEY, JSON.stringify(remainingPending)); } catch {}

        const remainingDeleted: Record<string, number> = {};
        Object.entries(deleted).forEach(([key, ts]) => {
          if (now - ts < PENDING_TTL_MS) remainingDeleted[key] = ts;
        });
        try { localStorage.setItem(LS_DELETED_KEY, JSON.stringify(remainingDeleted)); } catch {}

        setColumns(builtColumns);
      }
    } catch (error) {
      console.error("Erro ao ler API:", error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [officialColumnsStructure]);

  useEffect(() => { loadKanban(); }, [loadKanban]);

  useEffect(() => {
    if (!ABLY_API_KEY || ABLY_API_KEY.includes("SUA_CHAVE_DO_ABLY")) return;

    const ably = new Realtime({ key: ABLY_API_KEY });
    const channel = ably.channels.get(ABLY_CHANNEL_NAME);
    ablyChannelRef.current = channel;

    channel.subscribe("taskMoved", (message) => {
      // Ignora ecos enviados por nós mesmos
      if (message.data.senderId === myClientIdRef.current) return;

      const { taskId, fromColId, toColId, task } = message.data;
      
      setColumns(prev => {
        const withoutTask = prev.map(col =>
          col.id === fromColId ? { ...col, tasks: col.tasks.filter(t => t.id !== taskId) } : col
        );
        return withoutTask.map(col => {
          if (col.id === toColId) {
            const exists = col.tasks.some(t => t.id === taskId);
            return exists ? col : { ...col, tasks: [...col.tasks, task] };
          }
          return col;
        });
      });
    });

    channel.subscribe("taskUpdated", (message) => {
      if (message.data.senderId === myClientIdRef.current) return;
      const { updatedTask } = message.data;
      setColumns(prev => prev.map(col => ({
        ...col,
        tasks: col.tasks.map(t => t.id === updatedTask.id ? updatedTask : t)
      })));
    });

    channel.subscribe("taskDeleted", (message) => {
      if (message.data.senderId === myClientIdRef.current) return;
      const { taskId } = message.data;
      setColumns(prev => prev.map(col => ({
        ...col,
        tasks: col.tasks.filter(t => t.id !== taskId)
      })));
    });

    return () => {
      channel.unsubscribe();
      ably.close();
    };
  }, []);

  const updateTask = (updated: KanbanTask) => {
    setColumns(prev => prev.map(col => ({ ...col, tasks: col.tasks.map(t => t.id === updated.id ? updated : t) })));
    ablyChannelRef.current?.publish("taskUpdated", { updatedTask: updated, senderId: myClientIdRef.current });
    
    // Sempre limpamos o ID composto enviando apenas o ID limpo (title) para o Sheets
    fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateTask", task: { ...updated, id: updated.title } }) }).catch(() => {});
  };

  const handleAssigneeChange = async (taskId: string, newAssignee: string) => {
    const meta = getCollabMeta(newAssignee);
    let updatedTask: KanbanTask | null = null;

    setColumns(prev => prev.map(col => ({
      ...col,
      tasks: col.tasks.map(t => {
        if (t.id === taskId) {
          updatedTask = { ...t, assignee: newAssignee, assigneeInitials: meta.initials, assigneeColor: meta.color };
          return updatedTask;
        }
        return t;
      })
    })));

    if (updatedTask) {
      ablyChannelRef.current?.publish("taskUpdated", { updatedTask, senderId: myClientIdRef.current });
      const cleanId = (updatedTask as KanbanTask).title;
      fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateAssignee", taskId: cleanId, assignee: newAssignee }) }).catch(() => {});
    }
  };

  const handleCompleteTask = async (columnId: string, taskId: string) => {
    let taskToMove: KanbanTask | null = null;
    const sourceCol = columns.find(c => c.id === columnId);
    if (sourceCol) {
      const found = sourceCol.tasks.find(t => t.id === taskId);
      if (found) taskToMove = { ...found, tags: ["Concluído"] };
    }

    if (!taskToMove) return;

    const prevColumns = columns;
    taskToMove = { ...taskToMove, previousColumnId: columnId };
    
    setColumns(prev => {
      const withoutTask = prev.map(col =>
        col.id === columnId ? { ...col, tasks: col.tasks.filter(t => t.id !== taskId) } : col
      );
      return withoutTask.map(col =>
        col.id === "concluido" ? { ...col, tasks: [...col.tasks, taskToMove!] } : col
      );
    });

    ablyChannelRef.current?.publish("taskMoved", { taskId, fromColId: columnId, toColId: "concluido", task: taskToMove, senderId: myClientIdRef.current });
    showToast("Enviando para o Sheets...", "loading");

    try {
      const cleanTask = { ...taskToMove!, id: taskToMove!.title };
      const res = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "updateTask", task: cleanTask, targetColumn: "concluido" }),
      });

      const result = await res.json().catch(() => ({ status: "error", message: "Resposta inválida" }));

      if (result.status === "success") {
        persistColumnPos(taskToMove!, "concluido");
        showToast("Tarefa concluída com sucesso!", "success");
      } else {
        setColumns(prevColumns);
        showToast(`Erro ao concluir: ${result.message || "tente novamente"}`, "error");
      }
    } catch (err) {
      setColumns(prevColumns);
      showToast("Erro de conexão. O card foi restaurado.", "error");
    }
  };

  const handleRemoveFromCompleted = async (columnId: string, taskId: string) => {
    const sourceCol = columns.find(c => c.id === columnId);
    const taskToDelete = sourceCol?.tasks.find(t => t.id === taskId);
    
    setColumns(prev => prev.map(col => col.id === columnId ? { ...col, tasks: col.tasks.filter(t => t.id !== taskId) } : col));
    ablyChannelRef.current?.publish("taskDeleted", { taskId, senderId: myClientIdRef.current });

    if (taskToDelete) {
      persistDeletion(taskToDelete);
      const cleanId = taskToDelete.title;
      fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "deleteTask", taskId: cleanId }) }).catch(() => {});
    }
  };

  const handleReturnTask = async (columnId: string, taskId: string) => {
    let taskToReturn: KanbanTask | null = null;
    const sourceCol = columns.find(c => c.id === columnId);
    if (sourceCol) {
      const found = sourceCol.tasks.find(t => t.id === taskId);
      if (found) taskToReturn = { ...found };
    }
    if (!taskToReturn) return;

    const targetColId = taskToReturn.previousColumnId || "semservico";
    const finalTask = { ...taskToReturn, previousColumnId: undefined };

    setColumns(prev => {
      const withoutTask = prev.map(col =>
        col.id === columnId ? { ...col, tasks: col.tasks.filter(t => t.id !== taskId) } : col
      );
      return withoutTask.map(col =>
        col.id === targetColId ? { ...col, tasks: [...col.tasks, finalTask] } : col
      );
    });

    ablyChannelRef.current?.publish("taskMoved", { taskId, fromColId: columnId, toColId: targetColId, task: finalTask, senderId: myClientIdRef.current });
    showToast("Tarefa retornada!", "success");
    persistColumnPos(finalTask, targetColId);
    
    const cleanTask = { ...taskToReturn, id: taskToReturn.title };
    fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateTask", task: cleanTask, targetColumn: targetColId }) }).catch(() => {});
  };

  const handleDragStart = (taskId: string, fromColId: string) => {
    setDragState({ taskId, fromColId });
  };

  const handleDrop = (toColId: string) => {
    if (!dragState || dragState.fromColId === toColId) {
      setDragState(null);
      setDragOverCol(null);
      return;
    }
    const { taskId, fromColId } = dragState;
    let taskToMove: KanbanTask | null = null;
    const sourceCol = columns.find(c => c.id === fromColId);
    if (sourceCol) {
      const found = sourceCol.tasks.find(t => t.id === taskId);
      if (found) taskToMove = { ...found, previousColumnId: fromColId };
    }
    if (!taskToMove) { setDragState(null); setDragOverCol(null); return; }

    // Ao soltar o card, reformulamos o ID único do React para conter a nova coluna de destino
    const targetTaskId = `${toColId}-${taskToMove.title}-${Date.now()}`;
    const preparedTask = { ...taskToMove, id: targetTaskId };

    setColumns(prev => {
      const withoutTask = prev.map(col =>
        col.id === fromColId ? { ...col, tasks: col.tasks.filter(t => t.id !== taskId) } : col
      );
      return withoutTask.map(col =>
        col.id === toColId ? { ...col, tasks: [...col.tasks, preparedTask] } : col
      );
    });

    ablyChannelRef.current?.publish("taskMoved", { 
      taskId, 
      fromColId, 
      toColId, 
      task: preparedTask, 
      senderId: myClientIdRef.current 
    });

    showToast(`Card movido para ${columns.find(c => c.id === toColId)?.title}`, "success");
    persistColumnPos(preparedTask, toColId);

    const apiAction = toColId === "acaost" ? "createActionST" : "updateTask";
    const cleanTask = { ...preparedTask, id: preparedTask.title };
    
    fetch(API_URL, { 
      method: "POST", 
      body: JSON.stringify({ action: apiAction, task: cleanTask, targetColumn: toColId }) 
    }).catch(() => {});

    setDragState(null);
    setDragOverCol(null);
  };

  const filteredColumns = useMemo(() =>
    columns.map(col => ({
      ...col,
      tasks: Array.isArray(col.tasks) ? col.tasks.filter(t => {
        const matchesAssignee = filterAssignee === "Todos" || t.assignee === filterAssignee;
        
        const q = searchQuery.trim().toLowerCase();
        const matchesSearch = !q || 
          String(t.title).toLowerCase().includes(q) || 
          String(t.ionix).toLowerCase().includes(q) || 
          String(t.cluster).toLowerCase().includes(q) || 
          String(t.description).toLowerCase().includes(q);

        return matchesAssignee && matchesSearch;
      }) : [],
    })), [columns, filterAssignee, searchQuery]
  );

  const duplicateTitleSet = useMemo(() => {
    const count: Record<string, number> = {};
    columns.forEach(col => col.tasks.forEach(t => { count[t.title] = (count[t.title] || 0) + 1; }));
    return new Set(Object.entries(count).filter(([, n]) => n > 1).map(([k]) => k));
  }, [columns]);

  const navItems = [
    { id: "kanban",        label: "Kanban",       icon: <LayoutGrid size={18} /> },
    { id: "colaboradores", label: "Colaboradores", icon: <Users size={18} /> },
    { id: "relatorios",    label: "Relatórios",    icon: <BarChart3 size={18} /> },
    { id: "configuracoes", label: "Configurações", icon: <Settings size={18} /> },
  ];

  const totalTasks = columns.reduce((a, c) => a + c.tasks.length, 0);
  const concludedCount = columns.find(c => c.id === "concluido")?.tasks.length ?? 0;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "#0f172a" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f97316, #4f46e5)" }}>
            <span className="text-white font-black text-sm">TLP</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-400">
            <RefreshCw size={14} className="animate-spin text-indigo-400" />
            Carregando dados unificados...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#f1f5f9" }}>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={dismissToast} />}

      {openTask && (
        <TaskDetailModal
          task={openTask.task}
          columnId={openTask.columnId}
          onClose={() => setOpenTask(null)}
          onUpdate={updateTask}
          onComplete={(colId, taskId) => { handleCompleteTask(colId, taskId); setOpenTask(null); }}
          onRemove={handleRemoveFromCompleted}
          onReturn={(colId, taskId) => { handleReturnTask(colId, taskId); setOpenTask(null); }}
        />
      )}

      <aside
        className={`flex flex-col shrink-0 transition-all duration-300`}
        style={{ width: sidebarOpen ? 220 : 64, background: "#0f172a", borderRight: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-3 px-4 h-16 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #f97316, #4f46e5)" }}>
            <span className="text-white font-black text-xs">TLP</span>
          </div>
          {sidebarOpen && (
            <div>
              <div className="text-white font-black text-sm leading-tight">TLP</div>
              <div className="text-[10px] font-medium leading-tight" style={{ color: "#475569" }}>Serviços</div>
            </div>
          )}
        </div>

        <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto px-2">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-all rounded-xl"
              style={{
                color: activeNav === item.id ? "#fff" : "#475569",
                background: activeNav === item.id ? "rgba(79,70,229,0.25)" : "transparent",
              }}
            >
              <span style={{ color: activeNav === item.id ? "#818cf8" : "#475569" }}>{item.icon}</span>
              {sidebarOpen && <span className="font-semibold">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="px-2 pb-4">
          <button
            onClick={() => { loadKanban(); showToast("Atualizando dados do Sheets...", "loading"); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
            style={{ color: "#475569" }}
          >
            <RefreshCw size={18} style={{ color: "#475569" }} />
            {sidebarOpen && <span className="text-sm font-semibold">Forçar Recarga</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 shrink-0 flex items-center justify-between px-6 bg-white shadow-sm" style={{ borderBottom: "1px solid #e2e8f0" }}>
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
              <Menu size={18} />
            </button>
            <div>
              <h1 className="text-base font-black text-[#0f172a]">Quadro Live (Ably)</h1>
              <p className="text-xs text-slate-400 font-medium">
                {totalTasks} cards · {concludedCount} concluídos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="ID, Ionix, Cluster..."
                className="pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 w-52 focus:outline-none focus:border-indigo-300 transition-colors"
              />
            </div>

            <div className="relative">
              <button
                onClick={() => filterOpen ? setFilterOpen(false) : setFilterOpen(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-xl bg-slate-50 text-slate-600 hover:border-indigo-300 transition-colors"
              >
                <Filter size={13} />
                <span>{filterAssignee}</span>
                <ChevronDown size={12} />
              </button>
              {filterOpen && (
                <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-100 rounded-2xl shadow-xl z-30 py-1.5 min-w-[170px]">
                  {["Todos", ...COLLABORATORS.map(c => c.name)].map(name => (
                    <button
                      key={name}
                      onClick={() => { setFilterAssignee(name); setFilterOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
                      style={{ color: filterAssignee === name ? "#4f46e5" : "#334155" }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-4 h-full p-5 min-w-max">
            {filteredColumns.map(col => (
              <div key={col.id} className="flex flex-col w-72 shrink-0">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col.color }} />
                  <span className="text-sm font-black text-[#0f172a]">{col.title}</span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full ml-auto" style={{ background: col.accent, color: col.color }}>
                    {col.tasks.length}
                  </span>
                </div>

                <div
                  className="flex-1 overflow-y-auto space-y-3 pb-4 px-0.5 rounded-2xl transition-all"
                  style={{
                    scrollbarWidth: "thin", scrollbarColor: "#e2e8f0 transparent",
                    background: dragOverCol === col.id ? col.accent : "transparent",
                    outline: dragOverCol === col.id ? `2px dashed ${col.color}` : "2px dashed transparent",
                    padding: dragOverCol === col.id ? "8px 4px" : "0 2px",
                  }}
                  onDragOver={e => { e.preventDefault(); setDragOverCol(col.id); }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={() => handleDrop(col.id)}
                >
                  {col.tasks.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 rounded-2xl border-2 border-dashed border-slate-200 text-slate-300">
                      <CheckCircle size={22} />
                      <p className="text-xs font-semibold mt-2">Vazio</p>
                    </div>
                  )}
                  {col.tasks.map(task => {
                    const prio = priorityBadge(task.priority);
                    const meta = getCollabMeta(task.assignee);
                    const isDuplicate = duplicateTitleSet.has(task.title);
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => handleDragStart(task.id, col.id)}
                        onDragEnd={() => { setDragState(null); setDragOverCol(null); }}
                        className="bg-white rounded-2xl shadow-sm group hover:shadow-md transition-all cursor-grab active:cursor-grabbing overflow-hidden"
                        style={{
                          border: isDuplicate ? "1.5px solid #f59e0b" : "1px solid #e8ecf4",
                          // A opacidade agora só afetará exatamente o card arrastado graças ao ID único!
                          opacity: dragState?.taskId === task.id ? 0.3 : 1,
                          background: isDuplicate ? "#fffdf0" : "#fff",
                        }}
                        onClick={() => setOpenTask({ task, columnId: col.id })}
                      >
                        <div className="flex">
                          <div className="w-1 shrink-0 rounded-l-2xl" style={{ background: col.color }} />
                          <div className="flex-1 p-3.5">
                            <div className="flex items-center justify-between gap-2 mb-2.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className="text-[10px] font-bold text-indigo-600">
                                  ID: {task.title}
                                </div>
                                {isDuplicate && (
                                  <span className="shrink-0 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md" style={{ background: "#fef3c7", color: "#b45309", border: "1px solid #f59e0b" }}>
                                    ID dup.
                                  </span>
                                )}
                              </div>
                              <span className="flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full shrink-0" style={{ background: prio.bg, color: prio.text }}>
                                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: prio.dot }} />
                                {prio.label}
                              </span>
                            </div>

                            <div className="space-y-1 mb-3">
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 w-10 shrink-0">Ionix</span>
                                <span className="font-bold text-slate-700 truncate text-[11px]">{task.ionix}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 w-10 shrink-0">Cluster</span>
                                <span className="font-bold text-slate-700 truncate text-[11px]">{task.cluster}</span>
                              </div>
                              {task.quantidade && task.quantidade !== "—" && (
                                <div className="flex items-center gap-1.5 text-xs">
                                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 w-10 shrink-0">Qtd</span>
                                  <span className="font-bold text-indigo-600 truncate text-[11px]">{task.quantidade}</span>
                                </div>
                              )}
                            </div>

                            {task.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-3">
                                {task.tags.map(tag => (
                                  <span key={tag} className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md" style={{ background: "#fef3c7", color: "#92400e" }}>{tag}</span>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px solid #f1f5f9" }}>
                              <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-white font-black text-[9px] shrink-0 ring-2 ring-white"
                                  style={{ background: meta.color }}
                                  title={task.assignee}
                                >
                                  {meta.initials}
                                </div>
                                <select
                                  value={task.assignee}
                                  onChange={e => handleAssigneeChange(task.id, e.target.value)}
                                  className="text-[10px] font-semibold border-none bg-transparent text-slate-500 cursor-pointer focus:outline-none max-w-[90px]"
                                >
                                  <option value="Não atribuído">Sem perfil</option>
                                  {COLLABORATORS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                </select>
                              </div>

                              <div onClick={e => e.stopPropagation()}>
                                {col.id !== "concluido" ? (
                                  <button
                                    onClick={() => handleCompleteTask(col.id, task.id)}
                                    className="flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg transition-all text-white"
                                    style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
                                  >
                                    <CheckCircle size={11} /> Concluir
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => handleReturnTask(col.id, task.id)}
                                      className="flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg transition-all text-white"
                                      style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}
                                    >
                                      <RefreshCw size={11} /> Retornar
                                    </button>
                                    <button
                                      onClick={() => { if (confirm("Deletar permanentemente?")) handleRemoveFromCompleted(col.id, task.id); }}
                                      className="flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg transition-all"
                                      style={{ background: "#fff1f2", color: "#e11d48" }}
                                    >
                                      <Trash2 size={11} /> Remover
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}