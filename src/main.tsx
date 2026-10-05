import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useBase } from './store/base';
import { useSessao } from './store/sessao';
import { useNovidades } from './store/novidades';
import './index.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Elemento #raiz não encontrado');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Semeia a base embutida e restaura a sessão (sem bloquear a primeira dobra).
void useBase.getState().iniciar();
void useSessao.getState().iniciar();
// Job de novidades: modal pós-atualização + aviso de versão nova em background.
useNovidades.getState().iniciar();
