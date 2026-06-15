// src/useUserData.ts
// Hook responsável por carregar e salvar anotações, checklist e subtasks
// compartilhados entre todos os usuários, na aba "userdata" do Google Sheets.
// Cada item carrega um campo "author" indicando quem o criou.

import { useState, useEffect, useCallback } from "react";
import type { User } from "firebase/auth";

const API_URL = "https://script.google.com/macros/s/AKfycbzRN6LZWIgtuZ7IXkuc4-zP-vOoFSmeqQPEAYpzuVgdEGQX9eCiLIMAd2jWFZgoy9SdFA/exec";

// Itens individuais agora carregam "author" (nome de quem criou)
export interface Annotation {
  id: string;
  text: string;
  createdAt: string;
  author: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  author: string;
}

export interface Subtask {
  id: string;
  title: string;
  assignee: string;
  status: string;
  author: string;
}

// Estrutura de cada linha da aba userdata (1 linha por taskId, compartilhada)
export interface UserTaskData {
  taskid:      string;
  annotations: Annotation[];
  checklist:   ChecklistItem[];
  subtasks:    Subtask[];
}

export function useUserData(user: User | null) {
  // Mapa: taskId → dados compartilhados daquela tarefa
  const [userDataMap, setUserDataMap] = useState<Record<string, UserTaskData>>({});
  const [loadingData, setLoadingData] = useState(false);

  // Carrega todos os dados compartilhados ao fazer login
  useEffect(() => {
    if (!user) {
      setUserDataMap({});
      return;
    }
    setLoadingData(true);

    fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "getUserData" }),
    })
      .then(r => r.json())
      .then((rows: UserTaskData[]) => {
        const map: Record<string, UserTaskData> = {};
        rows.forEach(row => { map[row.taskid] = row; });
        setUserDataMap(map);
      })
      .catch(console.error)
      .finally(() => setLoadingData(false));
  }, [user]);

  // Salva os dados compartilhados de uma tarefa específica (chamado ao fechar o modal)
  const saveTaskData = useCallback(
    async (taskId: string, data: Omit<UserTaskData, "taskid">) => {
      if (!user) return;

      // Atualiza local imediatamente (otimista)
      setUserDataMap(prev => ({
        ...prev,
        [taskId]: { taskid: taskId, ...data },
      }));

      // Persiste no Sheets em background (compartilhado, sem userId)
      try {
        await fetch(API_URL, {
          method: "POST",
          body: JSON.stringify({
            action:      "saveUserData",
            taskId,
            annotations: data.annotations,
            checklist:   data.checklist,
            subtasks:    data.subtasks,
          }),
        });
      } catch (err) {
        console.error("Erro ao salvar userdata:", err);
      }
    },
    [user]
  );

  return { userDataMap, loadingData, saveTaskData };
}