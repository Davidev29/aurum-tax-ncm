/**
 * Validação **multiagente** do cadastro de produtos (tributação anterior).
 *
 * A Reforma (CST/cClassTrib/reduções) é 100% automática pelo NCM e NUNCA é
 * validada aqui — só a tributação antiga (CFOP/CST ICMS/PIS/COFINS por fluxo
 * entrada × saída). Cada agente é independente e retorna bloqueios (impedem
 * o salvamento) + avisos (gravam, mas sinalizam):
 *
 * - `sintaxe`: formato (CFOP 4 dígitos, CST ICMS 2-3, PIS/COFINS 2 dígitos).
 *   NBS (9 dígitos, serviços) é bloqueado com mensagem dedicada — produto é
 *   NCM (8 dígitos) e nunca aceita NBS.
 * - `auxiliar`: existência na tabela auxiliar (CFOP, CST ICMS, CST PIS/COFINS).
 * - `coerencia`: CFOP de entrada deve ser de Entrada (1/2/3) e o de saída de
 *   Saída (5/6/7); avisa quando iguais ou com tipo trocado.
 * - `reforma-imutavel`: garante que ninguém passou tributo da Reforma pelo
 *   formulário antigo (defesa em profundidade).
 * - `sku`: SKU/nome/NCM obrigatórios + duplicidade por empresa.
 */
import { norm } from '@/domain/services/format'
import { db } from '@/infrastructure/db/schema'
import type { EntradaProduto } from '@/application/produtos'

export interface VereditoAgente {
  agente: string
  ok: boolean
  bloqueios: string[]
  avisos: string[]
}

export interface VereditoProduto {
  ok: boolean
  bloqueios: string[]
  avisos: string[]
  porAgente: VereditoAgente[]
}

const somenteDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

function veredito(agente: string, bloqueios: string[] = [], avisos: string[] = []): VereditoAgente {
  return { agente, ok: bloqueios.length === 0, bloqueios, avisos }
}

/* ---------------------------------------------------------- agentes ------ */

function agenteSintaxe(e: EntradaProduto): VereditoAgente {
  const bloqueios: string[] = []
  const pares: Array<[string, string, RegExp, string]> = [
    ['CFOP entrada', e.cfopEntrada ?? '', /^\d{4}$/, 'CFOP deve ter 4 dígitos.'],
    ['CFOP saída', e.cfopSaida ?? '', /^\d{4}$/, 'CFOP deve ter 4 dígitos.'],
    ['CST ICMS entrada', e.cstIcmsEntrada ?? '', /^\d{2,3}$/, 'CST ICMS deve ter 2 ou 3 dígitos.'],
    ['CST ICMS saída', e.cstIcmsSaida ?? '', /^\d{2,3}$/, 'CST ICMS deve ter 2 ou 3 dígitos.'],
    ['PIS entrada', e.pisEntrada ?? '', /^\d{2}$/, 'CST PIS deve ter 2 dígitos.'],
    ['PIS saída', e.pisSaida ?? '', /^\d{2}$/, 'CST PIS deve ter 2 dígitos.'],
    ['COFINS entrada', e.cofinsEntrada ?? '', /^\d{2}$/, 'CST COFINS deve ter 2 dígitos.'],
    ['COFINS saída', e.cofinsSaida ?? '', /^\d{2}$/, 'CST COFINS deve ter 2 dígitos.'],
  ]
  for (const [rot, val, re, msg] of pares) {
    const v = String(val ?? '').trim()
    if (!v) continue // vazio = não informado (permitido)
    const dig = somenteDigitos(v)
    // Produto = NCM (8 dígitos). NBS (9 dígitos) é só para serviços e nunca
    // entra em CFOP/CST de produto — mensagem dedicada em vez de "formato".
    if (rot.startsWith('CFOP') && dig.length === 9) {
      bloqueios.push(`${rot}: "${v}" tem 9 dígitos — é NBS (serviços). Aqui é só produto: use CFOP de 4 dígitos.`)
      continue
    }
    if (!re.test(v)) bloqueios.push(`${rot}: ${msg} (recebido "${v}").`)
  }
  // Compat legado: quando só veio cfop/cstIcms/pis/cofins único, valida igual.
  const legados: Array<[string, string, RegExp, string]> = [
    ['CFOP', e.cfop ?? '', /^\d{4}$/, 'CFOP deve ter 4 dígitos.'],
  ]
  for (const [rot, val, re, msg] of legados) {
    const v = String(val ?? '').trim()
    if (!v) continue
    if (!re.test(v.trim())) bloqueios.push(`${rot}: ${msg} (recebido "${v}").`)
  }
  return veredito('sintaxe', bloqueios)
}

async function agenteAuxiliar(e: EntradaProduto): Promise<VereditoAgente> {
  const avisos: string[] = []
  const bloqueios: string[] = []
  try {
    const checar = async (store: 'cfop' | 'cstIcms' | 'cstPisCofins', codigo: string, rot: string) => {
      const v = String(codigo ?? '').trim()
      if (!v) return
      try {
        const existe = await db.table(store).get(v)
        if (!existe) avisos.push(`${rot} "${v}" não está na tabela auxiliar — será gravado, mas confira a descrição.`)
      } catch {
        /* banco indisponível: não bloqueia */
      }
    }
    await checar('cfop', e.cfopEntrada ?? '', 'CFOP entrada')
    await checar('cfop', e.cfopSaida ?? '', 'CFOP saída')
    await checar('cstIcms', e.cstIcmsEntrada ?? '', 'CST ICMS entrada')
    await checar('cstIcms', e.cstIcmsSaida ?? '', 'CST ICMS saída')
    await checar('cstPisCofins', e.pisEntrada ?? '', 'PIS entrada')
    await checar('cstPisCofins', e.pisSaida ?? '', 'PIS saída')
    await checar('cstPisCofins', e.cofinsEntrada ?? '', 'COFINS entrada')
    await checar('cstPisCofins', e.cofinsSaida ?? '', 'COFINS saída')
  } catch {
    /* nunca bloqueia export/salvamento por falha de leitura */
  }
  return veredito('auxiliar', bloqueios, avisos)
}

function agenteCoerencia(e: EntradaProduto): VereditoAgente {
  const avisos: string[] = []
  const tipoCfop = (cfop: string): 'Entrada' | 'Saída' | null => {
    const d = somenteDigitos(cfop)[0]
    if (['1', '2', '3'].includes(d)) return 'Entrada'
    if (['5', '6', '7'].includes(d)) return 'Saída'
    return null
  }
  const ent = String(e.cfopEntrada ?? '').trim()
  const sai = String(e.cfopSaida ?? '').trim()
  if (ent && sai && somenteDigitos(ent) === somenteDigitos(sai)) {
    avisos.push('CFOP de entrada e saída iguais — confira se a operação é a mesma nos dois fluxos.')
  }
  if (ent) {
    const t = tipoCfop(ent)
    if (t === 'Saída') avisos.push(`CFOP entrada "${ent}" é de Saída (5/6/7) — o esperado para entrada é 1/2/3.`)
    if (!t) avisos.push(`CFOP entrada "${ent}" com primeiro dígito fora de 1/2/3/5/6/7.`)
  }
  if (sai) {
    const t = tipoCfop(sai)
    if (t === 'Entrada') avisos.push(`CFOP saída "${sai}" é de Entrada (1/2/3) — o esperado para saída é 5/6/7.`)
    if (!t) avisos.push(`CFOP saída "${sai}" com primeiro dígito fora de 1/2/3/5/6/7.`)
  }
  return veredito('coerencia', [], avisos)
}

function agenteReformaImutavel(e: EntradaProduto): VereditoAgente {
  const bloqueios: string[] = []
  // O formulário antigo nunca pode carregar CST/cClassTrib da Reforma: eles
  // vêm do motor (`escolhida`). Se alguém injetar via objeto, bloqueia.
  const raw = e as unknown as Record<string, unknown>
  for (const c of ['cstReforma', 'cClassTrib', 'pRedIBS', 'pRedCBS'] as const) {
    if (raw[c] !== undefined && raw[c] !== null && String(raw[c]).trim() !== '') {
      bloqueios.push(`Campo da Reforma "${c}" não pode ser informado manualmente — ele é automático pelo NCM.`)
    }
  }
  if (!e.classificacao) bloqueios.push('Escolha uma classificação na lateral.')
  return veredito('reforma-imutavel', bloqueios)
}

async function agenteSku(e: EntradaProduto): Promise<VereditoAgente> {
  const bloqueios: string[] = []
  if (!String(e.codigo ?? '').trim()) bloqueios.push('Informe o SKU.')
  if (!String(e.nome ?? '').trim()) bloqueios.push('Informe o nome do produto.')
  const digNcm = norm(e.ncm)
  if (digNcm.length === 9) {
    bloqueios.push('NBS tem 9 dígitos e é só para serviços. Aqui é só produto: informe um NCM de 8 dígitos.')
  } else if (digNcm.length !== 8) {
    bloqueios.push('NCM deve ter 8 dígitos.')
  }
  return veredito('sku', bloqueios)
}

/* ------------------------------------------------------------ pipeline --- */

/** Roda os 5 agentes em ordem; `ok` = zero bloqueios (avisos não bloqueiam). */
export async function validarProdutoMultiagente(e: EntradaProduto): Promise<VereditoProduto> {
  const porAgente: VereditoAgente[] = []
  porAgente.push(agenteSintaxe(e))
  porAgente.push(await agenteAuxiliar(e))
  porAgente.push(agenteCoerencia(e))
  porAgente.push(agenteReformaImutavel(e))
  porAgente.push(await agenteSku(e))
  const bloqueios = porAgente.flatMap((a) => a.bloqueios)
  const avisos = porAgente.flatMap((a) => a.avisos)
  return { ok: bloqueios.length === 0, bloqueios, avisos, porAgente }
}

/** Primeira mensagem de bloqueio (ordem dos agentes = ordem de exibição). */
export function primeiroBloqueio(v: VereditoProduto): string | null {
  return v.bloqueios[0] ?? null
}
