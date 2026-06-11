import React from "react";

// Definindo a estrutura de cada item de estatística
interface StatItem {
  title: string;
  value: string;
}

export default function StatsBar(): React.JSX.Element {
  // Tipando o array para garantir que ele siga a estrutura da interface
  const stats: StatItem[] = [
    {
      title: "Total de Atividades",
      value: "24",
    },
    {
      title: "Em Andamento",
      value: "8",
    },
    {
      title: "Concluídas",
      value: "12",
    },
    {
      title: "Atrasadas",
      value: "4",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-6 p-6">
      {stats.map((item) => (
        <div
          key={item.title}
          className="rounded-2xl bg-white p-6 shadow-sm"
        >
          <p className="text-sm text-slate-500">
            {item.title}
          </p>

          <h2 className="mt-2 text-3xl font-bold">
            {item.value}
          </h2>
        </div>
      ))}
    </div>
  );
}