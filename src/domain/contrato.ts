/**
 * Termo de Aceite da licença local — Aurum Tax NCM.
 *
 * O aceite é registrado 100% na máquina do cliente (localStorage),
 * sem envio à nuvem, conforme Cláusula Terceira/Quinta do Contrato.
 */

export const CONTRATO_VERSAO = '1.0 — Set/2026'
export const CONTRATO_NOME_ARQUIVO =
  'CONTRATO - Aurum Tax NCM (Licenca de Uso Desktop Local).docx'

/** Chave do aceite no localStorage (por instalação/navegador). */
export const ACEITE_KEY = 'aurum_tax_ncm_aceite_v1'

export interface Contratante {
  nome: string
  documento: string
  email: string
}

export interface RegistroAceite {
  versao: string
  dataHora: string
  agente: string
  contratante?: Contratante
  perfil?: string
}

export function lerAceite(): RegistroAceite | null {
  try {
    const bruto = localStorage.getItem(ACEITE_KEY)
    if (!bruto) return null
    const dado = JSON.parse(bruto) as RegistroAceite
    if (!dado || dado.versao !== CONTRATO_VERSAO) return null
    return dado
  } catch {
    return null
  }
}

export function gravarAceite(contratante?: Contratante, perfil?: string): RegistroAceite {
  const registro: RegistroAceite = {
    versao: CONTRATO_VERSAO,
    dataHora: new Date().toISOString(),
    agente: typeof navigator !== 'undefined' ? navigator.userAgent : 'desconhecido',
    ...(contratante ? { contratante } : {}),
    ...(perfil ? { perfil } : {}),
  }
  try {
    localStorage.setItem(ACEITE_KEY, JSON.stringify(registro))
  } catch {
    /* armazenamento indisponível — o gate volta a pedir */
  }
  return registro
}

/** Só dígitos de um CPF/CNPJ digitado. */
export function soDigitos(valor: string): string {
  return (valor ?? '').replace(/\D/g, '')
}

/** Valida nome, documento (CPF 11 / CNPJ 14) e e-mail do contratante. */
export function validarContratante(c: Contratante): string | null {
  if (c.nome.trim().length < 3) return 'Informe seu nome ou a razão social (mín. 3 letras).'
  const dig = soDigitos(c.documento)
  if (dig.length !== 11 && dig.length !== 14)
    return 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim()))
    return 'Informe um e-mail válido para contato e suporte.'
  return null
}

/** Texto resumido exibido no modal de primeira execução. */
export const TERMO_RESUMO: string[] = [
  'Licença de uso do Aurum Tax NCM, software desktop da Aurum Bit Labs & Studios LTDA, nos limites da versão adquirida.',
  'O software roda 100% na sua máquina. NÃO armazenamos seus dados em nuvem: empresas, produtos, SPED, XMLs e classificações ficam somente no seu computador (banco local + pasta de dados do usuário). A Aurum não recebe nem tem acesso à sua base.',
  'Internet é usada apenas para funções opcionais (consulta de CNPJ via BrasilAPI, leitura de normas oficiais Planalto/CGIBS, portal CFF e verificação de atualizações) — sua base nunca é enviada à Aurum.',
  'Você é responsável por seus dados, backups, conferência fiscal (LC 214/2025, Decreto 12.955/2026, Res. CGIBS 6/2026) e pela segurança da máquina.',
  'O software é ferramenta de apoio e não substitui o julgamento profissional nem garante resultado perante o Fisco.',
  'O aceite registra versão do Contrato, data/hora e identificação da instalação como prova da contratação.',
]
