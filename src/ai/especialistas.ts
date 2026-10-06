/**
 * Especialistas por domínio (§2 do PLANO_CORRECAO_100.md).
 *
 * Princípio: 1 dispatcher fino (valida → roteia → combina) + 6 especialistas
 * isolados (prompt + tools + schema próprios, sem cross-talk).
 * Grafo PROPÕE (naoFiscal), resolvedor/motor DECIDE, especialista FORMATA.
 *
 * Este módulo é o CONTRATO (specs + roteador puro + templates). A execução
 * continua no `executarFerramenta` (motor) e no orquestrador (chat); a migração
 * do chat para cá é P2 sem quebrar o caminho atual.
 */
import { detectarInjection } from '@/domain/services/escopo-consulta'
import { ehCnpjValido } from '@/domain/services/cnpj'

export type DominioEsp = 'ncm' | 'nbs' | 'cnpj' | 'simples' | 'doc' | 'calc'

export interface EspSpec {
  dominio: DominioEsp
  /** Tools que o especialista PODE chamar (allow-list). */
  permite: string[]
  /** Tools que o especialista NUNCA chama (deny-list explícita). */
  nega: string[]
  /** Inputs obrigatórios — sem eles, PERGUNTA (nunca inventa). */
  exige: string[]
  /** Template de saída (única forma verbal permitida com número/código). */
  template: string
  /** Fallback honesto quando sem lastro. */
  fallback: string
}

export const ESPECIALISTAS: Record<DominioEsp, EspSpec> = {
  ncm: {
    dominio: 'ncm',
    permite: ['grafoConsultar', 'consultarNCM', 'detalharCodigo', 'calcularIBSCBS'],
    nega: ['consultarNBS', 'classificarComIaServicos', 'buscarCnpj', 'calcularSimples', 'simularComparativo'],
    exige: ['termo-ou-ncm-8d'],
    template: '**NCM {codigo}** · CST {cst} · cClassTrib {cct} · **Redução vigente:** IBS {redIBS}% / CBS {redCBS}% ({anexo}) · Base legal: {baseLegal}{observacoes}',
    fallback: 'Sem lastro na base oficial para esse produto — me dê material + uso (ex.: "camiseta 100% algodão para revenda") que eu refino, sem chutar NCM.',
  },
  nbs: {
    dominio: 'nbs',
    permite: ['grafoConsultar', 'consultarNBS', 'consultarCnaeNbs'],
    nega: ['consultarNCM', 'classificarComIa', 'calcularIBSCBS', 'buscarCnpj'],
    exige: ['termo-ou-nbs-9d'],
    template: '**NBS {codigo}** · CST {cst} · cClassTrib {cct} · **Redução vigente:** IBS {redIBS}% / CBS {redCBS}% ({anexo}) · Base legal: {baseLegal}{observacoes}',
    fallback: 'Sem NBS correspondente na base (ponte CNAE→NBS não-oficial) — não escriturável ainda. Me diga o CNAE que eu dou o Anexo do Simples.',
  },
  cnpj: {
    dominio: 'cnpj',
    permite: ['consultarCNPJ', 'verificarCadastroCnpj'],
    nega: ['calcularSimples', 'simularComparativo', 'calcularIBSCBS', 'consultarNCM', 'consultarNBS'],
    exige: ['cnpj-14d-dv-valido'],
    template: '{valor}',
    fallback: 'Qual CNPJ (14 dígitos)? E qual dado: endereço, atividade ou simples?',
  },
  simples: {
    dominio: 'simples',
    permite: ['calcularSimples', 'simularComparativo', 'simularCenarioDividido'],
    nega: ['buscarCnpj', 'consultarNCM', 'calcularIBSCBS'],
    exige: ['anexo', 'rbt12', 'receitaMes'],
    template: 'No {scenarioId} com RBT12 {rbt12}, para {alvo} fature {receita} (piso {piso} / teto {teto}), alíquota {aliq}% ({faixa}). Valide com seu contador.',
    fallback: 'Para calcular seu DAS no Simples, preciso do anexo (I–V), do RBT12 e da receita do mês. Me diga os que faltam — ex.: "Anexo III, RBT12 500 mil, receita 40 mil".',
  },
  doc: {
    dominio: 'doc',
    permite: ['consultarDadosXml', 'consultarClientes', 'gerarRelatorioDados', 'gerarGrafico'],
    nega: ['calcularSimples', 'consultarNCM', 'consultarNBS'],
    exige: ['pergunta-sobre-movimento'],
    template: '{resposta-agregada-sobre-NotaXml} · Fonte: movimento importado ({notas} notas)',
    fallback: 'Sem movimento importado para essa pergunta — importe o XML em Notas Fiscais e me chame de novo.',
  },
  calc: {
    dominio: 'calc',
    permite: ['calcularIBSCBS', 'detalharCodigo'],
    nega: ['calcularSimples', 'simularComparativo', 'buscarCnpj'],
    exige: ['codigo-8d-ou-9d', 'valorBase'],
    template: '**{codigo}** · vIBS {vIBS} + vCBS {vCBS} = **{total}** sobre base {base} (carga {carga}%){motivoRegime}',
    fallback: 'Para calcular: diga valor + código (ex.: "quanto fica R$ 2.500 no NCM 0803.10.00?").',
  },
}

export type RotaEsp =
  | { destino: DominioEsp }
  | { destino: 'recusa'; motivo: 'injection' }
  | { destino: 'erro'; erro: 'cnpj-invalido' | 'cnae-invalido' | 'ncm-incompleto' | 'ncm-invalido' | 'nbs-incompleto' | 'nbs-invalido' }

const RE_CNPJ14 = /\d{14}/
const RE_CNAE7 = /\b\d{7}\b|\b\d{4}-\d\/\d{2}\b/

/**
 * Roteador puro: pergunta → especialista (ou recusa/erro tipado).
 * Ordem (código-first): 1. injection → recusa; 2. tamanhos fail-closed;
 * 3. intenção → especialista. NBS nunca cai no pipeline NCM.
 */
export function rotearParaEspecialista(
  pergunta: string,
  intencao: string,
  opts?: { temNbs?: boolean; temCnae?: boolean },
): RotaEsp {
  if (detectarInjection(pergunta)) return { destino: 'recusa', motivo: 'injection' }
  const digitos = String(pergunta ?? '').replace(/\D+/g, '')
  if (RE_CNPJ14.test(String(pergunta ?? ''))) {
    const m = String(pergunta).match(/\d{14}/)
    if (m && !ehCnpjValido(m[0])) return { destino: 'erro', erro: 'cnpj-invalido' }
  }
  switch (intencao) {
    case 'nbs':
      return { destino: 'nbs' }
    case 'ncm':
      // 9 dígitos no domínio NCM é NBS — redireciona em vez de truncar (S1-12)
      if (digitos.length === 9 && !opts?.temNbs) return { destino: 'nbs' }
      if (digitos.length > 0 && digitos.length < 8) return { destino: 'erro', erro: 'ncm-incompleto' }
      if (digitos.length > 9) return { destino: 'erro', erro: 'ncm-invalido' }
      return { destino: 'ncm' }
    case 'cnae':
      if (opts?.temCnae === false) return { destino: 'erro', erro: 'cnae-invalido' }
      return { destino: 'nbs' }
    case 'cnpj':
      return { destino: 'cnpj' }
    case 'simples':
    case 'comparativo':
    case 'projecao':
      return { destino: 'simples' }
    case 'clientes':
    case 'dados':
      return { destino: 'doc' }
    case 'calculo':
      return { destino: 'calc' }
    default:
      return { destino: 'ncm' }
  }
}

/** Ferramentas que um especialista pode chamar (allow-list enforcement). */
export function podeChamar(dominio: DominioEsp, ferramenta: string): boolean {
  const esp = ESPECIALISTAS[dominio]
  if (esp.nega.includes(ferramenta)) return false
  return esp.permite.includes(ferramenta)
}

export { RE_CNPJ14 as RE_CNPJ_QUALQUER, RE_CNAE7 as RE_CNAE_QUALQUER }
