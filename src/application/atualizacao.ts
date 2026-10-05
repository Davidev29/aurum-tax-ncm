/**
 * Atualização geral do programa (electron-updater + GitHub Releases).
 *
 * É neste fluxo que as bases tributárias embutidas (`dist/base`: NCM, CST,
 * cClassTrib, nomenclatura) são renovadas — não existe mais atualização
 * avulsa de NCM no sistema.
 *
 * Fora do Electron (navegador), tudo rejeita com mensagem acionável.
 */
import { bridge, type EventoAtualizacao, type VerificacaoAtualizacao } from '@/infrastructure/bridge'
import { toast } from '@/store/ui'

function semElectron(): Error {
  return new Error('Atualização automática disponível apenas no app instalado (Electron).')
}

/** Versão instalada (ou '—' no navegador). */
export async function versaoInstalada(): Promise<string> {
  if (bridge) {
    try {
      const r = await bridge.versaoApp()
      if (r?.versao) return r.versao
    } catch {
      /* cai no fallback abaixo */
    }
    return bridge.versao || '—'
  }
  return '—'
}

/** Verifica se há versão nova no GitHub Releases. Sempre relata o resultado. */
export async function verificarAtualizacaoManual(): Promise<VerificacaoAtualizacao | null> {
  if (!bridge) {
    toast('Atualização automática disponível apenas no app instalado.', 'warn')
    return null
  }
  toast('🔄 Verificando atualizações do programa…', '')
  try {
    const r = await bridge.verificarAtualizacao()
    if (r?.disponivel) {
      toast(`⬇ Nova versão disponível: ${r.versao ?? 'atualização'}. Baixe na aba Atualização.`, 'ok')
    } else {
      toast('ℹ️ Programa já está na versão mais recente.', '')
    }
    return r
  } catch (e) {
    toast(`❌ ${e instanceof Error ? e.message : String(e)}`, 'err')
    return null
  }
}

/** Baixa a versão encontrada. */
export async function baixarAtualizacao(): Promise<boolean> {
  if (!bridge) {
    toast(semElectron().message, 'warn')
    return false
  }
  try {
    await bridge.baixarAtualizacao()
    return true
  } catch (e) {
    toast(`❌ ${e instanceof Error ? e.message : String(e)}`, 'err')
    return false
  }
}

/** Aplica a versão baixada e reinicia o app. */
export async function instalarAtualizacao(): Promise<void> {
  if (!bridge) {
    toast(semElectron().message, 'warn')
    return
  }
  try {
    await bridge.instalarAtualizacao()
  } catch (e) {
    toast(`❌ ${e instanceof Error ? e.message : String(e)}`, 'err')
  }
}

/** Assina os eventos do auto-updater (verificação automática em background). */
export function assinarEventosAtualizacao(
  cb: (evento: EventoAtualizacao) => void,
): (() => void) | null {
  if (!bridge) return null
  return bridge.onAtualizacao(cb)
}
