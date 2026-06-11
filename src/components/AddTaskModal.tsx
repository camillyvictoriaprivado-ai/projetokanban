import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import type { KanbanTask, TaskStep, Priority } from "./KanbanCard";

interface AddTaskModalProps {
  columnId: string;
  columnTitle: string;
  collaborators: { name: string; initials: string; color: string }[];
  onAdd: (columnId: string, task: KanbanTask) => void;
  onClose: () => void;
}

// Gerador de ID temporário único para o React e para a Planilha
let idCounter = Math.floor(Math.random() * 9000) + 1000;
const uid = () => String(++idCounter);

export function AddTaskModal({ columnId, columnTitle, collaborators, onAdd, onClose }: AddTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIdx, setAssigneeIdx] = useState(0);
  const [priority, setPriority] = useState<Priority>("média");
  const [dueDate, setDueDate] = useState("");
  const [tags, setTags] = useState("");
  const [steps, setSteps] = useState<{ title: string; hours: string }[]>([{ title: "", hours: "" }]);

  const addStep = () => setSteps([...steps, { title: "", hours: "" }]);
  const removeStep = (i: number) => setSteps(steps.filter((_, idx) => idx !== i));
  
  const updateStep = (i: number, field: "title" | "hours", val: string) => {
    const next = [...steps];
    next[i] = { ...next[i], [field]: val };
    setSteps(next);
  };

  const handleSubmit = () => {
    if (!title.trim()) return;

    const coll = collaborators[assigneeIdx];
    
    // Transforma o formato de data do input (input type="date" devolve YYYY-MM-DD)
    // para o formato aceito e calculado no seu App.tsx (DD/MM/YYYY)
    let formattedDate = "—";
    if (dueDate) {
      const dateParts = dueDate.split("-");
      if (dateParts.length === 3) {
        formattedDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
      }
    }

    // Filtra e prepara as etapas para evitar sub-etapas vazias e nulas
    const taskSteps: TaskStep[] = steps
      .filter((s) => s.title.trim() !== "")
      .map((s) => ({
        id: uid(),
        title: s.title,
        status: "pending",
        estimatedHours: s.hours ? Number(s.hours) : undefined,
      }));

    // Monta a estrutura correta idêntica ao que a interface KanbanTask pede
    const newTask: KanbanTask = {
      id: uid(),
      title,
      description,
      assignee: coll.name,
      assigneeInitials: coll.initials,
      assigneeColor: coll.color,
      priority,
      dueDate: formattedDate,
      steps: taskSteps,
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    };

    // Envia os dados estruturados para o App.tsx disparar a API
    onAdd(columnId, newTask);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Cabeçalho */}
        <div className="px-6 py-4 border-b border-[#dde3f0] flex justify-between items-center bg-[#f0f4ff]">
          <div>
            <h3 className="text-base font-bold text-[#1a2340]">Nova Atividade</h3>
            <p className="text-xs text-[#6b7a99]">Adicionando em: <span className="font-semibold text-[#1a56db]">{columnTitle}</span></p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#dde3f0] text-[#6b7a99] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Corpo do Formulário */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4" style={{ scrollbarWidth: "thin" }}>
          <div>
            <label className="block text-xs font-bold text-[#1a2340] uppercase tracking-wider mb-1">Título da Atividade *</label>
            <input 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              placeholder="Digite o nome da tarefa..." 
              maxLength={80}
              className="w-full px-3 py-2 text-sm border border-[#dde3f0] rounded-lg bg-[#f0f4ff] text-[#1a2340] placeholder:text-[#6b7a99] focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30" 
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1a2340] uppercase tracking-wider mb-1">Descrição</label>
            <textarea 
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              placeholder="Detalhes sobre a atividade..." rows={3}
              className="w-full px-3 py-2 text-sm border border-[#dde3f0] rounded-lg bg-[#f0f4ff] text-[#1a2340] placeholder:text-[#6b7a99] focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30 resize-none" 
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#1a2340] uppercase tracking-wider mb-1">Responsável</label>
              <select 
                value={assigneeIdx} 
                onChange={(e) => setAssigneeIdx(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-[#dde3f0] rounded-lg bg-[#f0f4ff] text-[#1a2340] focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30 cursor-pointer"
              >
                {collaborators.map((c, idx) => (
                  <option key={c.name} value={idx}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#1a2340] uppercase tracking-wider mb-1">Prioridade</label>
              <select 
                value={priority} 
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full px-3 py-2 text-sm border border-[#dde3f0] rounded-lg bg-[#f0f4ff] text-[#1a2340] focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30 cursor-pointer"
              >
                <option value="baixa">Baixa 🟢</option>
                <option value="média">Média 🟡</option>
                <option value="alta">Alta 🔴</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#1a2340] uppercase tracking-wider mb-1">Data de Entrega</label>
              <input 
                type="date" 
                value={dueDate} 
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#dde3f0] rounded-lg bg-[#f0f4ff] text-[#1a2340] focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30" 
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#1a2340] uppercase tracking-wider mb-1">Tags (separadas por vírgula)</label>
              <input 
                value={tags} 
                onChange={(e) => setTags(e.target.value)} 
                placeholder="Ex: Urgente, Revisão, Faturamento"
                className="w-full px-3 py-2 text-sm border border-[#dde3f0] rounded-lg bg-[#f0f4ff] text-[#1a2340] placeholder:text-[#6b7a99] focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30" 
              />
            </div>
          </div>

          {/* Seção Dinâmica de Etapas / Checklist */}
          <div className="pt-2">
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-bold text-[#1a2340] uppercase tracking-wider">Etapas da Atividade (Checklist)</label>
              <button 
                onClick={addStep} 
                className="flex items-center gap-1 text-xs font-bold text-[#1a56db] hover:text-[#1a56db]/80 transition-colors"
              >
                <Plus size={14} /> Adicionar Etapa
              </button>
            </div>
            
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-2 items-center animate-fade-in">
                  <input 
                    value={step.title} 
                    onChange={(e) => updateStep(i, "title", e.target.value)} 
                    placeholder={`Ex: Etapa ${i + 1}`}
                    className="flex-1 px-3 py-1.5 text-sm border border-[#dde3f0] rounded-lg bg-[#f0f4ff] text-[#1a2340] placeholder:text-[#6b7a99] focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30" 
                  />
                  <input 
                    value={step.hours} 
                    onChange={(e) => updateStep(i, "hours", e.target.value)} 
                    placeholder="Horas" 
                    type="number" 
                    min={0}
                    className="w-20 px-2 py-1.5 text-sm border border-[#dde3f0] rounded-lg bg-[#f0f4ff] text-[#1a2340] text-center focus:outline-none focus:ring-2 focus:ring-[#1a56db]/30" 
                  />
                  {steps.length > 1 && (
                    <button 
                      onClick={() => removeStep(i)} 
                      className="p-1.5 rounded-lg text-[#6b7a99] hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Rodapé / Ações */}
        <div className="px-6 py-4 border-t border-[#dde3f0] flex gap-3 justify-end bg-gray-50">
          <button 
            onClick={onClose} 
            className="px-4 py-2 text-sm border border-[#dde3f0] rounded-lg text-[#6b7a99] bg-white hover:bg-[#eef1f8] transition-colors"
          >
            Cancelar
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={!title.trim()}
            className={`px-4 py-2 text-sm font-semibold rounded-lg text-white shadow-md transition-all ${
              title.trim() 
                ? "bg-[#f97316] hover:bg-[#e06613] active:scale-95 cursor-pointer" 
                : "bg-gray-300 cursor-not-allowed shadow-none"
            }`}
          >
            Criar Atividade
          </button>
        </div>

      </div>
    </div>
  );
}