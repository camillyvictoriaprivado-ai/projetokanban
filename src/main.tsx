import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css' // <-- O erro aqui vai sumir após o Passo 1
import App from './App' // <-- ATENÇÃO: Nunca coloque a extensão .tsx aqui

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Não foi possível encontrar o elemento 'root'. Verifique seu index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)