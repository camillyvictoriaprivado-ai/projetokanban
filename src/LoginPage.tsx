// src/LoginPage.tsx
import { useAuth } from "./useAuth";

export default function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#16244A] to-[#1a3060]">
      <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-sm flex flex-col items-center gap-6">

        {/* Logo / Marca */}
        <div className="flex flex-col items-center gap-1">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-lg">
            <span className="text-white text-2xl font-black">TLP</span>
          </div>
          <h1 className="text-2xl font-black text-[#1a2340] mt-2">Projeto Kanban</h1>
          <p className="text-sm text-slate-500 text-center">
            Faça login para acessar o quadro de atividades
          </p>
        </div>

        <div className="w-full h-px bg-slate-100" />

        {/* Botão Google */}
        <button
          onClick={login}
          className="
            w-full flex items-center justify-center gap-3
            border border-slate-200 rounded-xl px-4 py-3
            hover:bg-slate-50 hover:shadow-md
            transition-all duration-200
            font-semibold text-slate-700 text-sm
          "
        >
          {/* Ícone Google SVG */}
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.5 6.5 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19.1 13 24 13c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.5 6.5 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.2-5.5l-6.6-5.6C29.6 34.8 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-8H6.1C9.4 35.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.8l6.6 5.6C37.1 39.4 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/>
          </svg>
          Entrar com Google
        </button>

        <p className="text-xs text-slate-400 text-center">
          Apenas contas autorizadas pela TLP têm acesso ao sistema.
        </p>
      </div>
    </div>
  );
}
