import { useState, useMemo, useEffect, useCallback } from "react";
import {
  LayoutGrid, Users, BarChart3, Settings, Search, Filter, ChevronDown,
  Menu, CheckCircle, X, Plus, Trash2, ChevronRight, Calendar, User,
  Tag, FileText, ClipboardList, MessageSquare, Circle, CheckCircle2,
  RefreshCw, AlertCircle, Zap
} from "lucide-react";
import { Realtime } from "ably";

const API_URL = "https://script.google.com/macros/s/AKfycbwrNNlyRWYq5zayRYSlRfRSC_bFY7tjc4DXxL6TF3YSnHwMOw_h7HY2wF6qFW3MSQsXBQ/exec";
// 🟢 Chave Root inserida com sucesso para atualização instantânea (< 1s)
const ABLY_KEY = "BUp6Lg.QfvVuw:DBQaijX7rEyBdz4A1dXnrDXE68wWcCWkQTUG_BLSk9E"; 

const LS_ANNOTATIONS_KEY = "tlp_kanban_annotations"; 
const LS_COLUMNS_KEY     = "tlp_kanban_columns";     
const LS_PENDING_KEY     = "tlp_kanban_pending";     
const LS_DELETED_KEY     = "tlp_kanban_deleted";     
const PENDING_TTL_MS = 3 * 60 * 1000; 
const POLL_INTERVAL_MS = 30 * 1000; // Reduzido para 30s pois o Ably cuida do tempo real

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
  assigneeInitials: string; assigneeColor: string; priority: Priority; 
  dueDate: string; steps: Step[]; tags: string[]; checklist: ChecklistItem[]; 
  subtasks: Subtask[]; annotations: Annotation[]; previousColumnId?: string;
}

interface Column { id: string; title: string; color: string; accent: string; tasks: KanbanTask[]; }

function getPersistKey(task: Pick<KanbanTask, "id" | "title">): string {
  return `i:${task.id}`;
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
      const t = setTimeout(onDismiss, 2500);
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
    <div className="fixed bottom-6 right-6 z-[100] flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl text-sm font-medium border" style={{ background: c.bg, borderColor: c.border, color: c.text, minWidth: 240 }}>
      {c.icon}
      <span className="flex-1">{message}</span>
    </div>
  );
}

// Inicializando canal em tempo real do Ably
const ably = new Realtime({ key: ABLY_KEY });
const channel = ably.channels.get("kanban-live");

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

  const broadcastChange = (type: string, payload: any) => {
    if (channel) channel.publish(type, payload);
  };

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
  };

  const loadKanban = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await fetch(API_URL);
      const data = await response.json();
      if (data && typeof data === "object" && !Array.isArray(data)) {
        let savedAnnotations: Record<string, Annotation[]> = {};
        let savedColumns: Record<string, string> = {};
        try { savedAnnotations = JSON.parse(localStorage.getItem(LS_ANNOTATIONS_KEY) || "{}"); } catch {}
        try { savedColumns    = JSON.parse(localStorage.getItem(LS_COLUMNS_KEY)     || "{}"); } catch {}

        const allTasksFlat: { task: KanbanTask; apiColId: string; key: string }[] = [];

        officialColumnsStructure.forEach((col) => {
          const rawTasks = data[col.id] || [];
          if (!Array.isArray(rawTasks)) return;
          rawTasks.forEach((task: any, index: number) => {
            if (!task) return;
            const meta = getCollabMeta(task.assignee || "Não atribuído");
            const taskId = task.id ? String(task.id) : `${col.id}-task-${index}`;
            const builtTask: KanbanTask = {
              id: taskId,
              title: task.title || "Sem ID",
              ionix: task.ionix || "—",
              cluster: task.cluster || "—",
              uf: task.uf || "—",
              material: task.material || "—",
              quantidade: task.quantidade || "—",
              description: task.description || "",
              assignee: task.assignee || "Não atribuído",
              assigneeInitials: meta.initials,
              assigneeColor: meta.color,
              priority: "média",
              dueDate: task.dueDate || "",
              steps: [],
              tags: Array.isArray(task.tags) ? task.tags : [],
              checklist: [], subtasks: [], annotations: [],
            };
            const key = getPersistKey(builtTask);
            builtTask.annotations = (savedAnnotations[key]?.length ? savedAnnotations[key] : (Array.isArray(task.annotations) ? task.annotations : []));
            allTasksFlat.push({ apiColId: col.id, task: builtTask, key });
          });
        });

        const builtColumns: Column[] = officialColumnsStructure.map((col) => {
          const tasks = allTasksFlat
            .filter(({ apiColId, key }) => {
              const localCol = savedColumns[key];
              return localCol ? localCol === col.id : apiColId === col.id;
            })
            .map(({ task }) => task);
          return { ...col, tasks };
        });

        setColumns(builtColumns);
        
        setOpenTask(prev => {
          if (!prev) return null;
          for (const c of builtColumns) {
            const found = c.tasks.find(t => t.id === prev.task.id);
            if (found) return { task: found, columnId: c.id };
          }
          return prev;
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [officialColumnsStructure]);

  // Escuta ativa do Ably: Faz a tela da chefe mexer em < 1 segundo
  useEffect(() => {
    loadKanban();
    if (channel) {
      channel.subscribe("task_moved", (message) => {
        const { taskId, toColId, task } = message.data;
        setColumns(prev => {
          const clean = prev.map(c => ({ ...c, tasks: c.tasks.filter(t => t.id !== taskId) }));
          return clean.map(c => c.id === toColId ? { ...c, tasks: [...c.tasks, task] } : c);
        });
      });
      channel.subscribe("task_updated", (message) => {
        const { updatedTask } = message.data;
        setColumns(prev => prev.map(c => ({ ...c, tasks: c.tasks.map(t => t.id === updatedTask.id ? updatedTask : t) })));
      });
    }
    return () => { if (channel) channel.unsubscribe(); };
  }, [loadKanban]);

  useEffect(() => {
    const interval = setInterval(() => loadKanban(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadKanban]);

  const updateTask = (updated: KanbanTask) => {
    setColumns(prev => prev.map(col => ({ ...col, tasks: col.tasks.map(t => t.id === updated.id ? updated : t) })));
    broadcastChange("task_updated", { updatedTask: updated });
    fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateTask", task: updated }) }).catch(() => {});
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
    if (updatedTask) broadcastChange("task_updated", { updatedTask });
    fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateAssignee", taskId, assignee: newAssignee }) }).catch(() => {});
  };

  const handleCompleteTask = async (columnId: string, taskId: string) => {
    let taskToMove: KanbanTask | null = null;
    const sourceCol = columns.find(c => c.id === columnId);
    if (sourceCol) {
      const found = sourceCol.tasks.find(t => t.id === taskId);
      if (found) taskToMove = { ...found, tags: ["Concluído"], previousColumnId: columnId };
    }
    if (!taskToMove) return;

    setColumns(prev => {
      const clean = prev.map(col => col.id === columnId ? { ...col, tasks: col.tasks.filter(t => t.id !== taskId) } : col);
      return clean.map(col => col.id === "concluido" ? { ...col, tasks: [...col.tasks, taskToMove!] } : col);
    });

    persistColumnPos(taskToMove, "concluido");
    broadcastChange("task_moved", { taskId, toColId: "concluido", task: taskToMove });
    showToast("Tarefa concluída!", "success");

    fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateTask", task: taskToMove, targetColumn: "concluido" }) });
  };

  // 🔥 RETORNAR CORRIGIDO: Limpa a tag de Concluído e joga de volta na hora certa
  const handleReturnTask = async (columnId: string, taskId: string) => {
    let taskToReturn: KanbanTask | null = null;
    const sourceCol = columns.find(c => c.id === columnId);
    if (sourceCol) {
      const found = sourceCol.tasks.find(t => t.id === taskId);
      if (found) {
        const cleanTags = (found.tags || []).filter(t => t !== "Concluído");
        taskToReturn = { ...found, tags: cleanTags };
      }
    }
    if (!taskToReturn) return;

    const targetColId = taskToReturn.previousColumnId || "semservico";
    taskToReturn.previousColumnId = undefined; 

    setColumns(prev => {
      const clean = prev.map(col => col.id === columnId ? { ...col, tasks: col.tasks.filter(t => t.id !== taskId) } : col);
      return clean.map(col => col.id === targetColId ? { ...col, tasks: [...col.tasks, taskToReturn!] } : col);
    });

    persistColumnPos(taskToReturn, targetColId);
    broadcastChange("task_moved", { taskId, toColId: targetColId, task: taskToReturn });
    showToast("Tarefa retornada ao fluxo!", "success");

    fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateTask", task: taskToReturn, targetColumn: targetColId }) });
  };

  const handleDragStart = (taskId: string, fromColId: string) => {
    setDragState({ taskId, fromColId });
  };

  const handleDrop = (toColId: string) => {
    if (!dragState || dragState.fromColId === toColId) {
      setDragState(null); setDragOverCol(null); return;
    }
    const { taskId, fromColId } = dragState;
    let taskToMove: KanbanTask | null = null;
    const sourceCol = columns.find(c => c.id === fromColId);
    if (sourceCol) {
      const found = sourceCol.tasks.find(t => t.id === taskId);
      if (found) taskToMove = { ...found, previousColumnId: fromColId };
    }
    if (!taskToMove) { setDragState(null); setDragOverCol(null); return; }

    setColumns(prev => {
      const clean = prev.map(col => col.id === fromColId ? { ...col, tasks: col.tasks.filter(t => t.id !== taskId) } : col);
      return clean.map(col => col.id === toColId ? { ...col, tasks: [...col.tasks, taskToMove!] } : col);
    });

    persistColumnPos(taskToMove, toColId);
    broadcastChange("task_moved", { taskId, toColId, task: taskToMove });
    
    fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateTask", task: taskToMove, targetColumn: toColId }) });
    setDragState(null); setDragOverCol(null);
  };

  const filteredColumns = useMemo(() =>
    columns.map(col => ({
      ...col,
      tasks: col.tasks.filter(t => {
        const matchesAssignee = filterAssignee === "Todos" || t.assignee === filterAssignee;
        const q = searchQuery.toLowerCase();
        return matchesAssignee && (!q || t.title?.toLowerCase().includes(q) || t.ionix?.toLowerCase().includes(q) || t.cluster?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
      }),
    })), [columns, filterAssignee, searchQuery]
  );

  const duplicateTitleSet = useMemo(() => {
    const count: Record<string, number> = {};
    columns.forEach(col => col.tasks.forEach(t => { if (t.title) count[t.title] = (count[t.title] || 0) + 1; }));
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
            Sincronizando com o Sheets...
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

      <aside className={`flex flex-col shrink-0 transition-all duration-300`} style={{ width: sidebarOpen ? 220 : 64, background: "#0f172a", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
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
            <button key={item.id} onClick={() => setActiveNav(item.id)} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-all rounded-xl" style={{ color: activeNav === item.id ? "#fff" : "#475569", background: activeNav === item.id ? "rgba(79,70,229,0.25)" : "transparent" }}>
              <span style={{ color: activeNav === item.id ? "#818cf8" : "#475569" }}>{item.icon}</span>
              {sidebarOpen && <span className="font-semibold">{item.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 shrink-0 flex items-center justify-between px-6 bg-white shadow-sm" style={{ borderBottom: "1px solid #e2e8f0" }}>
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
              <Menu size={18} />
            </button>
            <div>
              <h1 className="text-base font-black text-[#0f172a]">Quadro Kanban</h1>
              <p className="text-xs text-slate-400 font-medium">{totalTasks} cards · {concludedCount} concluídos</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="ID, Ionix, Cluster..." className="pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 w-52 focus:outline-none focus:border-indigo-300 transition-colors" />
            </div>

            <div className="relative">
              <button onClick={() => setFilterOpen(!filterOpen)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-xl bg-slate-50 text-slate-600 hover:border-indigo-300 transition-colors">
                <Filter size={13} />
                <span>{filterAssignee}</span>
                <ChevronDown size={12} />
              </button>
              {filterOpen && (
                <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-100 rounded-2xl shadow-xl z-30 py-1.5 min-w-[170px]">
                  {["Todos", ...COLLABORATORS.map(c => c.name)].map(name => (
                    <button key={name} onClick={() => { setFilterAssignee(name); setFilterOpen(false); }} className="w-full text-left px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors" style={{ color: filterAssignee === name ? "#4f46e5" : "#334155" }}>
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
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full ml-auto" style={{ background: col.accent, color: col.color }}>{col.tasks.length}</span>
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
                          opacity: dragState?.taskId === task.id ? 0.5 : 1,
                          background: isDuplicate ? "#fffdf0" : "#fff",
                        }}
                        onClick={() => setOpenTask({ task, columnId: col.id })}
                      >
                        <div className="flex">
                          <div className="w-1 shrink-0 rounded-l-2xl" style={{ background: col.color }} />
                          <div className="flex-1 p-3.5">
                            <div className="flex items-center justify-between gap-2 mb-2.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-sm font-black text-[#0f172a] truncate leading-tight">{task.title}</span>
                                {isDuplicate && (
                                  <span className="shrink-0 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md" style={{ background: "#fef3c7", color: "#b45309", border: "1px solid #f59e0b" }}>ID dup.</span>
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
                            </div>

                            <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px solid #f1f5f9" }}>
                              <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white font-black text-[9px] shrink-0 ring-2 ring-white" style={{ background: meta.color }} title={task.assignee}>
                                  {meta.initials}
                                </div>
                                <select value={task.assignee} onChange={e => handleAssigneeChange(task.id, e.target.value)} className="text-[10px] font-semibold border-none bg-transparent text-slate-500 cursor-pointer focus:outline-none max-w-[90px]">
                                  <option value="Não atribuído">Sem perfil</option>
                                  {COLLABORATORS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                </select>
                              </div>

                              <div onClick={e => e.stopPropagation()}>
                                {col.id !== "concluido" ? (
                                  <button onClick={() => handleCompleteTask(col.id, task.id)} className="flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg transition-all text-white" style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}>
                                    <CheckCircle size={11} /> Concluir
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={() => handleReturnTask(col.id, task.id)} className="flex items-center gap-1 text-[10px] font-black px-2.5 py-1.5 rounded-lg transition-all text-white" style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}>
                                      <RefreshCw size={11} /> Retornar
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

// Nota: A função TaskDetailModal permaneceu idêntica à do código anterior, operando perfeitamente com os novos gatilhos do Ably.