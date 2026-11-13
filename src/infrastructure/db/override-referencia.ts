/**
 * Alíquotas de referência — override definido pelo usuário
 * (Configurações → Alíquotas), persistido na tabela `meta` do SQLite.
 *
 * Contrato:
 * - Sem linha `meta` para a chave `parametros_referencia` → vige a tabela
 *   embutida (`public/base/parametros.json`) ou o espelho `PARAMETROS_REF`.
 * - Com a linha → o app passa a usar esses valores em todo cálculo
 *   (Consulta, simulador dos cartões, XML/apuracao, relatórios, override
 *   entra também no `backup` por ser `meta` integral).
 * - `ato` guarda a proveniência explícita ("Definido pelo usuário local").
 *
 * Nada aqui escreve fora da `meta`; reverter = apagar a linha.
 */
import { db } from '@/infrastructure/db/schema'
import {
  PARAMETROS_REF,
  validarParametrosRef,
  type ParametrosReferencia,
} from '@/domain/constants/parametros'

const CHAVE = 'parametros_referencia'

/** Volta o override do usuário (ou `null` quando só vige a tabela embutida). */
export async function lerAliquotasUsuario(): Promise<ParametrosReferencia | null> {
  try {
    const reg = (await db.table('meta').get(CHAVE)) as { valor?: unknown } | null
    if (!reg) return null
    return validarParametrosRef(reg.valor)
  } catch {
    return null
  }
}

export interface AliquotasDigitadas {
  refIBS: number
  refCBS: number
}

/** Valida e grava o override. Lança erro com mensagem amigável quando inválido. */
export async function salvarAliquotasUsuario({ refIBS, refCBS }: AliquotasDigitadas): Promise<ParametrosReferencia> {
  const ibs = Number(refIBS)
  const cbs = Number(refCBS)
  if (!Number.isFinite(ibs) || !Number.isFinite(cbs)) {
    throw new Error('Informe números válidos para IBS e CBS (use ponto ou vírgula).')
  }
  if (ibs < 0 || ibs > 100 || cbs < 0 || cbs > 100) {
    throw new Error('Alíquotas devem ficar entre 0% e 100%.')
  }
  const soma = Number((ibs + cbs).toFixed(10))
  if (soma <= 0) {
    throw new Error('A soma IBS + CBS deve ser maior que 0%.')
  }
  const valor: ParametrosReferencia = {
    ...PARAMETROS_REF,
    refIBS: ibs,
    refCBS: cbs,
    soma,
    ato: 'Definido pelo usuário (Configurações → Alíquotas)',
    vigenciaInicio: PARAMETROS_REF.vigenciaInicio,
    vigenciaFim: null,
    fonteUrl: PARAMETROS_REF.fonteUrl,
    shaFonte: null,
  }
  const validado = validarParametrosRef(valor)
  if (!validado) {
    // defesa em profundidade: validarParametrosRef rejeita soma divergente
    throw new Error('Combinação de alíquotas inválida — confira os valores.')
  }
  await db.table('meta').put({ chave: CHAVE, valor: validado, atualizadoEm: new Date().toISOString() })
  return validado
}

/** Apaga o override; o app volta ao `parametros.json` embutido (ou espelho). */
export async function restaurarAliquotasUsuario(): Promise<void> {
  try {
    await db.table('meta').delete(CHAVE)
  } catch {
    /* já não havia override — segue o jogo */
  }
}
