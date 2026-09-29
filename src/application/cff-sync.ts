/**
 * Casos de uso para sincronização com a Conformidade Fácil (CFF).
 *
 * Integra a sincronização automática no fluxo de inicialização da aplicação.
 */

import {
  sincronizarTudo,
  forcarSincronizacao,
  obterStatusSincronizacao,
  deveSincronizar,
  importarClassificacaoProduto,
  listarCoberturaClassProd,
  obterBloqueiosParaCcts,
  type SyncResultado,
} from '@/infrastructure/cff/cff-sync'
import { SISTEMAS_CFF } from '@/domain/constants/cff-apis'
import { revalidarBaseGravada, resumirRevalidacao } from './revalidacao'
import { toast } from '@/store/ui'

export type { SyncResultado }
export { SISTEMAS_CFF }

/** Ícone/texto por status de sincronização (inclui bloqueio por certificado). */
function resumoEndpoint(resultado: SyncResultado): { titulo: string; nivel: 'ok' | 'err' | 'info' | 'warn' } {
  const { endpoint, status, mensagem, registros } = resultado
  const icone = status === 'atualizado' ? '✅' : status === 'inalterado' ? '⏭️' : status === 'certificado' ? '🔐' : '❌'
  if (status === 'atualizado') {
    return { titulo: `${icone} ${endpoint.servico}: ${registros} registro(s) atualizado(s)`, nivel: 'ok' }
  }
  if (status === 'inalterado') return { titulo: `${icone} ${endpoint.servico}: sem alterações`, nivel: 'info' }
  if (status === 'certificado') {
    return {
      titulo: `${icone} ${endpoint.servico}: exige certificado digital — importe o JSON manualmente.`,
      nivel: 'warn',
    }
  }
  return { titulo: `${icone} ${endpoint.servico}: erro - ${mensagem}`, nivel: 'err' }
}

/** Callback de progresso para sincronização CFF (inclui resultado parcial) */
export type CffProgresso = (etapa: string, pct: number, resultadoAtual?: SyncResultado) => void

/**
 * Verifica se deve sincronizar e executa em background se necessário.
 * Não bloqueia a inicialização da UI.
 * Mostra toasts de progresso e resultado final.
 */
export async function sincronizacaoAutomatica(
  onProgress?: CffProgresso,
): Promise<SyncResultado[] | null> {
  const deveSync = await deveSincronizar()

  if (!deveSync) {
    return null
  }

  // Toast de início (apenas para sync automático em background)
  toast('🔄 Verificando atualizações na Conformidade Fácil...', '')

  // Executa em background com callbacks de toast
  const promessa = sincronizarTudo((etapa, pct, resultado) => {
    onProgress?.(etapa, pct, resultado)

    // Toast para cada endpoint finalizado
    if (resultado) {
      const { titulo, nivel } = resumoEndpoint(resultado)
      toast(titulo, nivel === 'info' ? '' : nivel)
    }
  })

  // Toast de resumo final
  promessa.then((resultados) => {
    const atualizados = resultados.filter((r) => r.status === 'atualizado').length
    const inalterados = resultados.filter((r) => r.status === 'inalterado').length
    const erros = resultados.filter((r) => r.status === 'erro').length
    const certs = resultados.filter((r) => r.status === 'certificado').length

    if (atualizados > 0) {
      toast(`✅ Sincronização CFF concluída: ${atualizados} endpoint(s) atualizado(s)${inalterados ? `, ${inalterados} sem alterações` : ''}${erros ? `, ${erros} erro(s)` : ''}${certs ? `, ${certs} exigem certificado` : ''}.`, 'ok')
      // Regra mudou → reaplica a vigente em tudo que já foi gravado.
      void revalidarBaseGravada()
        .then((r) => {
          if (r.produtos || r.notas) toast(`🔄 Base gravada atualizada: ${resumirRevalidacao(r)}.`, 'ok')
        })
        .catch(() => undefined)
    } else if (certs > 0 && erros === 0) {
      toast(`🔐 Sincronização CFF: ${certs} endpoint(s) exigem certificado digital (tabelas por DFe). Importe o JSON manualmente.`, 'warn')
    } else if (inalterados > 0 && erros === 0) {
      toast(`ℹ️ Sincronização CFF: todos os ${inalterados} endpoint(s) já estão atualizados.`, '')
    } else if (erros > 0) {
      toast(`⚠️ Sincronização CFF finalizada com ${erros} erro(s). Verifique a aba CFF Sync nas configurações.`, 'warn')
    }
  }).catch((e) => {
    toast(`❌ Falha na sincronização CFF: ${e instanceof Error ? e.message : String(e)}`, 'err')
  })

  return promessa
}

/**
 * Força uma sincronização manual (ex.: botão na UI)
 * Mostra toasts detalhados de progresso e resultado.
 */
export async function sincronizacaoManual(
  onProgress: CffProgresso = () => {},
): Promise<SyncResultado[]> {
  toast('🔄 Iniciando sincronização manual com a Conformidade Fácil...', '')
  
  const resultados = await forcarSincronizacao((etapa, pct, resultado) => {
    onProgress(etapa, pct, resultado)

    // Toast para cada endpoint finalizado
    if (resultado) {
      const { titulo, nivel } = resumoEndpoint(resultado)
      toast(titulo, nivel === 'info' ? '' : nivel)
    }
  })

  // Toast de resumo final
  const atualizados = resultados.filter((r) => r.status === 'atualizado').length
  const inalterados = resultados.filter((r) => r.status === 'inalterado').length
  const erros = resultados.filter((r) => r.status === 'erro').length
  const certs = resultados.filter((r) => r.status === 'certificado').length

  if (atualizados > 0) {
    toast(`✅ Sincronização manual concluída: ${atualizados} endpoint(s) atualizado(s)${inalterados ? `, ${inalterados} sem alterações` : ''}${erros ? `, ${erros} erro(s)` : ''}${certs ? `, ${certs} exigem certificado` : ''}.`, 'ok')
    // Regra mudou → reaplica a vigente em tudo que já foi gravado.
    try {
      const r = await revalidarBaseGravada()
      if (r.produtos || r.notas) toast(`🔄 Base gravada atualizada: ${resumirRevalidacao(r)}.`, 'ok')
    } catch {
      /* revalidação complementar */
    }
  } else if (certs > 0 && erros === 0) {
    toast(`🔐 Sincronização manual: ${certs} endpoint(s) exigem certificado digital (tabelas por DFe). Importe o JSON manualmente abaixo.`, 'warn')
  } else if (inalterados > 0 && erros === 0) {
    toast(`ℹ️ Sincronização manual: todos os ${inalterados} endpoint(s) já estão atualizados.`, '')
  } else if (erros > 0) {
    toast(`⚠️ Sincronização manual finalizada com ${erros} erro(s). Verifique a aba CFF Sync nas configurações.`, 'warn')
  }

  return resultados
}

/**
 * Importação manual do JSON da tabela por DFe (baixado no portal CFF com
 * certificado digital). Valida o sistema e grava via o mesmo normalizador
 * do sync automático.
 */
export async function importarTabelaProduto(sistema: string, json: unknown) {
  const sist = String(sistema ?? '').trim()
  if (!(SISTEMAS_CFF as readonly string[]).includes(sist)) {
    throw new Error(`Sistema inválido: "${sist}". Use ${SISTEMAS_CFF.join(', ')}.`)
  }
  const r = await importarClassificacaoProduto(sist, json)
  toast(
    `✅ Tabela ${r.sistema} importada: ${r.total} cClassTrib(s)${r.negados ? `, ${r.negados} negado(s)` : ''}.`,
    'ok',
  )
  // Regra mudou (permitido × negado por DFe) → reaplica a vigente no gravado.
  try {
    const rev = await revalidarBaseGravada()
    if (rev.produtos || rev.notas) toast(`🔄 Base gravada atualizada: ${resumirRevalidacao(rev)}.`, 'ok')
  } catch {
    /* revalidação complementar */
  }
  return r
}

/**
 * Obtém o status atual de todas as sincronizações
 */
export async function statusSincronizacao() {
  return obterStatusSincronizacao()
}

/** Cobertura local das tabelas por sistema (para a UI). */
export async function coberturaTabelasProduto() {
  return listarCoberturaClassProd()
}

/** Bloqueios por sistema para os cClassTribs informados (para os cartões). */
export async function bloqueiosParaCcts(ccts: string[]) {
  return obterBloqueiosParaCcts(ccts)
}