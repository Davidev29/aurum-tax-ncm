/**
 * Preload do renderer — Aurum Tax NCM.
 *
 * Expõe `window.aurum` via `contextBridge`, atendendo exatamente ao contrato
 * declarado em `src/infrastructure/bridge.ts` (`AurumBridge`).
 *
 * O renderer roda com `contextIsolation: true` e sem Node; toda a I/O de
 * arquivos acontece nos canais IPC registrados por `electron/main.ts`.
 * Este arquivo é compilado pelo esbuild (`electron/esbuild.mjs`) para
 * `electron/dist/preload.cjs`.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AurumBridge,
  EventoAtualizacao,
  ResultadoGrafoBridge,
} from '../src/infrastructure/bridge'
import type { DbOp } from '../src/infrastructure/db/db-protocolo'

/**
 * Versão do aplicativo, repassada pelo processo principal por meio de
 * `webPreferences.additionalArguments` (`--aurum-versao=x.y.z`, ver `main.ts`).
 * `app.getVersion()` só existe no processo principal.
 */
function versaoDoApp(): string {
  const argumento = process.argv.find((item) => item.startsWith('--aurum-versao='))
  if (argumento) return argumento.slice(argumento.indexOf('=') + 1)
  return process.env.npm_package_version ?? ''
}

const aurum: AurumBridge = {
  versao: versaoDoApp(),
  plataforma: process.platform,

  /**
   * Banco SQLite (canal `db:op` → Prisma no processo main).
   * Transporte cru de operações validadas no main; registros precisam ser
   * JSON-puros (o Prisma rejeita `undefined` em campos Json nulos? não —
   * `undefined` vira NULL/default; funções e símbolos não atravessam IPC).
   */
  db: {
    op: (req: DbOp) => ipcRenderer.invoke('db:op', req),
    snapshotBanco: () => ipcRenderer.invoke('db:snapshot'),
    transacao: (ops: DbOp[]) => ipcRenderer.invoke('db:transaction', ops),
  },

  /** Lê um arquivo do diretório base como texto UTF-8. */
  lerArquivo: (caminho) => ipcRenderer.invoke('base:ler', caminho),

  /**
   * Mesmo arquivo transportado em base64 pelo processo principal
   * (canal `base:ler-base64`); o decode para texto UTF-8 acontece aqui,
   * pois o preload não sandboxizado tem `Buffer` disponível.
   */
  lerArquivoBase64: async (caminho) => {
    const base64 = (await ipcRenderer.invoke('base:ler-base64', caminho)) as string
    return Buffer.from(base64, 'base64').toString('utf8')
  },

  /** Abre o seletor de arquivo; o conteúdo vem em base64. `null` se cancelado. */
  escolherArquivo: (filtros) => ipcRenderer.invoke('arquivo:escolher', filtros),

  /** Abre o seletor de pasta; devolve o caminho ou `null` se cancelado. */
  escolherPasta: () => ipcRenderer.invoke('arquivo:escolher-pasta'),

  /** Grava `conteudo` (base64) no local escolhido pelo usuário. */
  salvarArquivo: (op) => ipcRenderer.invoke('arquivo:salvar', op),

  /** Baixa texto remoto (norma oficial) sem CORS. */
  buscarTexto: (url) => ipcRenderer.invoke('rede:buscar-texto', url),

  /** Guarda o XML da nota em `userData/xml/<cnpj>/<chave>.xml`. */
  salvarXml: (op) => ipcRenderer.invoke('xml:salvar', op),

  /** Lê um XML guardado (caminho relativo). */
  lerXml: (caminho) => ipcRenderer.invoke('xml:ler', caminho),

  /** Remove um XML guardado; inexistente não é erro. */
  removerXml: (caminho) => ipcRenderer.invoke('xml:remover', caminho),

  /** Assina as ações do menu nativo (canal `menu:acao`). */
  onMenu: (cb) => {
    // Assinatura única: novas chamadas substituem a anterior, evitando que
    // efeitos reexecutados no renderer disparem a mesma ação duas vezes.
    ipcRenderer.removeAllListeners('menu:acao')
    ipcRenderer.on('menu:acao', (_evento, payload: unknown) => {
      // O processo principal envia `{ acao }`; aceita também uma string crua.
      const acao =
        typeof payload === 'string' ? payload : (payload as { acao?: unknown } | null)?.acao
      if (typeof acao === 'string') cb(acao)
    })
  },

  /** Versão instalada (canal `atualizacao:versao`). */
  versaoApp: () => ipcRenderer.invoke('atualizacao:versao'),

  /** Consulta o GitHub Releases (canal `atualizacao:verificar`). */
  verificarAtualizacao: () => ipcRenderer.invoke('atualizacao:verificar'),

  /** Baixa a versão encontrada (canal `atualizacao:baixar`). */
  baixarAtualizacao: () => ipcRenderer.invoke('atualizacao:baixar'),

  /** Aplica a versão baixada e reinicia (canal `atualizacao:instalar`). */
  instalarAtualizacao: () => ipcRenderer.invoke('atualizacao:instalar'),

  /** Eventos do auto-updater (canal `atualizacao:evento`). Empilha ouvintes
      e devolve a desinscrição — o job de novidades e a aba Atualização
      escutam juntos sem se anular. */
  onAtualizacao: (cb) => {
    const handler = (_evento: unknown, payload: unknown) => {
      if (payload && typeof payload === 'object' && typeof (payload as { tipo?: unknown }).tipo === 'string') {
        cb(payload as EventoAtualizacao)
      }
    }
    ipcRenderer.on('atualizacao:evento', handler)
    return () => ipcRenderer.removeListener('atualizacao:evento', handler)
  },

  /**
   * Busca local (grafo fiscal via processo principal).
   *
   * O modelo de linguagem foi removido: a classificação é 100%
   * determinística (RAG lexical + grafo + resolvedor oficial). Aqui só o
   * round-trip IPC do grafo (`ia:grafo`/`ia:grafo-uso`).
   */
  ia: {
    /**
     * Grafo fiscal local (Phase 10-02 / GRAFO-02, híbrido em 10-03): FTS +
     * vetor + 2-hops no worker (`utilityProcess`) via canal `ia:grafo`.
     * Sem `.lbug` → `ok:false` + `fallback:'lexical'` (fail-closed, nunca
     * mock). `opts.modoVetor:'fts-puro'` força o modo lexical (toggle DebugIA).
     */
    grafoConsultar: (texto: string, k?: number, anoReferencia?: number, opts?: { modoVetor?: 'hibrido' | 'fts-puro' }): Promise<ResultadoGrafoBridge> =>
      ipcRenderer.invoke('ia:grafo', { texto, k, anoReferencia, modoVetor: opts?.modoVetor }),
    /**
     * Overlay de aprendizado (Phase 10-05 / GRAFO-08): escritor
     * `registrarUso({tipo, termo, codigo, emitente, peso})` com TTL 90d + teto
     * 5000 + demote. Best-effort (sem canal → rejeita, o renderer cai no
     * `localStorage`).
     */
    registrarUsoGrafo: (evento: { tipo: string; termo?: string | null; codigo?: string | null; emitente?: string | null; peso?: number }) =>
      ipcRenderer.invoke('ia:grafo-uso', evento),
  },
}

contextBridge.exposeInMainWorld('aurum', aurum)

export {}
