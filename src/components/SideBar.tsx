import {
  LayoutDashboard,
  Users,
  BarChart3,
  Settings,
} from "lucide-react";
import React from "react";

export default function Sidebar(): React.JSX.Element {
  return (
    <aside className="flex w-64 flex-col bg-[#16244A] text-white">
      <div className="border-b border-white/10 p-6">
        <h1 className="text-2xl font-bold">TLP</h1>
        <p className="text-sm text-slate-300">
          Serviços Empresariais
        </p>
      </div>

      <nav className="mt-4 flex-1">
        <button className="flex w-full items-center gap-3 border-l-4 border-orange-500 bg-orange-500/10 px-6 py-4 text-left">
          <LayoutDashboard size={20} />
          <span>Kanban</span>
        </button>

        <button className="flex w-full items-center gap-3 px-6 py-4 text-slate-300 hover:bg-white/5">
          <Users size={20} />
          <span>Colaboradores</span>
        </button>

        <button className="flex w-full items-center gap-3 px-6 py-4 text-slate-300 hover:bg-white/5">
          <BarChart3 size={20} />
          <span>Relatórios</span>
        </button>

        <button className="flex w-full items-center gap-3 px-6 py-4 text-slate-300 hover:bg-white/5">
          <Settings size={20} />
          <span>Configurações</span>
        </button>
      </nav>
    </aside>
  );
}