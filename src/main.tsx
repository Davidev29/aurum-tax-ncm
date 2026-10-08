import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErroFatal } from './ui/ErroFatal';
import { useBase } from './store/base';
import { useSessao } from './store/sessao';
import { useNovidades } from './store/novidades';
import './index.css';

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Elemento #raiz não encontrado');

// Fail-closed do banco no Electron empacotado: sem a ponte `aurum.db`
// (preload) o motor cairia no driver em memória e os dados "sumiriam" no
// restart. Sem ponte não há boot — tela fatal em vez de perda silenciosa.
// No navegador puro (`window.aurum` ausente) a memória é legítima (dev web).
const aurum = (window as unknown as { aurum?: { db?: unknown } }).aurum;
if (aurum && !aurum.db) {
  raiz.innerHTML =
    '<main style="font-family:system-ui;padding:48px;max-width:640px;margin:0 auto">' +
    '<h1>Banco de dados indisponível</h1>' +
    '<p>O canal do banco local (SQLite) não respondeu. Por segurança, o app não iniciou para não perder seus dados.</p>' +
    '<p>Feche e abra novamente. Se persistir, reinstale pela mesma versão — seus XMLs e o banco ficam preservados em %APPDATA%.</p></main>';
  throw new Error('aurum.db ausente no preload (fail-closed)');
}

createRoot(raiz).render(
  <StrictMode>
    <ErroFatal nome="global">
      <App />
    </ErroFatal>
  </StrictMode>,
);

// Semeia a base embutida e restaura a sessão (sem bloquear a primeira dobra).
void useBase.getState().iniciar();
void useSessao.getState().iniciar();
// Job de novidades: modal pós-atualização + aviso de versão nova em background.
useNovidades.getState().iniciar();
