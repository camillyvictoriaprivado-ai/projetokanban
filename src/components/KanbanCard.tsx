import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, CheckCircle2, Circle, AlertCircle, Calendar } from "lucide-react";

export type StepStatus = "pending" | "in_progress" | "done" | "blocked";
export type Priority = "alta" | "média" | "baixa";

export interface TaskStep {
  id: string;
  title: string;
  status: StepStatus;
  estimatedHours?: number;
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  assignee: string;
  assigneeInitials: string;
  assigneeColor: string;
  priority: Priority;
  dueDate: string;
  steps: TaskStep[];
  tags: string[];
}

const stepStatusConfig: Record<StepStatus, { label: string; icon: React.ReactNode; color: string }> = {
  pending: { label: "Pendente", icon: <Circle size={14} />, color: "text-[#6b7a99]" },
  in_progress: { label: "Em andamento", icon: <Clock size={14} />, color: "text-[#f97316]" },
  done: { label: "Concluído", icon: <CheckCircle2 size={14} />, color: "text-[#16a34a]" },
  blocked: { label: "Bloqueado", icon: <AlertCircle size={14} />, color: "text-[#e53e3e]" },
};

const priorityConfig: Record<Priority, { label: string; bg: string; text: string }> = {
  alta: { label: "Alta", bg: "bg-red-50", text: "text-red-600" },
  média: { label: "Média", bg: "bg-orange-50", text: "text-orange-600" },
  baixa: { label: "Baixa", bg: "bg-blue-50", text: "text-blue-600" },
};

export function KanbanCard({ task, onStatusChange }: { task: KanbanTask; onStatusChange?: (taskId: string, stepId: string, status: StepStatus) => void }) {
  const [expanded, setExpanded] = useState(false);
  const completedSteps = task.steps.filter((s) => s.status === "done").length;
  const progress = task.steps.length > 0 ? Math.round((completedSteps / task.steps.length) * 100) : 0;

  return (
    <div className="bg-white rounded-xl border border-[#dde3f0] shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
      <div className={`h-1 w-full ${task.priority === "alta" ? "bg-red-500" : task.priority === "média" ? "bg-[#f97316]" : "bg-[#1a56db]"}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-[#1a2340] leading-snug flex-1">{task.title}</h3>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${priorityConfig[task.priority].bg} ${priorityConfig[task.priority].text}`}>
            {priorityConfig[task.priority].label}
          </span>
        </div>
        <p className="text-xs text-[#6b7a99] mb-3 leading-relaxed line-clamp-2">{task.description}</p>
        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {task.tags.map((tag) => (
              <span key={tag} className="text-xs px-2 py-0.5 bg-[#eef1f8] text-[#6b7a99] rounded-md">{tag}</span>
            ))}
          </div>
        )}
        {task.steps.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[#6b7a99]">Etapas: {completedSteps}/{task.steps.length}</span>
              <span className="text-xs font-semibold text-[#1a56db]">{progress}%</span>
            </div>
            <div className="h-1.5 bg-[#eef1f8] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%`, background: progress === 100 ? "#16a34a" : "linear-gradient(90deg, #1a56db, #f97316)" }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: task.assigneeColor }}>
              {task.assigneeInitials}
            </div>
            <span className="text-xs text-[#6b7a99] truncate max-w-[100px]">{task.assignee}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-[#6b7a99]">
              <Calendar size={11} />
              <span>{task.dueDate}</span>
            </div>
            {task.steps.length > 0 && (
              <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-0.5 text-xs text-[#1a56db] hover:text-[#f97316] transition-colors">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>Etapas</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {expanded && task.steps.length > 0 && (
        <div className="border-t border-[#dde3f0] bg-[#f5f6fa] px-4 py-3 space-y-1.5">
          {task.steps.map((step) => {
            const cfg = stepStatusConfig[step.status];
            return (
              <div key={step.id} className="flex items-center gap-2 group">
                <span className={`shrink-0 ${cfg.color}`}>{cfg.icon}</span>
                <span className={`text-xs flex-1 ${step.status === "done" ? "line-through text-[#6b7a99]" : "text-[#1a2340]"}`}>{step.title}</span>
                {step.estimatedHours && <span className="text-xs text-[#6b7a99] shrink-0">{step.estimatedHours}h</span>}
                <select
                  value={step.status}
                  onChange={(e) => onStatusChange?.(task.id, step.id, e.target.value as StepStatus)}
                  className="text-xs border border-[#dde3f0] rounded px-1 py-0.5 bg-white text-[#1a2340] cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <option value="pending">Pendente</option>
                  <option value="in_progress">Em andamento</option>
                  <option value="done">Concluído</option>
                  <option value="blocked">Bloqueado</option>
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}