/**
 * @deprecated Atualização avulsa de NCM (Portal Único Siscomex) — DESATIVADA.
 *
 * A sincronização falhava em ambiente corporativo (CORS/proxy/TLS/rate-limit)
 * e foi removida da UI. As tabelas NCM viajam embutidas em `dist/base` e são
 * renovadas pela atualização geral do programa (electron-updater).
 *
 * Arquivo mantido apenas como referência — sem chamadas ativas na aplicação.
 */
import {
  deveSincronizarNcm,
  diagnosticarConexaoNcm,
  importarTabelaNcmJson,
  obterStatusNcm,
  sincronizarNomenclatura,
  type NcmSyncResultado,
} from '@/infrastructure/siscomex/ncm-sync'
import { toast } from '@/store/ui'
import { revalidarBaseGravada, resumirRevalidacao } from './revalidacao'

export type { NcmSyncResultado }

/**
 * Verificação automática em background (não bloqueia a UI).
 * Só avisa quando há mudança, extintos ou erro — silêncio quando inalterado.
 */
export async function sincronizacaoAutomaticaNcm(): Promise<NcmSyncResultado | null> {
  let deve: boolean
  try {
    deve = await deveSincronizarNcm()
  } catch (e) {
    console.warn('[NCM Sync] Falha ao ler metadados:', e)
    return null
  }
  if (!deve) return null

  const promessa = sincronizarNomenclatura()
  promessa
    .then((r) => {
      if (r.status === 'atualizado') {
        toast(`✅ Tabela NCM atualizada (${r.vigencia ?? 'nova vigência'}): ${r.mensagem}.`, 'ok')
        if ((r.extintos ?? 0) > 0) {
          toast(
            `⛔ ${r.extintos} código(s) saíram da tabela vigente e foram marcados como extintos. Confira os produtos com esses NCM.`,
            'warn',
          )
        }
        // Regra mudou → reaplica a vigente em tudo que já foi gravado.
        void revalidarBaseGravada()
          .then((rev) => {
            if (rev.produtos || rev.notas) toast(`🔄 Base gravada atualizada: ${resumirRevalidacao(rev)}.`, 'ok')
          })
          .catch(() => undefined)
      } else if (r.status === 'erro') {
        toast(`⚠️ Atualização NCM falhou: ${r.mensagem}`, 'warn')
      }
    })
    .catch((e) => {
      console.warn('[NCM Sync] Falha na sincronização automática:', e)
    })
  return promessa
}

/**
 * Sincronização manual (botão na UI) — sempre relata o resultado.
 */
export async function sincronizacaoManualNcm(
  onProgress?: (etapa: string, pct: number) => void,
): Promise<NcmSyncResultado> {
  toast('🔄 Consultando a tabela NCM vigente no Portal Siscomex...', '')
  onProgress?.('Baixando tabela oficial', 20)
  const r = await sincronizarNomenclatura()
  onProgress?.('Concluído', 100)
  if (r.status === 'atualizado') {
    toast(`✅ ${r.mensagem}.`, 'ok')
    try {
      const rev = await revalidarBaseGravada()
      if (rev.produtos || rev.notas) toast(`🔄 Base gravada atualizada: ${resumirRevalidacao(rev)}.`, 'ok')
    } catch {
      /* revalidação complementar */
    }
  }
  else if (r.status === 'inalterado') toast('ℹ️ Tabela NCM já está atualizada.', '')
  else toast(`❌ ${r.mensagem}`, 'err')
  return r
}

/**
 * Importação manual do JSON baixado no portal (o `blob:` do navegador não é
 * reutilizável — salve o arquivo e importe aqui).
 */
export async function importarTabelaNcm(json: unknown, nomeArquivo: string) {
  const r = await importarTabelaNcmJson(json)
  if (r.status === 'atualizado') {
    toast(`✅ ${nomeArquivo}: ${r.mensagem}.`, 'ok')
    try {
      const rev = await revalidarBaseGravada()
      if (rev.produtos || rev.notas) toast(`🔄 Base gravada atualizada: ${resumirRevalidacao(rev)}.`, 'ok')
    } catch {
      /* revalidação complementar */
    }
  } else {
    toast(`❌ ${nomeArquivo}: ${r.mensagem}`, 'err')
  }
  return r
}

/** Status atual da sincronização NCM para a UI. */
export async function statusSincronizacaoNcm() {
  return obterStatusNcm()
}

/**
 * Diagnóstico de conexão (botão "Testar conexão"): rápido, não grava nada.
 * Devolve o passo a passo para a UI exibir e copiar para o suporte.
 */
export async function testarConexaoNcm() {
  return diagnosticarConexaoNcm()
}
