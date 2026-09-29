import type { SpedTipo } from './tipos'

/**
 * Decodificação em cascata (SPEC R4.1): UTF-8 fatal → windows-1252 → latin1.
 * Retorna **string** (nunca ArrayBuffer).
 */
export function lerArquivoTexto(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)

  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!utf8.includes('\uFFFD')) return utf8
  } catch {
    /* tenta o próximo codec */
  }

  try {
    return new TextDecoder('windows-1252').decode(bytes)
  } catch {
    /* navegador sem suporte → latin1 byte a byte */
  }

  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * Conversor numérico do SPED (SPEC §4.2).
 * `""`/`null` → 0 · vírgula decimal brasileira suportada · não numérico → 0.
 */
export function spedToNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v).trim()
  if (!s) return 0
  if (s.includes(',')) {
    const n = Number(s.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Janela de detecção (SPEC §4.3): examina até `LIMITE_DETECCAO` linhas para
 * suportar arquivos grandes cujo bloco 0200 empurra os C100 para depois da
 * linha 500. Acima disso, amostra o restante em passos para não carregar um
 * SPED de centenas de milhares de linhas inteiro na memória de detecção.
 */
const LIMITE_DETECCAO = 20000

function linhasParaDeteccao(conteudo: string): { regs: Set<string>; reg0000: string[] | null; c170: string[][] } {
  const regs = new Set<string>()
  let reg0000: string[] | null = null
  const c170: string[][] = []
  const texto = String(conteudo)
  let inicio = 0
  let idx = 0
  let amostradas = 0
  // Passo adaptativo: varredura total até o limite, depois 1 a cada 50 linhas.
  const passo = (n: number): number => (n < LIMITE_DETECCAO ? 1 : 50)

  while (true) {
    const fim = texto.indexOf('\n', inicio)
    const fimEfetivo = fim === -1 ? texto.length : fim
    const p = passo(idx)
    if (p === 1 || amostradas % 50 === 0) {
      let l = texto.slice(inicio, fimEfetivo)
      if (l.endsWith('\r')) l = l.slice(0, -1)
      if (l.length >= 3) {
        const c = l.split('|')
        if (c.length >= 2 && c[1]) {
          regs.add(c[1])
          if (c[1] === '0000' && !reg0000) reg0000 = c
          if (c[1] === 'C170' && c.length >= 37 && c170.length < 5) c170.push(c)
          // Saída antecipada: tipo inequívoco já decidido pelos blocos.
          if (
            regs.has('R1000') || regs.has('R2000') || regs.has('R9000') ||
            regs.has('S1000') || regs.has('S1200') || regs.has('S3000') ||
            regs.has('I200') || regs.has('I250') ||
            regs.has('A100') || regs.has('A170') || regs.has('M100') ||
            regs.has('M200') || regs.has('F100') || regs.has('F170') ||
            regs.has('M606') || regs.has('P200')
          ) {
            break
          }
        }
      }
    }
    amostradas++
    if (fim === -1) break
    inicio = fim + 1
    idx++
    // Trava de segurança para arquivos gigantescos.
    if (idx > 500000) break
  }
  return { regs, reg0000, c170 }
}

/**
 * Detecção de tipo (SPEC §4.3) — mesma ordem de checagens, com a correção do
 * `[BUG] L1296`: um EFD Contribuições truncado (só C100/C170, sem A/M/F) não é
 * mais classificado como ICMS/IPI, graças ao parecer estrutural dos campos
 * PIS/COFINS do registro C170.
 */
export function detectarTipo(conteudo: string): SpedTipo {
  const { regs, reg0000, c170 } = linhasParaDeteccao(conteudo)

  const codVer = String(reg0000?.[2] ?? '').trim()

  const tem = (...alvos: string[]) => alvos.some((a) => regs.has(a))

  if (tem('R1000', 'R2000', 'R9000')) {
    return {
      tipo: 'reinf',
      nome: 'EFD Reinf',
      compativel: false,
      motivo:
        'O EFD Reinf usa uma estrutura completamente diferente (eventos R-1000, R-2000, R-9000) e não contém notas fiscais no formato pipe-delimited.',
    }
  }
  if (tem('S1000', 'S1200', 'S3000')) {
    return {
      tipo: 'esocial',
      nome: 'e-Social',
      compativel: false,
      motivo:
        'O e-Social é um sistema de eventos XML, não um arquivo pipe-delimited. Não há registros C100/C170 para processar.',
    }
  }
  if (tem('I200', 'I250')) {
    return {
      tipo: 'ecd',
      nome: 'ECD (Escrituração Contábil Digital)',
      compativel: false,
      motivo: 'O ECD contém livros contábeis (blocos I, J) e não notas fiscais.',
    }
  }
  if (regs.has('J100') && (regs.has('P100') || regs.has('P200'))) {
    return {
      tipo: 'ecf',
      nome: 'ECF (Escrituração Contábil Fiscal)',
      compativel: false,
      motivo: 'O ECF contém apuração do IRPJ/CSLL, não notas fiscais.',
    }
  }
  if (tem('A100', 'A170', 'M100', 'M200', 'F100', 'F170', 'M606', 'P200')) {
    return { tipo: 'contribuicoes', nome: 'EFD Contribuições (PIS/COFINS)', compativel: true, codVer }
  }
  if (tem('C100', 'C170', 'C190', 'D100', 'D190')) {
    // Correção do BUG L1296: examina um C170 antes de concluir ICMS/IPI.
    if (ehContribuicoesPorC170Amostrado(c170)) {
      return { tipo: 'contribuicoes', nome: 'EFD Contribuições (PIS/COFINS)', compativel: true, codVer }
    }
    return { tipo: 'icmsipi', nome: 'EFD ICMS/IPI (SPED Fiscal)', compativel: true, codVer }
  }

  return {
    tipo: 'desconhecido',
    nome: 'Tipo de arquivo desconhecido',
    compativel: false,
    motivo:
      'Não foi possível identificar o layout. Certifique-se de que é um arquivo SPED Fiscal (ICMS/IPI) ou EFD Contribuições válido.',
  }
}

/**
 * Parecer estrutural: no EFD Contribuições o C170 carrega CST_PIS na posição 25
 * (2 dígitos) e VL_BC_PIS na 26 (numérica). No ICMS/IPI essa posição é outro
 * campo. Um único C170 basta para decidir.
 */
function ehContribuicoesPorC170Amostrado(amostras: string[][]): boolean {
  for (const c of amostras) {
    if (c.length < 37) continue
    const cstPis = String(c[25] ?? '').trim()
    const vlBcPis = String(c[26] ?? '').trim()
    if (/^\d{2}$/.test(cstPis) && /^-?\d+([.,]\d+)?$/.test(vlBcPis)) return true
  }
  return false
}
