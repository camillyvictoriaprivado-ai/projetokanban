import { useState, useMemo, useEffect, useCallback, useRef, Component } from "react";
import { Realtime } from "ably";
import {
  LayoutGrid, Users, BarChart3, Settings, Search, Filter, ChevronDown,
  Menu, CheckCircle, X, Plus, Trash2, ChevronRight, Calendar, User,
  Tag, FileText, ClipboardList, MessageSquare, Circle, CheckCircle2,
  RefreshCw, AlertCircle, Zap, Package, Mail, Lock, ShieldCheck, LogOut,
  Download, Upload
} from "lucide-react";

const API_URL = "https://script.google.com/macros/s/AKfycbzRN6LZWIgtuZ7IXkuc4-zP-vOoFSmeqQPEAYpzuVgdEGQX9eCiLIMAd2jWFZgoy9SdFA/exec";

// ─── ERROR BOUNDARY ───
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Render crash:", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center flex-col gap-4" style={{ background: "#0f172a" }}>
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}>
            <span className="text-white font-black text-sm">!</span>
          </div>
          <div className="text-center px-6">
            <p className="text-white font-bold text-sm mb-1">Algo deu errado</p>
            <p className="text-slate-500 text-xs mb-4 font-mono">{this.state.error?.message}</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="px-5 py-2 rounded-xl text-white text-sm font-bold"
              style={{ background: "#4f46e5" }}
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── CONFIGURAÇÃO DO ABLY ───
const ABLY_API_KEY = "BUp6Lg.QfvVuw:DBQaijX7rEyBdz4A1dXnrDXE68wWcCWkQTUG_BLSk9E"; 
const ABLY_CHANNEL_NAME = "kanban-live";

const LS_ANNOTATIONS_KEY = "tlp_kanban_annotations_v3"; 
const LS_COLUMNS_KEY     = "tlp_kanban_columns_v3";     
const LS_PENDING_KEY     = "tlp_kanban_pending_v3";     
const LS_DELETED_KEY     = "tlp_kanban_deleted_v3";     
const LS_SESSION_KEY     = "tlp_kanban_session_v1";      
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
interface Subtask { id: string; title: string; colaborador: string; status: SubtaskStatus; }
interface Annotation { id: string; text: string; createdAt: string; }
interface Step { id: string; label: string; status: StepStatus; }

interface KanbanTask {
  id: string; title: string; ionix: string; cluster: string; uf: string;
  material: string; quantidade: string; description: string; colaborador: string; 
  colaboradorInitials: string; colaboradorColor: string; priority: Priority; dueDate: string; 
  steps: Step[]; tags: string[]; checklist: ChecklistItem[]; subtasks: Subtask[]; 
  annotations: Annotation[]; previousColumnId?: string;
  rowkey?: string; 
  sourceColumn?: string; 
  codigoMaterial?: string; 
  saldoEstoque?: string | number; 
}

interface Column { id: string; title: string; color: string; accent: string; tasks: KanbanTask[]; }

function getPersistKey(task: KanbanTask): string {
  if (task.rowkey) return `task:rk${task.rowkey}`;
  return `task:${task.sourceColumn ?? "unknown"}:${task.title}`;
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

// ─── COMPONENTE FORMULÁRIO DE REQUISIÇÃO DE MATERIAL ───
interface RequisicaoItem {
  codigoOriginal: string;
  codigoSubstituto: string;
  quantidade: number;
}

function FormularioRequisicaoMaterial({ task, onRequisicaoRegistrada }: { task: KanbanTask; onRequisicaoRegistrada: () => void }) {
  const [itens, setItens] = useState<RequisicaoItem[]>([{ codigoOriginal: task.codigoMaterial || "", codigoSubstituto: "", quantidade: 1 }]);
  const [observacoes, setObservacoes] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Catálogo completo (aba "codigo") — inclui materiais sem estoque
  const [catalogoMateriais, setCatalogoMateriais] = useState<{ codigo: string; material: string }[]>([]);
  // Estoque para o select de substituto
  const [listaEstoque, setListaEstoque] = useState<EstoqueEntry[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch(API_URL)
      .then(r => r.text())
      .then(text => {
        if (!text.trim().startsWith("{")) return;
        const data = JSON.parse(text);

        // Aba "codigo" → catálogo completo para "material que faltou"
        const codigoKey = Object.keys(data).find(k => k.toLowerCase() === "codigo");
        const rawCodigo = codigoKey ? data[codigoKey] : [];
        if (Array.isArray(rawCodigo)) {
          const mapped = rawCodigo
            .map((r: any) => {
              const codigo   = String(r.codigo   ?? r.Codigo   ?? r.CODIGO   ?? "").trim();
              const material = String(r.descricao ?? r.Descricao ?? r.DESCRICAO ?? r.material ?? r.Material ?? r.MATERIAL ?? "").trim();
              return { codigo, material };
            })
            .filter(r => r.codigo && r.material);
          setCatalogoMateriais(mapped.sort((a, b) => a.material.localeCompare(b.material)));
        }

        // Aba "estoque" → para o select de substituto (com saldo visível)
        const estoqueKey = Object.keys(data).find(k => k.toLowerCase() === "estoque");
        const rawEstoque = estoqueKey ? data[estoqueKey] : [];
        if (Array.isArray(rawEstoque)) {
          setListaEstoque(rawEstoque.map((r: any) => ({
            codigo:   String(r.codigo   ?? r.Codigo   ?? r.CODIGO   ?? ""),
            material: String(r.material ?? r.Material ?? r.MATERIAL ?? ""),
            saldo:    Number(r.saldo    ?? r.Saldo    ?? r.SALDO    ?? 0),
            cluster:  String(r.cluster  ?? r.Cluster  ?? r.CLUSTER  ?? "—"),
            centro:   String(r.centro   ?? r.Centro   ?? r.CENTRO   ?? "—"),
          })));
        }
      })
      .catch(err => console.error("Erro ao carregar dados:", err))
      .finally(() => setCarregando(false));
  }, []);

  // Substituto: todos do estoque agrupados por código (qualquer cluster)
  const materiaisSubstituto = useMemo<MaterialDoCluster[]>(() => {
    const grouped: Record<string, MaterialDoCluster> = {};
    listaEstoque.forEach(e => {
      const key = e.codigo.trim().toLowerCase();
      if (!key) return;
      if (!grouped[key]) grouped[key] = { codigo: e.codigo, material: e.material, saldoTotal: 0, centros: [] };
      grouped[key].saldoTotal += e.saldo;
      grouped[key].centros.push({ centro: e.centro, saldo: e.saldo });
    });
    return Object.values(grouped).sort((a, b) => a.material.localeCompare(b.material));
  }, [listaEstoque]);

  const handleAdicionarItem = () => setItens([...itens, { codigoOriginal: "", codigoSubstituto: "", quantidade: 1 }]);
  const handleRemoverItem = (index: number) => setItens(itens.filter((_, i) => i !== index));
  const handleItemChange = (index: number, campo: keyof RequisicaoItem, valor: any) => {
    const novos = [...itens];
    novos[index] = { ...novos[index], [campo]: valor };
    setItens(novos);
  };

  const handleEnviarRequisicao = async () => {
    if (itens.some(i => !i.codigoOriginal.trim())) { alert("Selecione o material requisitado em todos os itens."); return; }
    if (itens.some(i => !i.codigoSubstituto.trim())) { alert("Selecione o material substituto em todos os itens."); return; }
    if (itens.some(i => i.quantidade <= 0)) { alert("A quantidade deve ser maior que zero em todos os itens."); return; }

    setEnviando(true);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "registrarRequisicaoMaterial",
          id_tarefa: task.title,
          ionix: task.ionix || "",
          cluster: task.cluster || "—",
          colaborador: task.colaborador || "",
          observacoes: observacoes.trim(),
          itens: itens.map(i => {
            const original   = catalogoMateriais.find(m => m.codigo.toLowerCase() === i.codigoOriginal.trim().toLowerCase());
            const substituto = materiaisSubstituto.find(m => m.codigo.toLowerCase() === i.codigoSubstituto.trim().toLowerCase());
            return {
              codigoOriginal:     i.codigoOriginal,
              materialOriginal:   original?.material   ?? "—",
              codigoSubstituto:   i.codigoSubstituto,
              materialSubstituto: substituto?.material ?? "—",
              quantidade:         i.quantidade,
            };
          }),
        }),
      });

      const text = await response.text();
      let resData;
      try { resData = JSON.parse(text); } catch { throw new Error("Resposta do servidor inválida."); }

      if (resData.status === "success") {
        alert("Requisição registrada com sucesso! O almoxarifado foi notificado.");
        onRequisicaoRegistrada();
      } else {
        alert("Erro no backend: " + (resData.message || "Falha desconhecida"));
      }
    } catch (error: any) {
      alert("Falha ao salvar: " + error.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho informativo */}
      <div className="rounded-2xl p-4 border border-amber-100 bg-amber-50/60">
        <div className="flex items-start gap-3">
          <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-black text-amber-900 mb-0.5">Requisição de Material</h3>
            <p className="text-xs text-amber-700 leading-relaxed">
              Use quando o material necessário <strong>não está disponível</strong> e você precisou substituí-lo. 
              Isso permite que o almoxarifado acompanhe quais materiais são mais demandados.
            </p>
          </div>
        </div>
      </div>

      {/* Lista de itens */}
      <div className="space-y-3">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Itens Requisitados</label>

        {!carregando && catalogoMateriais.length === 0 && (
          <div className="flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="shrink-0" /> Nenhum material encontrado na aba código.
          </div>
        )}

        {itens.map((item, index) => {
          const original   = catalogoMateriais.find(m => m.codigo.toLowerCase() === item.codigoOriginal.trim().toLowerCase());
          const substituto = materiaisSubstituto.find(m => m.codigo.toLowerCase() === item.codigoSubstituto.trim().toLowerCase());

          return (
            <div key={index} className="p-3.5 border border-slate-100 rounded-2xl space-y-3 bg-white shadow-sm">
              {/* Cabeçalho do item */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Item {index + 1}</span>
                {itens.length > 1 && (
                  <button type="button" onClick={() => handleRemoverItem(index)} className="p-1.5 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Material original (que faltou) */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-rose-400 block">
                  Material Requisitado (que faltou)
                </label>
                <select
                  value={item.codigoOriginal}
                  onChange={e => handleItemChange(index, "codigoOriginal", e.target.value)}
                  disabled={carregando || catalogoMateriais.length === 0}
                  className="w-full text-sm px-4 py-2.5 rounded-xl border border-rose-100 bg-rose-50/40 font-bold text-[#0f172a] focus:outline-none focus:border-rose-400 disabled:opacity-60"
                >
                  <option value="">{carregando ? "Carregando..." : "Selecione o material necessário..."}</option>
                  {catalogoMateriais.map(m => (
                    <option key={m.codigo} value={m.codigo}>
                      {m.material} — {m.codigo}
                    </option>
                  ))}
                </select>
                {original && (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold px-1 flex-wrap">
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 text-rose-500">
                      ✅ {original.material}
                    </span>
                  </div>
                )}
              </div>

              {/* Material substituto (o que foi usado) */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-emerald-500 block">
                  Material Substituto (o que foi usado)
                </label>
                <select
                  value={item.codigoSubstituto}
                  onChange={e => handleItemChange(index, "codigoSubstituto", e.target.value)}
                  disabled={carregando || materiaisSubstituto.length === 0}
                  className="w-full text-sm px-4 py-2.5 rounded-xl border border-emerald-100 bg-emerald-50/40 font-bold text-[#0f172a] focus:outline-none focus:border-emerald-400 disabled:opacity-60"
                >
                  <option value="">{carregando ? "Carregando..." : "Selecione o substituto utilizado..."}</option>
                  {materiaisSubstituto.map(m => (
                    <option key={m.codigo} value={m.codigo}>
                      {m.material} — {m.codigo} ({m.saldoTotal > 0 ? `${m.saldoTotal} em estoque` : "sem estoque"})
                    </option>
                  ))}
                </select>
                {substituto && (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold px-1 flex-wrap">
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${substituto.saldoTotal > 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>
                      {substituto.saldoTotal > 0 ? "✅" : "⚠️"} Saldo: {substituto.saldoTotal}
                    </span>
                  </div>
                )}
              </div>

              {/* Quantidade */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Quantidade Necessária</label>
                <input
                  type="number"
                  min="1"
                  value={item.quantidade}
                  onChange={e => handleItemChange(index, "quantidade", Number(e.target.value))}
                  className="w-full text-sm px-4 py-2.5 rounded-xl border border-slate-200 bg-white font-bold text-[#0f172a] focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={handleAdicionarItem}
          disabled={catalogoMateriais.length === 0}
          className="flex items-center gap-1 text-xs font-black text-amber-600 border border-dashed border-amber-200 hover:bg-amber-50 px-3 py-2 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={14} /> Adicionar outro item
        </button>
      </div>

      {/* Observações */}
      <div>
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Observações</label>
        <textarea
          value={observacoes}
          onChange={e => setObservacoes(e.target.value)}
          placeholder="Ex: material original sem previsão de reposição, substituto aprovado pelo supervisor..."
          rows={2}
          className="w-full text-sm px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-amber-400 resize-none"
        />
      </div>

      <button
        onClick={handleEnviarRequisicao}
        disabled={enviando || catalogoMateriais.length === 0}
        className="w-full flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-2xl text-white transition-all shadow-md hover:opacity-90 disabled:bg-slate-300 disabled:cursor-not-allowed"
        style={{ background: "linear-gradient(135deg, #d97706, #b45309)" }}
      >
        {enviando
          ? <><RefreshCw size={14} className="animate-spin" /> Registrando...</>
          : <><Upload size={14} /> Registrar Requisição no Almoxarifado</>
        }
      </button>
    </div>
  );
}

// ─── COMPONENTE FORMULÁRIO DE CONSUMO DE MATERIAL (ATUALIZADO COM MULTI-ITENS E AUTOCOMPLETE) ───
interface ConsumoItem {
  codigo: string;
  quantidade: number;
}

interface ConsumoItem {
  codigo: string;
  quantidade: number;
}

interface EstoqueEntry { codigo: string; material: string; saldo: number; cluster: string; centro: string; }
interface MaterialDoCluster { codigo: string; material: string; saldoTotal: number; centros: { centro: string; saldo: number }[]; }

function FormularioConsumoMaterial({ task, onConsumoRegistrado, registrosExistentes, onIrParaRequisicao }: { task: KanbanTask, onConsumoRegistrado: () => void, registrosExistentes: RespostaItem[] | null, onIrParaRequisicao?: () => void }) {
  const jaRegistrado = !!registrosExistentes && registrosExistentes.length > 0;
  const [itens, setItens] = useState<ConsumoItem[]>([{ codigo: task.codigoMaterial || "", quantidade: 1 }]);
  const [observacoes, setObservacoes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [consumoRegistradoAgora, setConsumoRegistradoAgora] = useState(false);

  // Lista completa do estoque (todos os clusters), com centro incluído
  const [listaEstoque, setListaEstoque] = useState<EstoqueEntry[]>([]);
  const [carregandoEstoque, setCarregandoEstoque] = useState(true);

  useEffect(() => {
    fetch(API_URL)
      .then(r => r.text())
      .then(text => {
        if (text.trim().startsWith("{")) {
          const data = JSON.parse(text);
          const estoqueKey = Object.keys(data).find(k => k.toLowerCase() === "estoque");
          const raw = estoqueKey ? data[estoqueKey] : [];
          if (Array.isArray(raw)) {
            setListaEstoque(raw.map((r: any) => ({
              codigo:   String(r.codigo   ?? r.Codigo   ?? r.CODIGO   ?? ""),
              material: String(r.material ?? r.Material ?? r.MATERIAL ?? ""),
              saldo:    Number(r.saldo    ?? r.Saldo    ?? r.SALDO    ?? 0),
              cluster:  String(r.cluster  ?? r.Cluster  ?? r.CLUSTER  ?? "—"),
              centro:   String(r.centro   ?? r.Centro   ?? r.CENTRO   ?? "—"),
            })));
          }
        }
      })
      .catch(err => console.error("Erro ao puxar lista de estoque:", err))
      .finally(() => setCarregandoEstoque(false));
  }, []);

  // Apenas os materiais do MESMO cluster da tarefa, agrupados por código
  // (um código pode existir em mais de um centro dentro do mesmo cluster)
  const materiaisDoCluster = useMemo<MaterialDoCluster[]>(() => {
    const norm = (s: string) => (s || "").trim().toLowerCase();
    const doCluster = listaEstoque.filter(e => norm(e.cluster) === norm(task.cluster || ""));
    const grouped: Record<string, MaterialDoCluster> = {};
    doCluster.forEach(e => {
      const key = e.codigo.trim().toLowerCase();
      if (!key) return;
      if (!grouped[key]) grouped[key] = { codigo: e.codigo, material: e.material, saldoTotal: 0, centros: [] };
      grouped[key].saldoTotal += e.saldo;
      grouped[key].centros.push({ centro: e.centro, saldo: e.saldo });
    });
    return Object.values(grouped).sort((a, b) => a.material.localeCompare(b.material));
  }, [listaEstoque, task.cluster]);

  const handleAdicionarMaterial = () => setItens([...itens, { codigo: "", quantidade: 1 }]);
  const handleRemoverMaterial = (index: number) => setItens(itens.filter((_, i) => i !== index));
  const handleItemChange = (index: number, campo: keyof ConsumoItem, valor: any) => {
    const novosItens = [...itens];
    novosItens[index] = { ...novosItens[index], [campo]: valor };
    setItens(novosItens);
  };

  const handleEnviarConsumo = async () => {
    if (itens.some(i => !i.codigo.trim())) { alert("Por favor, selecione o material em todos os itens."); return; }
    if (itens.some(i => i.quantidade <= 0)) { alert("A quantidade de todos os materiais deve ser maior que zero."); return; }

    setEnviando(true);
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "registrarRespostaMaterial",
          id_tarefa: task.title,
          ionix: task.ionix || "",
          cluster: task.cluster || "—",
          colaborador: task.colaborador || "",
          observacoes: observacoes.trim(),
          itens: itens // Enviando o array de itens corretamente
        }),
      });

      const text = await response.text();
      let resData;
      try { resData = JSON.parse(text); } catch { throw new Error("Resposta do servidor inválida."); }

      if (resData.status === "success") {
        let msg = "Consumo registrado com sucesso! O estoque de todos os itens foi recalculado.";
        if (Array.isArray(resData.avisos) && resData.avisos.length) {
          msg += "\n\nAtenção:\n" + resData.avisos.join("\n");
        }
        alert(msg);
        setConsumoRegistradoAgora(true);
        onConsumoRegistrado();
      } else {
        alert("Erro no backend: " + (resData.message || "Falha desconhecida"));
      }
    } catch (error: any) {
      alert("Falha ao salvar no banco de dados: " + error.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4">
      {jaRegistrado && registrosExistentes && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 overflow-hidden">
          <div className="flex items-start gap-3 px-4 pt-4 pb-3">
            <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-rose-700">Material já registrado para este ID</p>
              <p className="text-xs text-rose-500 mt-0.5">
                O ID <strong>{task.title}</strong> já consta na aba Respostas. Novos registros estão bloqueados para evitar duplicidade.
              </p>
            </div>
          </div>
          <div className="border-t border-rose-100 px-4 py-3 space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-2">O que foi cadastrado</p>
            {registrosExistentes.map((reg, i) => (
              <div key={i} className="rounded-xl bg-white border border-rose-100 px-3.5 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-black text-[#0f172a] truncate max-w-[60%]">{reg.material}</span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-rose-100 text-rose-600">- {reg.quantidade}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {reg.codigo !== "—" && (
                    <span className="text-[10px] text-slate-500 font-mono">Cód: <strong>{reg.codigo}</strong></span>
                  )}
                  {reg.centro !== "—" && (
                    <span className="text-[10px] text-slate-500">Centro: <strong>{reg.centro}</strong></span>
                  )}
                  {reg.colaborador !== "—" && (
                    <span className="text-[10px] text-slate-500">Por: <strong>{reg.colaborador}</strong></span>
                  )}
                  {reg.timestamp !== "—" && (
                    <span className="text-[10px] text-slate-400 font-mono">{reg.timestamp}</span>
                  )}
                </div>
                {reg.observacoes && (
                  <p className="text-[10px] text-slate-400 italic border-t border-rose-50 pt-1.5">{reg.observacoes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={jaRegistrado ? "opacity-40 pointer-events-none select-none" : ""}>
      <div className="rounded-2xl p-4 border border-indigo-100 bg-indigo-50/50">
        <h3 className="text-sm font-black text-indigo-900 mb-1">Registrar Uso na Tarefa</h3>
        <p className="text-xs text-indigo-600">
          Apenas materiais do cluster <strong>{task.cluster || "—"}</strong> são exibidos abaixo. O sistema recalculará o estoque de cada item listado.
        </p>
      </div>

      <div className="space-y-3">
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Lista de Materiais</label>

        {!carregandoEstoque && materiaisDoCluster.length === 0 && (
          <div className="flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="shrink-0" /> Nenhum material cadastrado no estoque para o cluster "{task.cluster}".
          </div>
        )}

        {itens.map((item, index) => {
          const selecionado = materiaisDoCluster.find(m => m.codigo.toLowerCase() === item.codigo.trim().toLowerCase());
          const temEstoque = !!selecionado && selecionado.saldoTotal > 0;

          return (
            <div key={index} className="p-3 border border-slate-100 bg-slate-50/50 rounded-xl space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <select
                    value={item.codigo}
                    onChange={(e) => handleItemChange(index, "codigo", e.target.value)}
                    disabled={carregandoEstoque || materiaisDoCluster.length === 0}
                    className="w-full text-sm px-4 py-2.5 rounded-xl border border-slate-200 bg-white font-bold text-[#0f172a] focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                  >
                    <option value="">{carregandoEstoque ? "Carregando estoque..." : "Selecione um material..."}</option>
                    {materiaisDoCluster.map(m => (
                      <option key={m.codigo} value={m.codigo}>
                        {m.material} — {m.codigo} ({m.saldoTotal > 0 ? `${m.saldoTotal} em estoque` : "sem estoque"})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <input
                    type="number"
                    min="1"
                    value={item.quantidade}
                    onChange={(e) => handleItemChange(index, "quantidade", Number(e.target.value))}
                    placeholder="Qtd"
                    className="w-full text-sm px-4 py-2.5 rounded-xl border border-slate-200 bg-white font-bold text-[#0f172a] focus:outline-none focus:border-indigo-500"
                  />
                </div>
                {itens.length > 1 && (
                  <button type="button" onClick={() => handleRemoverMaterial(index)} className="p-2.5 text-rose-500 hover:bg-rose-100 rounded-xl transition-colors border border-transparent">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {/* Visor de Saldo / Centro, já filtrado pelo cluster da tarefa */}
              {selecionado && (
                <div className="flex items-center gap-2 text-[10px] font-bold px-1 pt-1 flex-wrap">
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${temEstoque ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>
                    {temEstoque ? "✅ Possui saldo" : "❌ Sem saldo"} ({selecionado.saldoTotal})
                  </span>
                  <span className="text-slate-400 border-l border-slate-300 pl-2 shrink-0">
                    {selecionado.centros.length === 1
                      ? `Centro: ${selecionado.centros[0].centro}`
                      : `Centros: ${selecionado.centros.map(c => `${c.centro} (${c.saldo})`).join(", ")}`}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        <button type="button" onClick={handleAdicionarMaterial} disabled={materiaisDoCluster.length === 0} className="flex items-center gap-1 text-xs font-black text-indigo-500 border border-dashed border-indigo-200 hover:bg-indigo-50 px-3 py-2 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          <Plus size={14} /> Adicionar mais um item
        </button>
      </div>

      <div>
        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Observações adicionais</label>
        <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Opcional..." rows={2} className="w-full text-sm px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:border-indigo-500 resize-none" />
      </div>
      <button onClick={handleEnviarConsumo} disabled={enviando || materiaisDoCluster.length === 0 || jaRegistrado} className="w-full flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-2xl text-white transition-all shadow-md hover:opacity-90 disabled:bg-slate-300 disabled:cursor-not-allowed" style={{ background: jaRegistrado ? "#94a3b8" : "linear-gradient(135deg, #4f46e5, #7c3aed)" }}>
        {enviando ? <><RefreshCw size={14} className="animate-spin" /> Registrando no Servidor...</> : jaRegistrado ? "Cadastro bloqueado — já registrado" : "Confirmar e Dar Baixa no Estoque"}
      </button>
      </div>

      {/* Botão para ir à requisição após cadastrar — ou se já registrado */}
      {(consumoRegistradoAgora || jaRegistrado) && onIrParaRequisicao && (
        <div className="rounded-2xl p-4 border border-amber-100 bg-amber-50/60 flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Upload size={15} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-amber-900">Precisa registrar uma requisição?</p>
              <p className="text-xs text-amber-700 mt-0.5">Se o material não estava disponível e foi substituído, registre a requisição.</p>
            </div>
          </div>
          <button
            onClick={onIrParaRequisicao}
            className="shrink-0 flex items-center gap-1.5 text-xs font-black px-4 py-2 rounded-xl text-white"
            style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
          >
            <Upload size={13} /> Ir para Requisição
          </button>
        </div>
      )}
    </div>
  );
}

function TaskDetailModal({
  task, columnId, onClose, onUpdate, onComplete, onRemove, onReturn, onMaterialRegistrado, idsComMaterialRegistrado,
}: {
  task: KanbanTask; columnId: string; onClose: () => void;
  onUpdate: (u: KanbanTask) => void;
  onComplete: (colId: string, taskId: string) => void;
  onRemove: (colId: string, taskId: string) => void;
  onReturn: (colId: string, taskId: string) => void;
  onMaterialRegistrado: () => void;
  idsComMaterialRegistrado: Record<string, RespostaItem[]>;
}) {
  const [local, setLocal] = useState<KanbanTask>({ ...task });
  const [activeTab, setActiveTab] = useState<"info" | "checklist" | "subtasks" | "notes" | "consumo" | "requisicao">("info");
  const [newCheckItem, setNewCheckItem] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newSubtask, setNewSubtask] = useState({ title: "", colaborador: "", status: "pendente" as SubtaskStatus });
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
    setNewSubtask({ title: "", colaborador: "", status: "pendente" });
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
    { id: "consumo" as const,    label: "Baixar Material",  icon: <Package size={13} /> },
    { id: "requisicao" as const, label: "Requisição",        icon: <Upload size={13} /> },
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
                  ...(local.codigoMaterial !== undefined ? [{ icon: <Tag size={12} />, label: "Código", value: local.codigoMaterial }] : []),
                  ...(local.saldoEstoque !== undefined ? [{ icon: <BarChart3 size={12} />, label: "Saldo em Estoque", value: String(local.saldoEstoque) }] : []),
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
                      value={local.colaborador}
                      onChange={e => { const m = getCollabMeta(e.target.value); save({ ...local, colaborador: e.target.value, colaboradorInitials: m.initials, colaboradorColor: m.color }); }}
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
                        <p className="text-xs text-[#94a3b8]">{sub.colaborador || "Sem responsável"}</p>
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

          {activeTab === "consumo" && (
            <FormularioConsumoMaterial 
              task={local}
              registrosExistentes={idsComMaterialRegistrado[local.title.trim()] ?? null}
              onConsumoRegistrado={() => {
                onMaterialRegistrado();
              }}
              onIrParaRequisicao={() => setActiveTab("requisicao")}
            />
          )}

          {activeTab === "requisicao" && (
            <FormularioRequisicaoMaterial
              task={local}
              onRequisicaoRegistrada={() => {
                onClose();
                onMaterialRegistrado();
              }}
            />
          )}

        </div>
      </div>
    </div>
  );
}

// ─── TELA DE ESTOQUE (ATUALIZADO COM OPÇÃO DE IMPORTAR SALDOS NOVOS VIA CSV) ───
interface EstoqueItem {
  codigo: string;
  material: string;
  saldo: number | string;
  um: string;
  lote: string;
  centro: string;
  deposito: string;
  cluster: string;
}

function EstoqueView() {
  const [items, setItems] = useState<EstoqueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCluster, setFilterCluster] = useState("Todos");
  const [sortBy, setSortBy] = useState<"material" | "saldo" | "cluster">("material");
  const [sortAsc, setSortAsc] = useState(true);
  const [importando, setImportando] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const carregarEstoque = () => {
    setLoading(true);
    fetch(API_URL)
      .then(r => r.text())
      .then(text => {
        if (!text.trim().startsWith("{")) throw new Error("Resposta inválida da API");
        const data = JSON.parse(text);
        const estoqueKey = Object.keys(data).find(k => k.toLowerCase() === "estoque");
        const raw = estoqueKey ? data[estoqueKey] : [];
        
        if (!Array.isArray(raw) || raw.length === 0) {
          throw new Error(`A aba 'estoque' não foi localizada ou está vazia.`);
        }
        setItems(raw.map((r: any) => ({
          codigo:   String(r.codigo   ?? r.Codigo   ?? r.CODIGO   ?? "—"),
          material: String(r.material ?? r.Material ?? r.MATERIAL ?? "—"),
          saldo:    r.saldo    ?? r.Saldo    ?? r.SALDO    ?? 0,
          um:       String(r.um       ?? r.UM       ?? r.Um       ?? "—"),
          lote:     String(r.lote     ?? r.Lote     ?? r.LOTE     ?? "—"),
          centro:   String(r.centro   ?? r.Centro   ?? r.CENTRO   ?? "—"),
          deposito: String(r.deposito ?? r.Deposito ?? r.DEPOSITO ?? r.depósito ?? "—"),
          cluster:  String(r.cluster  ?? r.Cluster  ?? r.CLUSTER  ?? "—"),
        })));
        setError(null);
      })
      .catch(e => { console.error("❌ Erro estoque:", e); setError(e.message); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    carregarEstoque();
  }, []);

  const handleImportarCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;

    const leitor = new FileReader();
    leitor.onload = async (evento) => {
      const conteudoTexto = evento.target?.result as string;
      if (!conteudoTexto) return;

      setImportando(true);
      try {
        const linhas = conteudoTexto.split(/\r?\n/).filter(l => l.trim() !== "");
        if (linhas.length < 2) {
          alert("O arquivo fornecido está vazio ou não possui linhas de dados.");
          setImportando(false);
          return;
        }

        // Detecta se a tabela usa vírgula ou ponto e vírgula como separador
        const cabecalho = linhas[0];
        const separador = cabecalho.includes(";") ? ";" : ",";
        const colunasChave = cabecalho.split(separador).map(c => c.trim().toLowerCase());

        const listaMapeada = linhas.slice(1).map(linha => {
          const valores = linha.split(separador);
          const objetoMontado: any = {};
          colunasChave.forEach((chave, index) => {
            objetoMontado[chave] = valores[index] ? valores[index].trim() : "";
          });
          return objetoMontado;
        });

        // Envia o payload completo direto para a macro processar a substituição dos saldos
        const resposta = await fetch(API_URL, {
          method: "POST",
          body: JSON.stringify({
            action: "importarEstoque",
            dados: listaMapeada
          })
        });

        const dataRes = await resposta.json();
        if (dataRes.status === "success") {
          alert("Saldos e Inventário atualizados com sucesso!");
          carregarEstoque();
        } else {
          alert("Erro reportado pelo servidor: " + dataRes.message);
        }
      } catch (err: any) {
        alert("Ocorreu um erro ao processar seu arquivo CSV local: " + err.message);
      } finally {
        setImportando(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    leitor.readAsText(arquivo, "UTF-8");
  };

  const clusters = useMemo(() => ["Todos", ...Array.from(new Set(items.map(i => i.cluster).filter(c => c && c !== "—")))], [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter(i => {
        const matchCluster = filterCluster === "Todos" || i.cluster === filterCluster;
        const matchSearch = !q || i.material.toLowerCase().includes(q) || i.codigo.toLowerCase().includes(q) || i.cluster.toLowerCase().includes(q);
        return matchCluster && matchSearch;
      })
      .sort((a, b) => {
        let va: any = a[sortBy];
        let vb: any = b[sortBy];
        if (sortBy === "saldo") { va = Number(va) || 0; vb = Number(vb) || 0; }
        else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
        return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
      });
  }, [items, search, filterCluster, sortBy, sortAsc]);

  const totalSaldo = useMemo(() => filtered.reduce((acc, i) => acc + (Number(i.saldo) || 0), 0), [filtered]);
  const semEstoque = filtered.filter(i => Number(i.saldo) <= 0).length;

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(a => !a);
    else { setSortBy(col); setSortAsc(true); }
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "#f1f5f9" }}>
      <div className="flex items-center gap-2 text-slate-400 text-sm font-semibold">
        <RefreshCw size={14} className="animate-spin text-indigo-400" /> Carregando estoque...
      </div>
    </div>
  );

  if (error) return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "#f1f5f9" }}>
      <div className="text-center">
        <AlertCircle size={28} className="mx-auto mb-2 text-rose-400" />
        <p className="text-sm font-bold text-slate-600">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#f1f5f9" }}>
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-100 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-black text-[#0f172a]">Estoque</h2>
            <p className="text-xs text-slate-400 mt-0.5">{filtered.length} itens · saldo total: <span className="font-bold text-indigo-600">{totalSaldo.toLocaleString("pt-BR")}</span> · <span className="text-rose-500 font-bold">{semEstoque} sem estoque</span></p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImportarCSV} 
              accept=".csv" 
              className="hidden" 
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importando}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 border border-indigo-200 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors disabled:opacity-50"
            >
              {importando ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
              <span>Importar Saldos (CSV)</span>
            </button>

            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Código, material..."
                className="pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 w-44 focus:outline-none focus:border-indigo-300"
              />
            </div>
            <select
              value={filterCluster}
              onChange={e => setFilterCluster(e.target.value)}
              className="text-sm border border-slate-200 rounded-xl bg-slate-50 px-3 py-2 focus:outline-none focus:border-indigo-300 text-slate-600 font-semibold"
            >
              {clusters.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {[
                  { label: "Código",    key: null },
                  { label: "Material",  key: "material" as const },
                  { label: "Saldo",     key: "saldo" as const },
                  { label: "UM",        key: null },
                  { label: "Lote",      key: null },
                  { label: "Centro",    key: null },
                  { label: "Depósito",  key: null },
                  { label: "Cluster",   key: "cluster" as const },
                ].map(col => (
                  <th
                    key={col.label}
                    onClick={() => col.key && toggleSort(col.key)}
                    className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 select-none"
                    style={{ cursor: col.key ? "pointer" : "default", whiteSpace: "nowrap" }}
                  >
                    <span className="flex items-center gap-1">
                      {col.label}
                      {col.key && sortBy === col.key && (
                        <span className="text-indigo-400">{sortAsc ? "↑" : "↓"}</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-300 text-sm font-semibold">
                    Nenhum item encontrado
                  </td>
                </tr>
              )}
              {filtered.map((item, i) => {
                const saldoNum = Number(item.saldo) || 0;
                const semSaldo = saldoNum <= 0;
                return (
                  <tr
                    key={`${item.codigo}-${item.cluster}-${i}`}
                    className="border-t border-slate-50 hover:bg-slate-50 transition-colors"
                    style={{ background: semSaldo ? "#fff8f8" : undefined }}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.codigo}</td>
                    <td className="px-4 py-3 font-semibold text-[#0f172a] max-w-[220px]">
                      <span className="truncate block" title={item.material}>{item.material}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center font-black text-xs px-2.5 py-1 rounded-lg"
                        style={{
                          background: semSaldo ? "#fee2e2" : saldoNum < 10 ? "#fffbeb" : "#f0fdf4",
                          color:      semSaldo ? "#dc2626" : saldoNum < 10 ? "#d97706" : "#059669",
                        }}
                      >
                        {saldoNum.toLocaleString("pt-BR")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{item.um}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono">{item.lote}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{item.centro}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{item.deposito}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600">
                        {item.cluster}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TELA DE RESPOSTAS (ATUALIZADO COM BOTÃO DE DOWNLOAD EXCEL CSV COM BOM UTF8) ───
interface RespostaItem {
  timestamp: string;
  idTarefa: string;
  colaborador: string;
  cluster: string;
  centro: string;
  codigo: string;
  material: string;
  quantidade: string;
  observacoes: string;
}

function RespostasView() {
  const [respostas, setRespostas] = useState<RespostaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCluster, setFilterCluster] = useState("Todos");

  useEffect(() => {
    setLoading(true);
    fetch(API_URL)
      .then(r => r.text())
      .then(text => {
        if (!text.trim().startsWith("{")) throw new Error("Resposta inválida da API");
        const data = JSON.parse(text);
        
        const respostasKey = Object.keys(data).find(k => k.toLowerCase() === "respostas");
        const raw = respostasKey ? data[respostasKey] : [];
        
        if (!Array.isArray(raw)) {
          throw new Error("Formato de dados da aba 'respostas' inválido.");
        }

        setRespostas(raw.map((r: any) => ({
          timestamp:   String(r.data_consumo || r.timestamp || r.Timestamp || r.data || r.Data || "—"),
          idTarefa:    String(r.id_tarefa || r.idTarefa || r.id || r.Id || r.IdTarefa || "—"),
          colaborador: String(r.colaborador || r.Colaborador || "—"),
          cluster:     String(r.cluster || r.Cluster || "—"),
          centro:      String(r.centro || r.Centro || "—"),
          codigo:      String(r.codigo || r.Codigo || "—"),
          material:    String(r.material || r["material cadastrado"] || r.Material || "—"),
          quantidade:  String(r.quantidade || r.Quantidade || "0"),
          observacoes: String(r.observacoes || r.Observacoes || ""),
        })));
      })
      .catch(e => {
        console.error("❌ Erro respostas:", e);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleExportarExcel = () => {
    if (filtered.length === 0) {
      alert("Não existem dados disponíveis para exportação no filtro selecionado.");
      return;
    }

    const cabecalhos = ["Data/Hora", "ID Tarefa", "Colaborador", "Cluster", "Centro", "Material", "Codigo", "Quantidade", "Observacoes"];
    const linhasCSV = filtered.map(item => [
      `"${item.timestamp.replace(/"/g, '""')}"`,
      `"${item.idTarefa.replace(/"/g, '""')}"`,
      `"${item.colaborador.replace(/"/g, '""')}"`,
      `"${item.cluster.replace(/"/g, '""')}"`,
      `"${item.centro.replace(/"/g, '""')}"`,
      `"${item.material.replace(/"/g, '""')}"`,
      `"${item.codigo.replace(/"/g, '""')}"`,
      `"${item.quantidade}"`,
      `"${item.observacoes.replace(/"/g, '""')}"`
    ]);

    // Cria a estrutura separada por ';' (padrão regional Excel brasileiro)
    const corpoArquivo = [cabecalhos.join(";"), ...linhasCSV.map(l => l.join(";"))].join("\n");
    
    // Insere o caractere universal BOM (\uFEFF) para forçar o Excel a reconhecer UTF-8
    const blob = new Blob(["\uFEFF" + corpoArquivo], { type: "text/csv;charset=utf-8;" });
    const urlLink = URL.createObjectURL(blob);
    
    const tagLink = document.createElement("a");
    tagLink.href = urlLink;
    tagLink.download = `planilha_baixas_kanban_${new Date().toLocaleDateString().replace(/\//g, "-")}.csv`;
    document.body.appendChild(tagLink);
    tagLink.click();
    document.body.removeChild(tagLink);
  };

  const clusters = useMemo(() => {
    return ["Todos", ...Array.from(new Set(respostas.map(r => r.cluster).filter(c => c && c !== "—")))];
  }, [respostas]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return respostas.filter(r => {
      const matchCluster = filterCluster === "Todos" || r.cluster === filterCluster;
      const matchSearch = !q || 
        r.idTarefa.toLowerCase().includes(q) || 
        r.colaborador.toLowerCase().includes(q) || 
        r.codigo.toLowerCase().includes(q) ||
        r.observacoes.toLowerCase().includes(q);
      return matchCluster && matchSearch;
    });
  }, [respostas, search, filterCluster]);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "#f1f5f9" }}>
      <div className="flex items-center gap-2 text-slate-400 text-sm font-semibold">
        <RefreshCw size={14} className="animate-spin text-indigo-400" /> Carregando histórico...
      </div>
    </div>
  );

  if (error) return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "#f1f5f9" }}>
      <div className="text-center">
        <AlertCircle size={28} className="mx-auto mb-2 text-rose-400" />
        <p className="text-sm font-bold text-slate-600">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#f1f5f9" }}>
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-100 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-black text-[#0f172a]">Histórico de Consumos</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {filtered.length} baixas registradas no sistema
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportarExcel}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 border border-emerald-200 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
            >
              <Download size={13} />
              <span>Exportar Planilha (Excel)</span>
            </button>

            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar id, código..."
                className="pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 w-52 focus:outline-none focus:border-indigo-300"
              />
            </div>
            <select
              value={filterCluster}
              onChange={e => setFilterCluster(e.target.value)}
              className="text-sm border border-slate-200 rounded-xl bg-slate-50 px-3 py-2 focus:outline-none focus:border-indigo-300 text-slate-600 font-semibold"
            >
              {clusters.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Data/Hora</th>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">ID Tarefa</th>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Colaborador</th>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Cluster</th>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Centro</th>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Material</th>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Código</th>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Qtd.</th>
                <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Observações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-300 text-sm font-semibold">
                    Nenhum consumo encontrado
                  </td>
                </tr>
              )}
              {filtered.map((item, idx) => (
                <tr key={idx} className="border-t border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-xs text-slate-500 font-mono whitespace-nowrap">{item.timestamp}</td>
                  <td className="px-4 py-3 font-bold text-[#0f172a]">{item.idTarefa}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{item.colaborador}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600">
                      {item.cluster}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                      {item.centro}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-[180px] truncate" title={item.material}>{item.material}</td>
                  <td className="px-4 py-3 font-bold text-slate-700">{item.codigo}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-rose-50 text-rose-600">
                      - {item.quantidade}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate" title={item.observacoes}>
                    {item.observacoes || <span className="text-slate-300 italic">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── TELA DE REQUISIÇÕES DE MATERIAL ───
interface RequisicaoViewItem {
  timestamp: string;
  idTarefa: string;
  ionix: string;
  cluster: string;
  colaborador: string;
  codigoOriginal: string;
  materialOriginal: string;
  codigoSubstituto: string;
  materialSubstituto: string;
  quantidade: number;
  observacoes: string;
}

function RequisicaoView() {
  const [itens, setItens] = useState<RequisicaoViewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCluster, setFilterCluster] = useState("Todos");
  const [activeTab, setActiveTab] = useState<"tabela" | "grafico">("tabela");

  useEffect(() => {
    setLoading(true);
    fetch(API_URL)
      .then(r => r.text())
      .then(text => {
        if (!text.trim().startsWith("{")) throw new Error("Resposta inválida da API");
        const data = JSON.parse(text);
        const key = Object.keys(data).find(k => k.toLowerCase().replace(/\s+/g,"") === "registrarrequisicaomaterial");
        const raw = key ? data[key] : [];
        if (!Array.isArray(raw)) throw new Error("Aba de requisições não encontrada ou vazia.");
        setItens(raw.map((r: any) => ({
          timestamp:          String(r.timestamp          ?? r.data          ?? r.Data          ?? "—"),
          idTarefa:           String(r.id_tarefa          ?? r.idTarefa      ?? r.Id_tarefa     ?? "—"),
          ionix:              String(r.ionix              ?? r.Ionix         ?? "—"),
          cluster:            String(r.cluster            ?? r.Cluster       ?? "—"),
          colaborador:        String(r.colaborador        ?? r.Colaborador   ?? "—"),
          codigoOriginal:     String(r.codigooriginal     ?? r.codigoOriginal     ?? r.codigo_original     ?? "—"),
          materialOriginal:   String(r.materialoriginal   ?? r.materialOriginal   ?? r.material_original   ?? "—"),
          codigoSubstituto:   String(r.codigosubstituto   ?? r.codigoSubstituto   ?? r.codigo_substituto   ?? "—"),
          materialSubstituto: String(r.materialsubstituto ?? r.materialSubstituto ?? r.material_substituto ?? "—"),
          quantidade:         Number(r.quantidade ?? r.Quantidade ?? 0),
          observacoes:        String(r.observacoes ?? r.Observacoes ?? ""),
        })));
        setError(null);
      })
      .catch(e => { console.error("❌ Erro requisições:", e); setError(e.message); })
      .finally(() => setLoading(false));
  }, []);

  const clusters = useMemo(() => ["Todos", ...Array.from(new Set(itens.map(i => i.cluster).filter(c => c && c !== "—")))], [itens]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return itens.filter(i => {
      const matchCluster = filterCluster === "Todos" || i.cluster === filterCluster;
      const matchSearch = !q ||
        i.idTarefa.toLowerCase().includes(q) ||
        i.materialOriginal.toLowerCase().includes(q) ||
        i.materialSubstituto.toLowerCase().includes(q) ||
        i.codigoOriginal.toLowerCase().includes(q) ||
        i.colaborador.toLowerCase().includes(q);
      return matchCluster && matchSearch;
    });
  }, [itens, search, filterCluster]);

  // Ranking: materiais mais requisitados (que faltaram)
  const rankingMateriais = useMemo(() => {
    const map: Record<string, { material: string; codigo: string; total: number; vezes: number }> = {};
    filtered.forEach(i => {
      const key = i.codigoOriginal;
      if (!map[key]) map[key] = { material: i.materialOriginal, codigo: i.codigoOriginal, total: 0, vezes: 0 };
      map[key].total += i.quantidade;
      map[key].vezes += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filtered]);

  // Ranking de substitutos mais usados
  const rankingSubstitutos = useMemo(() => {
    const map: Record<string, { material: string; codigo: string; total: number }> = {};
    filtered.forEach(i => {
      const key = i.codigoSubstituto;
      if (!map[key]) map[key] = { material: i.materialSubstituto, codigo: i.codigoSubstituto, total: 0 };
      map[key].total += i.quantidade;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [filtered]);

  const totalRequisicoes = filtered.length;
  const totalQtd = filtered.reduce((a, i) => a + i.quantidade, 0);
  const materiaisUnicos = new Set(filtered.map(i => i.codigoOriginal)).size;

  const handleExportar = () => {
    if (filtered.length === 0) { alert("Nenhum dado para exportar."); return; }
    const cab = ["Data/Hora","ID Tarefa","Ionix","Cluster","Colaborador","Cód. Original","Material Original","Cód. Substituto","Material Substituto","Quantidade","Observações"];
    const linhas = filtered.map(i => [
      `"${i.timestamp}"`, `"${i.idTarefa}"`, `"${i.ionix}"`, `"${i.cluster}"`, `"${i.colaborador}"`,
      `"${i.codigoOriginal}"`, `"${i.materialOriginal.replace(/"/g,'""')}"`  ,
      `"${i.codigoSubstituto}"`, `"${i.materialSubstituto.replace(/"/g,'""')}"`  ,
      i.quantidade, `"${i.observacoes.replace(/"/g,'""')}"` 
    ]);
    const csv = [cab.join(";"), ...linhas.map(l => l.join(";"))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `requisicoes_material_${new Date().toLocaleDateString().replace(/\//g,"-")}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const maxRanking = rankingMateriais[0]?.total || 1;

  if (loading) return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "#f1f5f9" }}>
      <div className="flex items-center gap-2 text-slate-400 text-sm font-semibold">
        <RefreshCw size={14} className="animate-spin text-amber-400" /> Carregando requisições...
      </div>
    </div>
  );

  if (error) return (
    <div className="flex-1 flex items-center justify-center" style={{ background: "#f1f5f9" }}>
      <div className="text-center">
        <AlertCircle size={28} className="mx-auto mb-2 text-rose-400" />
        <p className="text-sm font-bold text-slate-600">{error}</p>
        <p className="text-xs text-slate-400 mt-1">Verifique se a aba "registrarrequisicaomaterial" existe no Sheets.</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#f1f5f9" }}>
      {/* Header */}
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-100 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-black text-[#0f172a]">Requisições de Material</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              <span className="font-bold text-amber-600">{totalRequisicoes}</span> registros ·{" "}
              <span className="font-bold text-rose-500">{materiaisUnicos}</span> materiais diferentes ·{" "}
              <span className="font-bold text-slate-600">{totalQtd}</span> unidades requisitadas
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportar}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 border border-emerald-200 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
            >
              <Download size={13} /> Exportar Planilha
            </button>
            <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
              <button
                onClick={() => setActiveTab("tabela")}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 transition-colors"
                style={{ background: activeTab === "tabela" ? "#4f46e5" : "transparent", color: activeTab === "tabela" ? "#fff" : "#64748b" }}
              >
                <ClipboardList size={13} /> Tabela
              </button>
              <button
                onClick={() => setActiveTab("grafico")}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 transition-colors"
                style={{ background: activeTab === "grafico" ? "#4f46e5" : "transparent", color: activeTab === "grafico" ? "#fff" : "#64748b" }}
              >
                <BarChart3 size={13} /> Gráfico
              </button>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Material, ID, colaborador..."
                className="pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 w-52 focus:outline-none focus:border-amber-300"
              />
            </div>
            <select
              value={filterCluster} onChange={e => setFilterCluster(e.target.value)}
              className="text-sm border border-slate-200 rounded-xl bg-slate-50 px-3 py-2 focus:outline-none focus:border-amber-300 text-slate-600 font-semibold"
            >
              {clusters.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">

        {/* ── VISÃO GRÁFICO ── */}
        {activeTab === "grafico" && (
          <div className="space-y-4">
            {/* Cards resumo */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Total de Requisições", value: totalRequisicoes, color: "#f97316", bg: "#fff7ed", border: "#fed7aa" },
                { label: "Materiais Distintos",  value: materiaisUnicos,  color: "#e11d48", bg: "#fff1f2", border: "#fecdd3" },
                { label: "Unidades Faltantes",   value: totalQtd,         color: "#7c3aed", bg: "#faf5ff", border: "#e9d5ff" },
              ].map(card => (
                <div key={card.label} className="rounded-2xl p-5 border" style={{ background: card.bg, borderColor: card.border }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: card.color }}>{card.label}</p>
                  <p className="text-3xl font-black" style={{ color: card.color }}>{card.value.toLocaleString("pt-BR")}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Ranking materiais que mais faltaram */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: "#fff1f2" }}>
                    <AlertCircle size={14} className="text-rose-500" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-[#0f172a]">Materiais mais requisitados</p>
                    <p className="text-[10px] text-slate-400">que faltaram no estoque</p>
                  </div>
                </div>
                {rankingMateriais.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">Nenhum dado</p>
                ) : (
                  <div className="space-y-2.5">
                    {rankingMateriais.map((m, i) => {
                      const pct = Math.round((m.total / maxRanking) * 100);
                      const colors = ["#e11d48","#f97316","#d97706","#7c3aed","#4f46e5","#0891b2","#059669","#64748b","#9333ea","#db2777"];
                      const cor = colors[i % colors.length];
                      return (
                        <div key={m.codigo}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-bold text-[#0f172a] truncate max-w-[65%]" title={m.material}>
                              {i+1}. {m.material || m.codigo}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-slate-400">{m.vezes}x</span>
                              <span className="text-xs font-black" style={{ color: cor }}>{m.total} un.</span>
                            </div>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cor }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Ranking substitutos */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: "#f0fdf4" }}>
                    <CheckCircle size={14} className="text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-[#0f172a]">Substitutos mais utilizados</p>
                    <p className="text-[10px] text-slate-400">materiais usados no lugar</p>
                  </div>
                </div>
                {rankingSubstitutos.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">Nenhum dado</p>
                ) : (
                  <div className="space-y-3">
                    {rankingSubstitutos.map((m, i) => {
                      const maxSub = rankingSubstitutos[0]?.total || 1;
                      const pct = Math.round((m.total / maxSub) * 100);
                      const cores = ["#059669","#0891b2","#4f46e5","#7c3aed","#d97706"];
                      const cor = cores[i % cores.length];
                      return (
                        <div key={m.codigo}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-bold text-[#0f172a] truncate max-w-[70%]" title={m.material}>
                              {i+1}. {m.material || m.codigo}
                            </span>
                            <span className="text-xs font-black shrink-0" style={{ color: cor }}>{m.total} un.</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cor }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Por cluster */}
                {filtered.length > 0 && (
                  <div className="mt-5 pt-4 border-t border-slate-100">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Requisições por cluster</p>
                    <div className="space-y-1.5">
                      {Array.from(new Set(filtered.map(i => i.cluster).filter(c => c !== "—")))
                        .map(cluster => {
                          const count = filtered.filter(i => i.cluster === cluster).length;
                          const pct = Math.round((count / filtered.length) * 100);
                          return (
                            <div key={cluster} className="flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 shrink-0 w-24 truncate">{cluster}</span>
                              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full bg-indigo-400" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] font-bold text-slate-500 w-8 text-right">{count}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── VISÃO TABELA ── */}
        {activeTab === "tabela" && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  {["Data/Hora","ID","Cluster","Colaborador","Material Requisitado","Cód.","Material Substituto","Qtd.","Obs."].map(col => (
                    <th key={col} className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-slate-300 text-sm font-semibold">
                      Nenhuma requisição encontrada
                    </td>
                  </tr>
                )}
                {filtered.map((item, idx) => (
                  <tr key={idx} className="border-t border-slate-50 hover:bg-amber-50/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">{item.timestamp}</td>
                    <td className="px-4 py-3 font-bold text-[#0f172a] text-xs">{item.idTarefa}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600">{item.cluster}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 font-semibold">{item.colaborador}</td>
                    <td className="px-4 py-3 max-w-[160px]">
                      <span className="text-xs font-bold text-rose-700 truncate block" title={item.materialOriginal}>{item.materialOriginal}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{item.codigoOriginal}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{item.codigoOriginal}</td>
                    <td className="px-4 py-3 max-w-[160px]">
                      <span className="text-xs font-bold text-emerald-700 truncate block" title={item.materialSubstituto}>{item.materialSubstituto}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{item.codigoSubstituto}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">{item.quantidade}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[120px] truncate" title={item.observacoes}>
                      {item.observacoes || <span className="text-slate-200 italic">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TELA DE COLABORADORES ───
function ColaboradoresView({ columns }: { columns: Column[] }) {
  const allTasks = columns.flatMap(col => col.tasks.map(t => ({ ...t, colId: col.id, colTitle: col.title, colColor: col.color })));

  const stats = COLLABORATORS.map(c => {
    const myTasks = allTasks.filter(t => t.colaborador === c.name);
    const concluded = myTasks.filter(t => t.colId === "concluido").length;
    const inProgress = myTasks.filter(t => t.colId === "acaost").length;
    const pending = myTasks.filter(t => t.colId === "semservico").length;
    const materials = myTasks.filter(t => t.colId === "materiaiscl").length;
    const baixaOcup = myTasks.filter(t => t.colId === "baixaocupacao").length;
    const total = myTasks.length;
    const pct = total > 0 ? Math.round((concluded / total) * 100) : 0;
    return { ...c, total, concluded, inProgress, pending, materials, baixaOcup, pct, tasks: myTasks };
  });

  const unassigned = allTasks.filter(t => t.colaborador === "Não atribuído");

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: "#f1f5f9" }}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h2 className="text-xl font-black text-[#0f172a]">Colaboradores</h2>
          <p className="text-sm text-slate-400 mt-0.5">Visão geral de carga e desempenho por pessoa</p>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-6">
          {stats.map(c => (
            <div key={c.name} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center gap-4 p-5">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-base shrink-0"
                  style={{ background: c.color }}
                >
                  {c.initials}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-black text-[#0f172a] text-sm">{c.name}</span>
                    <span className="text-xs font-bold text-slate-500">{c.concluded}/{c.total} concluídos</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${c.pct}%`, background: c.color }}
                    />
                  </div>
                  <div className="flex gap-3 mt-2">
                    {[
                      { label: "Sem serviço", val: c.pending,    bg: "#fee2e2", col: "#ef4444" },
                      { label: "Mat. CL",     val: c.materials,  bg: "#f7fee7", col: "#84cc16" },
                      { label: "Ação ST",     val: c.inProgress, bg: "#eff6ff", col: "#3b82f6" },
                      { label: "Baixa Ocup.", val: c.baixaOcup,  bg: "#fffbeb", col: "#f59e0b" },
                      { label: "Concluído",   val: c.concluded,  bg: "#f0fdf4", col: "#10b981" },
                    ].map(s => (
                      <div key={s.label} className="flex items-center gap-1">
                        <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md" style={{ background: s.bg, color: s.col }}>
                          {s.label}: {s.val}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-2xl font-black" style={{ color: c.color }}>{c.pct}%</div>
                  <div className="text-[10px] font-bold text-slate-400">conclusão</div>
                </div>
              </div>

              {c.tasks.length > 0 && (
                <div className="border-t border-slate-50 px-5 py-3">
                  <div className="flex flex-wrap gap-2">
                    {c.tasks.slice(0, 12).map(t => (
                      <span
                        key={t.id}
                        className="text-[10px] font-bold px-2.5 py-1 rounded-lg border"
                        style={{
                          background: t.colId === "concluido" ? "#f0fdf4" : "#f8fafc",
                          color: t.colId === "concluido" ? "#059669" : "#334155",
                          borderColor: t.colId === "concluido" ? "#bbf7d0" : "#e2e8f0",
                          textDecoration: t.colId === "concluido" ? "line-through" : "none",
                        }}
                      >
                        #{t.title}
                      </span>
                    ))}
                    {c.tasks.length > 12 && (
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400">
                        +{c.tasks.length - 12} mais
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {unassigned.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={16} className="text-amber-400" />
              <span className="font-black text-sm text-[#0f172a]">Sem responsável ({unassigned.length})</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {unassigned.map(t => (
                <span key={t.id} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                  #{t.title} · {t.colTitle}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TELA DE RELATÓRIOS ───
function RelatoriosView({ columns }: { columns: Column[] }) {
  const allTasks = columns.flatMap(col => col.tasks.map(t => ({ ...t, colId: col.id, colTitle: col.title, colColor: col.color })));
  const total = allTasks.length;
  const concluded = allTasks.filter(t => t.colId === "concluido").length;
  const pending = allTasks.filter(t => t.colId === "semservico").length;
  const acaoST = allTasks.filter(t => t.colId === "acaost").length;
  const materiaisCL = allTasks.filter(t => t.colId === "materiaiscl").length;
  const baixaOcup = allTasks.filter(t => t.colId === "baixaocupacao").length;
  const conclusionRate = total > 0 ? Math.round((concluded / total) * 100) : 0;

  const collabRanking = COLLABORATORS.map(c => {
    const mine = allTasks.filter(t => t.colaborador === c.name);
    const done = mine.filter(t => t.colId === "concluido").length;
    return { ...c, total: mine.length, done };
  }).sort((a, b) => b.done - a.done);

  const colDist = columns.map(col => ({
    ...col,
    count: col.tasks.length,
    pct: total > 0 ? Math.round((col.tasks.length / total) * 100) : 0,
  }));

  const matrix = COLLABORATORS.map(c => ({
    name: c.name,
    initials: c.initials,
    color: c.color,
    cols: columns.map(col => col.tasks.filter(t => t.colaborador === c.name).length),
  }));

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: "#f1f5f9" }}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-black text-[#0f172a]">Relatórios</h2>
          <p className="text-sm text-slate-400 mt-0.5">Resumo geral do quadro</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Total de cards",    val: total,          bg: "#f8fafc", color: "#0f172a",  accent: "#e2e8f0" },
            { label: "Concluídos",        val: concluded,      bg: "#f0fdf4", color: "#059669",  accent: "#bbf7d0" },
            { label: "Ação ST",           val: acaoST,         bg: "#eff6ff", color: "#2563eb",  accent: "#bfdbfe" },
            { label: "Baixa Ocupação",    val: baixaOcup,      bg: "#fffbeb", color: "#d97706",  accent: "#fde68a" },
            { label: "Taxa de conclusão", val: `${conclusionRate}%`, bg: "#f5f3ff", color: "#6d28d9", accent: "#ddd6fe" },
          ].map(kpi => (
            <div key={kpi.label} className="rounded-2xl p-4 border" style={{ background: kpi.bg, borderColor: kpi.accent }}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: kpi.color, opacity: 0.6 }}>{kpi.label}</p>
              <p className="text-3xl font-black leading-none" style={{ color: kpi.color }}>{kpi.val}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Distribuição por coluna</h3>
          <div className="space-y-3">
            {colDist.map(col => (
              <div key={col.id} className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col.color }} />
                <span className="text-sm font-bold text-[#0f172a] w-32 shrink-0">{col.title}</span>
                <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: col.accent }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${col.pct}%`, background: col.color }}
                  />
                </div>
                <span className="text-xs font-black text-slate-500 w-12 text-right">{col.count} cards</span>
                <span className="text-[10px] font-bold text-slate-400 w-8 text-right">{col.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Ranking por conclusão</h3>
            <div className="space-y-3">
              {collabRanking.map((c, i) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-300 w-4">{i + 1}</span>
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center text-white font-black text-[10px] shrink-0" style={{ background: c.color }}>
                    {c.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#0f172a] truncate">{c.name}</p>
                    <p className="text-[10px] text-slate-400">{c.done} de {c.total} concluídos</p>
                  </div>
                  <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${c.total > 0 ? Math.round((c.done / c.total) * 100) : 0}%`,
                        background: c.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 overflow-x-auto">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Cards por coluna</h3>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left font-black text-[9px] uppercase tracking-wider text-slate-400 pb-2 pr-2">Pessoa</th>
                  {columns.map(col => (
                    <th key={col.id} className="text-center font-black text-[9px] uppercase tracking-wider pb-2 px-1" style={{ color: col.color }}>
                      {col.title.split(" ")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map(row => (
                  <tr key={row.name} className="border-t border-slate-50">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-lg flex items-center justify-center text-white font-black text-[8px]" style={{ background: row.color }}>
                          {row.initials}
                        </div>
                        <span className="font-semibold text-slate-600 text-[11px]">{row.name.split(" ")[0]}</span>
                      </div>
                    </td>
                    {row.cols.map((count, ci) => (
                      <td key={ci} className="text-center py-2 px-1">
                        {count > 0 ? (
                          <span
                            className="inline-block w-6 h-6 rounded-lg font-black text-[11px] leading-6 text-center"
                            style={{ background: columns[ci].accent, color: columns[ci].color }}
                          >
                            {count}
                          </span>
                        ) : (
                          <span className="text-slate-200 font-bold">–</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {(() => {
          const unassigned = allTasks.filter(t => t.colaborador === "Não atribuído" && t.colId !== "concluido");
          if (unassigned.length === 0) return null;
          return (
            <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={15} className="text-amber-400" />
                <h3 className="text-xs font-black uppercase tracking-widest text-amber-500">
                  {unassigned.length} cards sem responsável
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {unassigned.map(t => (
                  <span key={t.id} className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-100">
                    #{t.title} · {t.colTitle}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function KanbanBoard({ loggedInEmail, onLogout }: { loggedInEmail: string; onLogout: () => void }) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterColaborador, setFilterColaborador] = useState<string>("Todos");
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeNav, setActiveNav] = useState<string>("kanban");
  const [filterOpen, setFilterOpen] = useState(false);
  const [openTask, setOpenTask] = useState<{ task: KanbanTask; columnId: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "loading" } | null>(null);
  const [dragState, setDragState] = useState<{ taskId: string; fromColId: string } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [respostasPorId, setRespostasPorId] = useState<Record<string, RespostaItem[]>>({});

  // ─── NOTIFICAÇÃO ADMIN ───
  const LS_ADMIN_MSG_SEEN_KEY = "tlp_admin_notification_seen_v1";
  const [adminNotif, setAdminNotif] = useState<{ text: string; ts: number } | null>(null);
  const [showAdminNotif, setShowAdminNotif] = useState(false);
  const [showAdminCompose, setShowAdminCompose] = useState(false);
  const [adminMsgDraft, setAdminMsgDraft] = useState("");
  const isAdmin = ["jane.gomes@tlpcp.com.br", "camilly.silva@tlpcp.com.br"].includes(loggedInEmail?.toLowerCase() ?? "");

  const handleSendAdminNotif = () => {
    if (!adminMsgDraft.trim()) return;
    const msg = { text: adminMsgDraft.trim(), ts: Date.now(), sender: loggedInEmail };
    ablyChannelRef.current?.publish("adminNotification", msg);
    // Also show locally for the sender
    setAdminNotif(msg);
    setShowAdminNotif(true);
    try { localStorage.setItem(LS_ADMIN_MSG_SEEN_KEY, String(msg.ts)); } catch {}
    setShowAdminCompose(false);
    setAdminMsgDraft("");
    showToast("Notificação enviada para a equipe!", "success");
  };

  const handleDismissAdminNotif = () => {
    setShowAdminNotif(false);
    if (adminNotif) {
      try { localStorage.setItem(LS_ADMIN_MSG_SEEN_KEY, String(adminNotif.ts)); } catch {}
    }
  };

  const ablyChannelRef = useRef<any>(null);
  const myClientIdRef = useRef<string>(`client-${Math.random().toString(36).substr(2, 9)}`);

  const showToast = useCallback((message: string, type: "success" | "error" | "loading") => {
    setToast({ message, type });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const officialColumnsStructure = useMemo(() => [
    { id: "semservico",    title: "Sem Serviço",    color: "#ef4444", accent: "#fee2e2" },
    { id: "materiaiscl",  title: "Materiais CL",   color: "#84cc16", accent: "#f7fee7" },
    { id: "acaost",       title: "Ação ST",        color: "#3b82f6", accent: "#eff6ff" },
    { id: "baixaocupacao", title: "Baixa Ocupação", color: "#f59e0b", accent: "#fffbeb" },
    { id: "concluido",    title: "Concluído",      color: "#10b981", accent: "#f0fdf4" },
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
      
      let data: any = null;
      try {
        const response = await fetch(API_URL);
        const text = await response.text();
        if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) {
          throw new Error(`API retornou resposta inválida: ${text.substring(0, 100)}`);
        }
        data = JSON.parse(text);
      } catch (fetchErr) {
        console.error("Erro ao buscar/parsear API:", fetchErr);
        if (!silent) setLoading(false);
        return;
      }
      
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
            
            const rawId = task.id ? String(task.id) : `task`;
            const rowkey = task.rowkey ? String(task.rowkey) : null;
            const uniqueId = rowkey ? `${col.id}-rk${rowkey}` : `${col.id}-${rawId}-${index}`;

            const meta = getCollabMeta(task.colaborador || "Não atribuído");
            const builtTask: KanbanTask = {
              id: uniqueId, 
              title: rawId,
              rowkey: rowkey ?? undefined,
              sourceColumn: col.id,
              ionix: task.ionix || task.description?.match(/Ionix[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              cluster: task.cluster || task.description?.match(/Cluster[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              uf: task.uf || task.description?.match(/UF[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              material: task.material || task.description?.match(/Material[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              quantidade: task.quantidade || task.description?.match(/Qtd?[a-z.]*[:\s]+([^\n|]+)/i)?.[1]?.trim() || task.description?.match(/Quantidade[:\s]+([^\n|]+)/i)?.[1]?.trim() || "—",
              description: task.description || "",
              colaborador: task.colaborador || "Não atribuído",
              colaboradorInitials: meta.initials,
              colaboradorColor: meta.color,
              priority: "média",
              dueDate: task.dueDate || "",
              steps: [],
              tags: Array.isArray(task.tags) ? task.tags : [],
              checklist: Array.isArray(task.checklist) ? task.checklist : [],
              subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
              annotations: Array.isArray(task.annotations) ? task.annotations : [],
              codigoMaterial: task.codigo_material !== undefined && task.codigo_material !== null ? String(task.codigo_material) : undefined,
              saldoEstoque: task.saldo_estoque !== undefined && task.saldo_estoque !== null ? task.saldo_estoque : undefined,
            };
            const key = getPersistKey(builtTask);
            if (!builtTask.annotations.length && savedAnnotations[key]?.length) {
              builtTask.annotations = savedAnnotations[key];
            }
            allTasksFlat.push({ apiColId: col.id, task: builtTask, key });
          });
        });

        // Merge pending task data into built tasks to preserve fields like material/codigoMaterial
        allTasksFlat.forEach(entry => {
          const p = pending[entry.key];
          if (p && now - p.ts <= PENDING_TTL_MS) {
            // Preserve fields from pending task that may not come from API in other columns
            if (p.task.material && p.task.material !== "—") entry.task.material = p.task.material;
            if (p.task.codigoMaterial) entry.task.codigoMaterial = p.task.codigoMaterial;
            if (p.task.saldoEstoque !== undefined) entry.task.saldoEstoque = p.task.saldoEstoque;
            if (p.task.quantidade && p.task.quantidade !== "—") entry.task.quantidade = p.task.quantidade;
          }
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

        // Carrega dados completos das respostas agrupados por id_tarefa
        const respostasKey = Object.keys(data).find(k => k.toLowerCase() === "respostas");
        const rawRespostas = respostasKey ? data[respostasKey] : [];
        if (Array.isArray(rawRespostas)) {
          const mapa: Record<string, RespostaItem[]> = {};
          rawRespostas.forEach((r: any) => {
            const id = String(r.id_tarefa || r.idTarefa || r.id || r.Id || r.IdTarefa || "").trim();
            if (!id || id === "—") return;
            const item: RespostaItem = {
              timestamp:   String(r.data_consumo || r.timestamp || r.Timestamp || r.data || r.Data || "—"),
              idTarefa:    id,
              colaborador: String(r.colaborador || r.Colaborador || "—"),
              cluster:     String(r.cluster || r.Cluster || "—"),
              centro:      String(r.centro || r.Centro || "—"),
              codigo:      String(r.codigo || r.Codigo || "—"),
              material:    String(r.material || r["material cadastrado"] || r.Material || "—"),
              quantidade:  String(r.quantidade || r.Quantidade || "0"),
              observacoes: String(r.observacoes || r.Observacoes || ""),
            };
            if (!mapa[id]) mapa[id] = [];
            mapa[id].push(item);
          });
          setRespostasPorId(mapa);
        }
      }
    } catch (error) {
      console.error("Erro inesperado no loadKanban:", error);
      setColumns(prev => prev.length > 0 ? prev : officialColumnsStructure.map(col => ({ ...col, tasks: [] })));
    } finally {
      setLoading(false);
    }
  }, [officialColumnsStructure]);

  useEffect(() => { loadKanban(); }, [loadKanban]);

  useEffect(() => {
    if (!ABLY_API_KEY || ABLY_API_KEY.includes("SUA_CHAVE_DO_ABLY")) return;

    const ably = new Realtime({ key: ABLY_API_KEY });
    const channel = ably.channels.get(ABLY_CHANNEL_NAME);
    ablyChannelRef.current = channel;

    channel.subscribe("taskMoved", (message) => {
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

    channel.subscribe("adminNotification", (message) => {
      const msg = message.data as { text: string; ts: number; sender: string };
      if (!msg?.text) return;
      setAdminNotif(msg);
      setShowAdminNotif(true);
      try { localStorage.removeItem("tlp_admin_notification_seen_v1"); } catch {}
    });

    return () => {
      channel.unsubscribe();
      ably.close();
    };
  }, []);

  const updateTask = (updated: KanbanTask) => {
    setColumns(prev => prev.map(col => ({ ...col, tasks: col.tasks.map(t => t.id === updated.id ? updated : t) })));
    ablyChannelRef.current?.publish("taskUpdated", { updatedTask: updated, senderId: myClientIdRef.current });
    
    fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "updateTask",
        task: { ...updated, id: updated.title },
        targetColumn: updated.sourceColumn,
      }),
    }).catch(() => {});
  };

  const handleColaboradorChange = async (taskId: string, newColaborador: string) => {
    const meta = getCollabMeta(newColaborador);
    let updatedTask: KanbanTask | null = null;

    setColumns(prev => prev.map(col => ({
      ...col,
      tasks: col.tasks.map(t => {
        if (t.id === taskId) {
          updatedTask = { ...t, colaborador: newColaborador, colaboradorInitials: meta.initials, colaboradorColor: meta.color };
          return updatedTask;
        }
        return t;
      })
    })));

    if (updatedTask) {
      ablyChannelRef.current?.publish("taskUpdated", { updatedTask, senderId: myClientIdRef.current });
      const cleanId = (updatedTask as KanbanTask).title;
      fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "updateColaborador", taskId: cleanId, colaborador: newColaborador }) }).catch(() => {});
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
      const cleanTask = { 
        ...taskToMove!, 
        id: taskToMove!.title,
        rowkey: taskToMove!.rowkey,
        sourceColumn: taskToMove!.sourceColumn,
      };
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
    
    const cleanTask = { 
      ...taskToReturn, 
      id: taskToReturn.title,
      rowkey: taskToReturn.rowkey,
      sourceColumn: taskToReturn.sourceColumn,
    };
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

    const apiAction = toColId === "acaost" ? "createActionST" : toColId === "baixaocupacao" ? "createBaixaOcupacao" : "updateTask";
    const cleanTask = { 
      ...preparedTask, 
      id: preparedTask.title,
      rowkey: taskToMove.rowkey,
      sourceColumn: taskToMove.sourceColumn,
    };
    
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
        const matchesColaborador = filterColaborador === "Todos" || t.colaborador === filterColaborador;
        
        const q = searchQuery.trim().toLowerCase();
        const matchesSearch = !q || 
          String(t.title).toLowerCase().includes(q) || 
          String(t.ionix).toLowerCase().includes(q) || 
          String(t.cluster).toLowerCase().includes(q) || 
          String(t.description).toLowerCase().includes(q);

        return matchesColaborador && matchesSearch;
      }) : [],
    })), [columns, filterColaborador, searchQuery]
  );

  const duplicateTitleSet = useMemo(() => {
    const count: Record<string, number> = {};
    columns.forEach(col => col.tasks.forEach(t => { count[t.title] = (count[t.title] || 0) + 1; }));
    return new Set(Object.entries(count).filter(([, n]) => n > 1).map(([k]) => k));
  }, [columns]);

  const navItems = [
    { id: "kanban",        label: "Kanban",        icon: <LayoutGrid size={18} /> },
    { id: "colaboradores", label: "Colaboradores", icon: <Users size={18} /> },
    { id: "relatorios",    label: "Relatórios",    icon: <BarChart3 size={18} /> },
    { id: "estoque",       label: "Estoque",       icon: <Package size={18} /> },
    { id: "respostas",     label: "Respostas",     icon: <MessageSquare size={18} /> },
    { id: "requisicoes",   label: "Requisições",   icon: <Upload size={18} /> },
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
    <ErrorBoundary>
    <div className="flex h-screen overflow-hidden" style={{ background: "#f1f5f9" }}>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={dismissToast} />}

      {/* ─── POPUP NOTIFICAÇÃO ADMIN ─── */}
      {showAdminNotif && adminNotif && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-16 px-4" style={{ pointerEvents: "none" }}>
          <div
            className="w-full max-w-lg rounded-3xl shadow-2xl border overflow-hidden animate-bounce-in"
            style={{ background: "#0f172a", borderColor: "#4f46e5", pointerEvents: "all" }}
          >
            <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #4f46e5, #7c3aed, #f97316)" }} />
            <div className="px-6 py-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}>
                  <Zap size={16} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#818cf8" }}>📢 Aviso do Admin</span>
                    <span className="text-[9px] text-slate-500">{new Date(adminNotif.ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  <p className="text-white font-bold text-sm leading-relaxed">{adminNotif.text}</p>
                </div>
                <button
                  onClick={handleDismissAdminNotif}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL COMPOR NOTIFICAÇÃO ADMIN ─── */}
      {showAdminCompose && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(10,16,36,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md rounded-3xl shadow-2xl overflow-hidden" style={{ background: "#fff" }}>
            <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #4f46e5, #7c3aed, #f97316)" }} />
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}>
                    <Zap size={14} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-[#0f172a]">Nova Notificação</p>
                    <p className="text-[10px] text-slate-400">Aparecerá para todos os usuários</p>
                  </div>
                </div>
                <button onClick={() => setShowAdminCompose(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
                  <X size={15} />
                </button>
              </div>
              <textarea
                value={adminMsgDraft}
                onChange={e => setAdminMsgDraft(e.target.value)}
                placeholder="Ex: Atacar o item X hoje! Prioridade máxima para cluster Sul..."
                rows={4}
                className="w-full text-sm px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-400 resize-none font-medium text-[#0f172a]"
                autoFocus
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleSendAdminNotif}
                  disabled={!adminMsgDraft.trim()}
                  className="flex-1 flex items-center justify-center gap-2 text-sm font-black py-2.5 rounded-2xl text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
                >
                  <Zap size={14} /> Enviar Notificação
                </button>
                <button onClick={() => setShowAdminCompose(false)} className="px-4 py-2.5 rounded-2xl border text-sm text-slate-400 hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {openTask && (
        <TaskDetailModal
          task={openTask.task}
          columnId={openTask.columnId}
          onClose={() => setOpenTask(null)}
          onUpdate={updateTask}
          onComplete={(colId, taskId) => { handleCompleteTask(colId, taskId); setOpenTask(null); }}
          onRemove={handleRemoveFromCompleted}
          onReturn={(colId, taskId) => { handleReturnTask(colId, taskId); setOpenTask(null); }}
          idsComMaterialRegistrado={respostasPorId}
          onMaterialRegistrado={() => {
            showToast("Consumo registrado! Atualizando estoque...", "success");
            loadKanban(true);
          }}
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
              <h1 className="text-base font-black text-[#0f172a]">
                {activeNav === "kanban" ? "Kanban ST" : activeNav === "colaboradores" ? "Colaboradores" : activeNav === "relatorios" ? "Relatórios" : activeNav === "estoque" ? "Estoque" : activeNav === "respostas" ? "Respostas de Uso" : activeNav === "requisicoes" ? "Requisições de Material" : "Configurações"}
              </h1>
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
                <span>{filterColaborador}</span>
                <ChevronDown size={12} />
              </button>
              {filterOpen && (
                <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-100 rounded-2xl shadow-xl z-30 py-1.5 min-w-[170px]">
                  {["Todos", ...COLLABORATORS.map(c => c.name)].map(name => (
                    <button
                      key={name}
                      onClick={() => { setFilterColaborador(name); setFilterOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
                      style={{ color: filterColaborador === name ? "#4f46e5" : "#334155" }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pl-3 ml-1" style={{ borderLeft: "1px solid #e2e8f0" }}>
              {/* Botão de notificação */}
              <div className="relative">
                <button
                  onClick={() => adminNotif ? setShowAdminNotif(v => !v) : (isAdmin ? setShowAdminCompose(true) : null)}
                  title={adminNotif ? "Ver aviso do admin" : isAdmin ? "Enviar notificação" : "Sem avisos"}
                  className="p-2 rounded-xl hover:bg-slate-100 transition-colors relative"
                  style={{ color: adminNotif ? "#4f46e5" : "#94a3b8" }}
                >
                  <AlertCircle size={17} />
                  {showAdminNotif && adminNotif && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
                  )}
                </button>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setShowAdminCompose(true)}
                  title="Nova notificação para a equipe"
                  className="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-xl text-white transition-all"
                  style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
                >
                  <Zap size={12} /> Avisar equipe
                </button>
              )}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white font-black text-[10px] shrink-0 ring-2 ring-white"
                style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
                title={loggedInEmail}
              >
                {loggedInEmail.substring(0, 2).toUpperCase()}
              </div>
              <button
                onClick={() => { if (confirm("Sair da sua conta?")) onLogout(); }}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-rose-500 transition-colors"
                title="Sair"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </header>

        {activeNav === "colaboradores" && <ColaboradoresView columns={columns} />}
        {activeNav === "relatorios" && <RelatoriosView columns={columns} />}
        {activeNav === "estoque" && <EstoqueView />}
        {activeNav === "respostas" && <RespostasView />}
        {activeNav === "requisicoes" && <RequisicaoView />}
        {activeNav === "configuracoes" && (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm font-semibold">
            <div className="text-center">
              <Settings size={32} className="mx-auto mb-2 opacity-30" />
              <p>Configurações em breve</p>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-x-auto overflow-y-hidden" style={{ display: activeNav === "kanban" ? "flex" : "none" }}>
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
                    const meta = getCollabMeta(task.colaborador);
                    const isDuplicate = duplicateTitleSet.has(task.title);
                    const hasMaterial = !!(respostasPorId[task.title]?.length);
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => handleDragStart(task.id, col.id)}
                        onDragEnd={() => { setDragState(null); setDragOverCol(null); }}
                        className="rounded-2xl shadow-sm group hover:shadow-md transition-all cursor-grab active:cursor-grabbing overflow-hidden"
                        style={{
                          border: isDuplicate ? "1.5px solid #f59e0b" : hasMaterial ? "1.5px solid #10b981" : "1px solid #e8ecf4",
                          opacity: dragState?.taskId === task.id ? 0.3 : 1,
                          background: isDuplicate ? "#fffdf0" : hasMaterial ? "#f0fdf4" : "#fff",
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
                                {hasMaterial && (
                                  <span className="shrink-0 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md flex items-center gap-0.5" style={{ background: "#dcfce7", color: "#15803d", border: "1px solid #86efac" }}>
                                    ✓ Material
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
                                  title={task.colaborador === "Não atribuído" ? "Sem perfil" : task.colaborador }
                                >
                                  {meta.initials}
                                </div>
                                <select
                                  value={task.colaborador}
                                  onChange={e => handleColaboradorChange(task.id, e.target.value)}
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
    </ErrorBoundary>
  );
}

// ─── TELA DE LOGIN / CRIAR CONTA ───
type AuthMode = "entrar" | "cadastro";
interface SessionInfo { email: string; token: string; }

function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: SessionInfo) => void }) {
  const [mode, setMode] = useState<AuthMode>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmSenha, setConfirmSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);

  const resetMessages = () => { setError(""); setInfo(""); };

  const handleEntrar = async () => {
    resetMessages();
    if (!email.trim() || !senha) { setError("Preencha e-mail e senha."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "loginUser", email: email.trim(), senha }),
      });
      const result = await res.json().catch(() => ({ status: "error", message: "Resposta inválida do servidor." }));

      if (result.status === "success" && result.approved) {
        onAuthenticated({ email: result.email, token: result.token });
        return;
      }
      if (result.status === "success" && result.approved === false && result.pending) {
        setInfo(result.message || "Seu cadastro está aguardando aprovação do administrador.");
        return;
      }
      setError(result.message || "E-mail ou senha incorretos.");
    } catch {
      setError("Não foi possível conectar. Verifique sua internet.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCadastro = async () => {
    resetMessages();
    if (!email.trim() || !senha) { setError("Preencha e-mail e senha."); return; }
    if (senha.length < 4) { setError("Use uma senha com pelo menos 4 caracteres."); return; }
    if (senha !== confirmSenha) { setError("As senhas não coincidem."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "registerUser", email: email.trim(), senha }),
      });
      const result = await res.json().catch(() => ({ status: "error", message: "Resposta inválida do servidor." }));

      if (result.status === "success") {
        setMode("entrar");
        setSenha("");
        setConfirmSenha("");
        setInfo("Cadastro enviado! Aguarde a liberação do administrador para entrar.");
      } else {
        setError(result.message || "Não foi possível criar a conta.");
      }
    } catch {
      setError("Não foi possível conectar. Verifique sua internet.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (mode === "entrar") handleEntrar(); else handleCadastro();
  };

  return (
    <div className="flex h-screen items-center justify-center px-4" style={{ background: "#0f172a" }}>
      <div className="relative w-full rounded-3xl shadow-2xl overflow-hidden" style={{ maxWidth: 400, background: "#fff" }}>
        <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #4f46e5, #7c3aed, #db2777)" }} />

        <div className="px-8 pt-8 pb-5">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}>
            <LayoutGrid size={20} className="text-white" />
          </div>
          <h1 className="text-xl font-black text-[#0f172a]">Kanban ST</h1>
          <p className="text-xs text-slate-400 font-medium mt-1">
            {mode === "entrar" ? "Entre com seu e-mail e senha." : "Crie sua conta para solicitar acesso."}
          </p>
        </div>

        <div className="flex px-8 gap-1 mb-1">
          {(["entrar", "cadastro"] as AuthMode[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); resetMessages(); }}
              className="flex-1 text-xs font-bold py-2.5 rounded-xl transition-all"
              style={{
                background: mode === m ? "#eef2ff" : "transparent",
                color: mode === m ? "#4f46e5" : "#94a3b8",
              }}
            >
              {m === "entrar" ? "Entrar" : "Criar conta"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="px-8 pb-8 pt-4 space-y-3">
          <div className="relative">
            <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="username"
              className="w-full text-sm pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-300 transition-colors"
            />
          </div>
          <div className="relative">
            <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="Senha"
              autoComplete={mode === "entrar" ? "current-password" : "new-password"}
              className="w-full text-sm pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-300 transition-colors"
            />
          </div>
          {mode === "cadastro" && (
            <div className="relative">
              <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                type="password"
                value={confirmSenha}
                onChange={e => setConfirmSenha(e.target.value)}
                placeholder="Confirmar senha"
                autoComplete="new-password"
                className="w-full text-sm pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-300 transition-colors"
              />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs font-medium px-3.5 py-2.5 rounded-xl border" style={{ background: "#fff1f2", borderColor: "#fecdd3", color: "#9f1239" }}>
              <AlertCircle size={13} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}
          {info && (
            <div className="flex items-start gap-2 text-xs font-medium px-3.5 py-2.5 rounded-xl border" style={{ background: "#fffbeb", borderColor: "#fde68a", color: "#92400e" }}>
              <AlertCircle size={13} className="shrink-0 mt-0.5" /> {info}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl text-white transition-all"
            style={{ background: submitting ? "#94a3b8" : "linear-gradient(135deg, #4f46e5, #4338ca)" }}
          >
            {submitting ? <RefreshCw size={14} className="animate-spin" /> : null}
            {mode === "entrar" ? "Entrar" : "Solicitar acesso"}
          </button>
        </form>

        <div className="px-8 pb-6 -mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAdmin(true)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-indigo-500 transition-colors"
          >
            <ShieldCheck size={12} /> Sou administrador
          </button>
        </div>
      </div>

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );
}

// ─── PAINEL DO ADMINISTRADOR ───
interface PendingUser { email: string; status: string; }

function AdminPanel({ onClose }: { onClose: () => void }) {
  const [adminSenha, setAdminSenha] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const loadUsers = async () => {
    if (!adminSenha) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "adminListUsers", adminSenha }),
      });
      const result = await res.json().catch(() => ({ status: "error", message: "Resposta inválida." }));
      if (result.status === "success") {
        setUsers(result.users || []);
        setUnlocked(true);
      } else {
        setError(result.message || "Senha de administrador incorreta.");
      }
    } catch {
      setError("Não foi possível conectar.");
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (email: string, newStatus: string) => {
    setBusyEmail(email);
    setError("");
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "adminUpdateUserStatus", adminSenha, email, newStatus }),
      });
      const result = await res.json().catch(() => ({ status: "error" }));
      if (result.status === "success") {
        setUsers(prev => prev.map(u => u.email === email ? { ...u, status: newStatus } : u));
      } else {
        setError(result.message || "Não foi possível atualizar.");
      }
    } catch {
      setError("Não foi possível conectar.");
    } finally {
      setBusyEmail(null);
    }
  };

  const statusBadge = (status: string) => {
    const s = (status || "pendente").toLowerCase();
    if (s === "liberado") return { label: "Liberado", bg: "#f0fdf4", text: "#16a34a" };
    if (s === "negado" || s === "sem access" || s === "sem acesso") return { label: "Negado", bg: "#fff1f2", text: "#e11d48" };
    return { label: "Pendente", bg: "#fffbeb", text: "#d97706" };
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{ background: "rgba(10,16,36,0.7)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full rounded-3xl shadow-2xl overflow-hidden flex flex-col" style={{ maxWidth: 440, maxHeight: "80vh", background: "#fff" }}>
        <div className="h-1.5 w-full shrink-0" style={{ background: "linear-gradient(90deg, #4f46e5, #7c3aed, #db2777)" }} />
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-indigo-500" />
            <h2 className="text-sm font-black text-[#0f172a]">Aprovação de acessos</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 text-[#6b7a99] transition-colors">
            <X size={15} />
          </button>
        </div>

        {!unlocked ? (
          <div className="px-6 py-6 space-y-3">
            <p className="text-xs text-slate-400">Digite a senha de administrador para ver as solicitações.</p>
            <input
              type="password"
              value={adminSenha}
              onChange={e => setAdminSenha(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadUsers()}
              placeholder="Senha de administrador"
              autoFocus
              className="w-full text-sm px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-300"
            />
            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
            <button
              onClick={loadUsers}
              disabled={loading || !adminSenha}
              className="w-full flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl text-white"
              style={{ background: loading || !adminSenha ? "#94a3b8" : "#4f46e5" }}
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Acessar
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
            {error && <p className="text-xs font-medium text-rose-600 mb-2">{error}</p>}
            {users.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Nenhum cadastro encontrado.</p>}
            {users.map(u => {
              const badge = statusBadge(u.status);
              const isBusy = busyEmail === u.email;
              return (
                <div key={u.email} className="flex items-center justify-between gap-2 px-3.5 py-3 rounded-2xl border border-gray-100" style={{ background: "#f8fafc" }}>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#0f172a] truncate">{u.email}</p>
                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md inline-block mt-1" style={{ background: badge.bg, color: badge.text }}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {badge.label !== "Liberado" && (
                      <button
                        disabled={isBusy}
                        onClick={() => updateStatus(u.email, "liberado")}
                        className="text-[10px] font-black px-2.5 py-1.5 rounded-lg text-white"
                        style={{ background: "#10b981", opacity: isBusy ? 0.6 : 1 }}
                      >
                        Aprovar
                      </button>
                    )}
                    {badge.label !== "Negado" && (
                      <button
                        disabled={isBusy}
                        onClick={() => updateStatus(u.email, "negado")}
                        className="text-[10px] font-black px-2.5 py-1.5 rounded-lg"
                        style={{ background: "#fff1f2", color: "#e11d48", opacity: isBusy ? 0.6 : 1 }}
                      >
                        Negar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PORTÃO DE AUTENTICAÇÃO ───
export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    (async () => {
      let saved: SessionInfo | null = null;
      try { saved = JSON.parse(localStorage.getItem(LS_SESSION_KEY) || "null"); } catch {}
      if (!saved?.email || !saved?.token) { setCheckingSession(false); return; }

      try {
        const res = await fetch(API_URL, {
          method: "POST",
          body: JSON.stringify({ action: "validateSession", email: saved.email, token: saved.token }),
        });
        const result = await res.json().catch(() => ({ status: "error" }));
        if (result.status === "success") {
          setSession(saved);
        } else {
          localStorage.removeItem(LS_SESSION_KEY);
        }
      } catch {
        setSession(saved);
      }
      setCheckingSession(false);
    })();
  }, []);

  if (checkingSession) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "#0f172a" }}>
        <RefreshCw size={22} className="text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        onAuthenticated={(s) => {
          try { localStorage.setItem(LS_SESSION_KEY, JSON.stringify(s)); } catch {}
          setSession(s);
        }}
      />
    );
  }

  return (
    <KanbanBoard
      loggedInEmail={session.email}
      onLogout={() => {
        try { localStorage.removeItem(LS_SESSION_KEY); } catch {}
        setSession(null);
      }}
    />
  );
}