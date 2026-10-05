/**
 * Novidades e aviso de atualização — job 100% local, sem backend.
 *
 * Duas responsabilidades, ambas sem rede própria:
 *
 * 1. PÓS-ATUALIZAÇÃO: no boot, compara a versão instalada
 *    (`versaoInstalada()`) com `CHAVE_VERSAO_VISTA`. Mudou e há entrada em
 *    `NOTAS_VERSAO` → abre o modal `novidades` uma única vez.
 *    Primeira instalação nunca exibe (só carimba a versão atual).
 *
 * 2. BACKGROUND: assina os eventos do auto-updater (o processo principal já
 *    verifica sozinho 30 s após abrir + a cada 6 h) e agenda uma
 *    reverificação silenciosa de reforço (90 s + a cada 6 h) para o caso de
 *    o evento ter chegado antes da assinatura. Nova versão encontrada →
 *    abre o modal `novidades` em modo `disponivel` uma única vez por versão.
 *
 * A exibição usa o sistema global de modais (`useUi.modal = 'novidades'`,
 * renderizado em `ModaisGlobais`). Fora do Electron (navegador) só a parte
 * pós-atualização é pulada — `versaoInstalada()` devolve '—'.
 */
import { create } from 'zustand'
import { baixarAtualizacao, versaoInstalada } from '@/application/atualizacao'
import { bridge } from '@/infrastructure/bridge'
import {
  CHAVE_VERSAO_NOTIFICADA,
  CHAVE_VERSAO_VISTA,
  NOTAS_VERSAO,
} from '@/domain/constants/notas-versao'
import { useUi, toast } from '@/store/ui'

export type ModoNovidades = 'novidades' | 'disponivel'

/** Exibe as notas da versão atual? (pura, testável). */
export function deveExibirNovidades(vista: string | null, atual: string): boolean {
  if (!atual || atual === '—') return false
  if (vista == null || vista === '') return false // primeira instalação: carimba em silêncio
  return vista !== atual && NOTAS_VERSAO[atual] != null
}

/** Notifica a versão nova para download? (pura, testável). */
export function deveNotificarDisponivel(notificada: string | null, nova: string | null): boolean {
  if (!nova) return false
  return notificada !== nova
}

function ler(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function gravar(key: string, valor: string): void {
  try {
    localStorage.setItem(key, valor)
  } catch {
    /* armazenamento indisponível: vale só na sessão */
  }
}

interface NovidadesState {
  /** O que o modal mostra (`null` = nada a exibir). */
  modo: ModoNovidades | null
  /** Versão cujas notas estão em exibição (modo `novidades`). */
  versaoNotas: string | null
  /** Versão nova disponível para download (modo `disponivel`). */
  versaoNova: string | null
  /** Notas remotas do Release (texto puro, pode ser `null`). */
  notasRemotas: string | null
  /** Liga o job (idempotente): boot + eventos + polling silencioso. */
  iniciar: () => void
  /** Reabre as notas da versão instalada (botão "Novidades" em Config). */
  reabrir: () => void
  /** Fecha o modal de notas e carimba a versão como vista. */
  marcarVistaEFechar: () => void
  /** Fecha o modal de aviso sem baixar (lembra para não reabrir). */
  adiarAtualizacao: () => void
}

let iniciado = false

/** Checagem pós-boot: versão mudou e há notas? */
async function checarPosAtualizacao(): Promise<void> {
  const atual = await versaoInstalada().catch(() => '—')
  if (!atual || atual === '—') return
  const vista = ler(CHAVE_VERSAO_VISTA)
  if (vista == null || vista === '') {
    gravar(CHAVE_VERSAO_VISTA, atual)
    return
  }
  if (deveExibirNovidades(vista, atual)) {
    useNovidades.setState({ modo: 'novidades', versaoNotas: atual })
    useUi.getState().abrirModal('novidades')
  }
}

/** Avisa uma versão nova uma única vez (evento ou polling). */
function anunciarDisponivel(versao: string | null, notas: string | null): void {
  if (!deveNotificarDisponivel(ler(CHAVE_VERSAO_NOTIFICADA), versao)) return
  gravar(CHAVE_VERSAO_NOTIFICADA, versao ?? '')
  useNovidades.setState({ modo: 'disponivel', versaoNova: versao, notasRemotas: notas })
  useUi.getState().abrirModal('novidades')
  toast(`Nova versão disponível para download: ${versao ?? ''}.`, 'ok')
}

/** Reverificação silenciosa (sem toast): reforço do evento do main. */
async function reverificarSilencioso(): Promise<void> {
  if (!bridge) return
  try {
    const r = await bridge.verificarAtualizacao()
    if (r?.disponivel) anunciarDisponivel(r.versao ?? null, r.notas ?? null)
  } catch {
    /* offline ou sem release: tenta de novo no próximo ciclo */
  }
}

const SEIS_HORAS = 6 * 60 * 60 * 1000

export const useNovidades = create<NovidadesState>((set) => ({
  modo: null,
  versaoNotas: null,
  versaoNova: null,
  notasRemotas: null,

  iniciar: () => {
    if (iniciado) return
    iniciado = true
    // Boot adiado: não bloqueia a primeira dobra.
    window.setTimeout(() => void checarPosAtualizacao(), 2000)
    if (!bridge) return
    // Eventos do processo principal (check 30 s + 6 h no `main.ts`).
    bridge.onAtualizacao((ev) => {
      if (ev.tipo === 'disponivel') anunciarDisponivel(ev.versao ?? null, ev.notas ?? null)
    })
    // Reforço caso o evento tenha chegado antes da assinatura.
    window.setTimeout(() => void reverificarSilencioso(), 90_000)
    window.setInterval(() => void reverificarSilencioso(), SEIS_HORAS)
  },

  reabrir: () => {
    const atual = useNovidades.getState()
    const versao = atual.versaoNotas ?? atual.versaoNova
    void versaoInstalada()
      .catch(() => '—')
      .then((v) => {
        const alvo = v && v !== '—' ? v : versao
        if (!alvo || !NOTAS_VERSAO[alvo]) {
          toast('Sem notas cadastradas para esta versão.', 'warn')
          return
        }
        set({ modo: 'novidades', versaoNotas: alvo })
        useUi.getState().abrirModal('novidades')
      })
  },

  marcarVistaEFechar: () => {
    const { versaoNotas } = useNovidades.getState()
    if (versaoNotas) gravar(CHAVE_VERSAO_VISTA, versaoNotas)
    set({ modo: null, versaoNotas: null })
    useUi.getState().abrirModal(null)
  },

  adiarAtualizacao: () => {
    set({ modo: null })
    useUi.getState().abrirModal(null)
  },
}))

/** Baixa a versão anunciada (usado pelo modal; toast de erro já incluso). */
export async function baixarVersaoAnunciada(): Promise<boolean> {
  return baixarAtualizacao()
}
