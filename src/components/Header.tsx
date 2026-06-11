import { Search, Bell, Filter } from "lucide-react";
import React from "react";

export default function Header(): React.JSX.Element {
  return (
    <header className="border-b border-slate-200 bg-white px-10 py-4">
      <div className="flex items-center justify-between">
        {/* Esquerda */}
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            Quadro Kanban
          </h1>

          <p className="mt-1 text-slate-500">
            Acompanhamento de atividades por colaborador
          </p>
        </div>

        {/* Direita */}
        <div className="flex items-center gap-4">
          {/* Busca */}
          <div className="relative">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              type="text"
              placeholder="Buscar atividade..."
              className="
                h-12
                w-80
                rounded-xl
                border
                border-slate-200
                bg-slate-50
                pl-11
                pr-4
                text-sm
                outline-none
                transition
                focus:border-orange-500
                focus:bg-white
              "
            />
          </div>

          {/* Filtro */}
          <button
            className="
              flex
              items-center
              gap-2
              rounded-xl
              border
              border-slate-200
              bg-slate-50
              px-4
              py-3
              hover:bg-white
            "
          >
            <Filter size={18} />
            <span>Todos</span>
          </button>

          {/* Notificação */}
          <button
            className="
              relative
              rounded-xl
              border
              border-slate-200
              bg-white
              p-3
              shadow-sm
              hover:shadow-md
            "
          >
            <Bell size={20} />

            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-orange-500" />
          </button>

          {/* Usuário */}
          <div className="flex items-center gap-3">
            <div
              className="
                flex
                h-11
                w-11
                items-center
                justify-center
                rounded-full
                bg-gradient-to-br
                from-orange-400
                to-orange-600
                font-bold
                text-white
                shadow-md
              "
            >
              C
            </div>

            <div>
              <p className="font-semibold text-slate-800">
                Camilly
              </p>

              <p className="text-sm text-slate-500">
                Administrador
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}