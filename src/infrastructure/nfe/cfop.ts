/**
 * CFOP × crédito/débito de IBS/CBS + naturezas da operação.
 *
 * Fonte da tabela: `bases-fonte/cfop.json` (619 CFOPs oficiais, salvos no
 * sistema para comparação). Este módulo é a **curadoria fiscal** sobre ela:
 * diz, por CFOP (e pela natureza da operação da capa), o que **gera** ou
 * **não gera** direito a crédito/débito na apuração assistida.
 *
 * Regras aplicadas (critério da empresa, LC 214/2025):
 * - **venda** (ex.: 5101/5102/6101/6102…) → gera débito na saída e, na
 *   entrada correspondente (compra p/ industrialização/comercialização —
 *   1101/1102/2101/2102…), gera crédito;
 * - **diferente de venda** (bonificação, doação, brinde, amostra,
 *   demonstração, conserto, comodato, transferência, remessa, devolução,
 *   `5949/1949` e congêneres) → **não gera** crédito nem débito;
 * - **compra para ativo imobilizado** (`1551/2551/3551`) ou material de
 *   **uso e consumo** (`1556/2556/3556`) → **não gera** crédito;
 * - **exportação** (CFOP `7xxx`, natureza com "exportação") → aponta a
 *   **imunidade / não incidência** prevista na LC para conferência.
 *
 * CFOP manda; a `natOp` da capa só desempatata (fallback) — ela é texto
 * livre do emitente. Nada aqui é apuração fiscal definitiva: o bloco de
 * natureza da operação é **informativo e assistido** — o cliente decide.
 */

export type EfeitoCfop = 'venda' | 'compra-gera' | 'imobilizado' | 'sem-efeito'

export type DirecaoEfeito = 'entrada' | 'saida' | 'quarentena'

export interface ClassificacaoCfop {
  /** CFOP normalizado (4 dígitos). */
  cfop: string
  efeito: EfeitoCfop
  geraCredito: boolean
  geraDebito: boolean
  /** Explicação curta para a UI ("por que este CFOP cai aqui"). */
  motivo: string
  /** Texto da imunidade/não incidência da LC quando houver sinal. */
  imunidadeLC: string | null
}

/** Só dígitos, 4 posições (`5.102` → `5102`). */
export function normalizarCfop(cfop: string | null | undefined): string {
  return String(cfop ?? '').replace(/\D/g, '').slice(0, 4)
}

/** Entradas de bem para o ativo imobilizado (não geram crédito). */
export const CFOP_IMOBILIZADO_ENTRADA = new Set(['1551', '2551', '3551'])

/** Entradas de material para uso ou consumo (sem crédito nesta apuração). */
export const CFOP_USO_CONSUMO_ENTRADA = new Set(['1556', '2556', '3556'])

/**
 * CFOPs sem fato gerador de IBS/CBS para crédito/débito — remessas sem
 * transferência de titularidade, bonificações, demonstrações, consertos,
 * transferências, devoluções e "outros/não especificados".
 * Curadoria inicial a partir de `bases-fonte/cfop.json`; amplie conforme a
 * operação do cliente.
 */
export const CFOP_SEM_EFEITO = new Set([
  // Entradas — bonificação/doação/brinde, amostras, demonstração, conserto.
  '1910', '1911', '1912', '1913', '1915', '1916', '1917', '1918', '1919',
  '1920', '1921', '1922', '1923', '1924', '1925', '1926', '1931', '1932',
  '1933', '1934', '1949',
  '2910', '2911', '2912', '2913', '2915', '2916', '2917', '2918', '2919',
  '2920', '2921', '2922', '2923', '2924', '2925', '2926', '2931', '2932',
  '2933', '2934', '2949',
  // Entradas — transferências e devoluções.
  '1152', '1153', '1154', '2152', '2153', '2154',
  '1201', '1202', '1203', '1204', '1208', '1209', '1210', '1410', '1411',
  '2201', '2202', '2203', '2204', '2208', '2209', '2210', '2410', '2411',
  // Entradas — remessas para armazenagem/industrialização sem venda.
  '1901', '1902', '1903', '1904', '1905', '1906', '1907', '1908', '1909',
  '1914', '2901', '2902', '2903', '2904', '2905', '2906',
  // Saídas — transferências e devoluções de compra.
  '5151', '5152', '5153', '5154', '5155', '5156', '5159', '5160',
  '6151', '6152', '6153', '6154', '6155', '6156', '6159', '6160',
  '5201', '5202', '5207', '5208', '5209', '5210', '5410', '5411', '5412', '5413',
  '6201', '6202', '6207', '6208', '6209', '6210', '6410', '6411', '6412', '6413',
  '7201', '7202', '7207', '7210', '7410', '7411',
  // Saídas — remessas (bonificação, demonstração, conserto, armazenagem…).
  '5901', '5902', '5903', '5904', '5905', '5906', '5907', '5908', '5909',
  '5910', '5911', '5912', '5913', '5914', '5915', '5916', '5917', '5918',
  '5919', '5920', '5921', '5922', '5923', '5924', '5925', '5926', '5927',
  '5931', '5932', '5933', '5934', '5949',
  '6901', '6902', '6903', '6904', '6905', '6906', '6907', '6908', '6909',
  '6910', '6911', '6912', '6913', '6914', '6915', '6916', '6917', '6918',
  '6919', '6920', '6921', '6922', '6923', '6924', '6925', '6949',
  '7901', '7949',
  // Saídas — devolução de compra de uso/consumo e de bem do ativo.
  '5556', '6556', '7556',
])

/** Compras que geram crédito (industrialização / comercialização). */
export const CFOP_COMPRA_GERA_CREDITO = new Set([
  '1101', '1102', '1111', '1113', '1116', '1117', '1118', '1120', '1121',
  '1122', '1124', '1128', '1130',
  '2101', '2102', '2111', '2113', '2116', '2117', '2118', '2120', '2121',
  '2122', '2124',
  '3101', '3102',
])

/** Vendas típicas (geram débito na saída). */
export const CFOP_VENDA = new Set([
  '5101', '5102', '5103', '5104', '5105', '5106', '5107', '5108', '5109',
  '5110', '5111', '5112', '5113', '5114', '5115', '5116', '5117', '5118',
  '5119', '5120', '5401', '5402', '5403', '5405',
  '6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108', '6109',
  '6110', '6111', '6112', '6401', '6402', '6403', '6404', '6405',
  '7101', '7102', '7105', '7106', '7127', '7128',
])

const semAcento = (s: string | null | undefined): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()

const RE_NAO_VENDA =
  /BONIF|DOAC|BRINDE|AMOSTRA|DEMONSTR|MOSTRU|MOSTRA|CONSERT|REPARO|COMODATO|TRANSFER|REMESSA|DEVOLU|RETORNO|GARANTIA|EXPOSI|ARMAZ|DEPOSITO|CONSIGNA|FEIRA|TROCA/

/**
 * Papel na substituição tributária (`SUBSTITUÍDO/SUBSTITUTO`) — **não** é
 * troca de mercadoria. Só conta como não-venda quando não há `VENDA`
 * explícita (ex.: "REMESSA PARA SUBSTITUIÇÃO"); com `VENDA` ("VENDA ...
 * POR CONTR SUBSTITUIDO") é venda — ST é outro assunto.
 */
const RE_SUBSTITUI = /SUBSTITUI/

const RE_IMOBILIZADO = /IMOBILIZADO|ATIVO IMOB|BEM DO ATIVO|USO OU CONSUMO|USO E CONSUMO|MATERIAL DE USO/

const RE_VENDA = /VENDA|VENDA DE MERC|VENDA DE PROD/

const RE_EXPORT = /EXPORT/

/** Classifica a natureza da operação da capa (texto livre do emitente). */
export function classificarNatOp(
  natOp: string | null | undefined,
): 'venda' | 'nao-venda' | 'imobilizado' | 'indefinida' {
  const n = semAcento(natOp)
  if (!n) return 'indefinida'
  if (RE_EXPORT.test(n)) return 'nao-venda'
  if (RE_IMOBILIZADO.test(n)) return 'imobilizado'
  if (RE_NAO_VENDA.test(n)) return 'nao-venda'
  // "CONTRIBUINTE SUBSTITUÍDO/SUBSTITUTO" é papel na ST: não anula VENDA
  // explícita ("VENDA ... POR CONTR SUBSTITUIDO" é venda). Sem VENDA,
  // substituição de mercadoria segue não-venda.
  if (RE_SUBSTITUI.test(n) && !RE_VENDA.test(n)) return 'nao-venda'
  if (RE_VENDA.test(n)) return 'venda'
  return 'indefinida'
}

/**
 * Sinal de imunidade / não incidência da LC 214/2025 para conferência.
 * Devolve o texto instrutivo ou `null` quando não há sinal.
 */
export function sinalImunidadeLC(
  cfop4: string,
  natOp: string | null | undefined,
): string | null {
  const n = semAcento(natOp)
  if (cfop4.startsWith('7') || RE_EXPORT.test(n)) {
    return 'Exportação — imunidade / não incidência prevista na LC 214/2025: não gera débito nem crédito. Confira o enquadramento antes de aproveitar.'
  }
  return null
}

const MOTIVOS: Record<EfeitoCfop, string> = {
  venda: 'CFOP de venda — gera débito na saída e crédito na compra correspondente.',
  'compra-gera': 'Compra para industrialização/comercialização — gera direito a crédito.',
  imobilizado: 'Compra para ativo imobilizado / uso e consumo — sem direito a crédito nesta apuração.',
  'sem-efeito': 'Operação diferente de venda (remessa, bonificação, devolução, transferência…) — sem crédito nem débito.',
}

/**
 * Classifica um item/nota pelo CFOP (manda) com fallback na natureza da
 * operação e, por último, na direção da nota.
 */
export function classificarCfop(
  cfopBruto: string | null | undefined,
  natOp?: string | null,
  direcao?: DirecaoEfeito | string | null,
): ClassificacaoCfop {
  const cfop = normalizarCfop(cfopBruto)
  const nat = classificarNatOp(natOp)
  const dir = direcao === 'entrada' || direcao === 'saida' ? direcao : null

  // 1. Imobilizado / uso e consumo (só nas entradas; saída x551 é venda do bem).
  if (CFOP_IMOBILIZADO_ENTRADA.has(cfop) && dir !== 'saida') {
    return {
      cfop, efeito: 'imobilizado', geraCredito: false, geraDebito: false,
      motivo: MOTIVOS.imobilizado, imunidadeLC: null,
    }
  }
  if (CFOP_USO_CONSUMO_ENTRADA.has(cfop) && dir !== 'saida') {
    return {
      cfop, efeito: 'imobilizado', geraCredito: false, geraDebito: false,
      motivo: 'Material para uso ou consumo — sem direito a crédito nesta apuração.',
      imunidadeLC: null,
    }
  }
  // 2. Sem efeito explícito (manda sobre a direção).
  if (cfop && CFOP_SEM_EFEITO.has(cfop)) {
    return {
      cfop, efeito: 'sem-efeito', geraCredito: false, geraDebito: false,
      motivo: MOTIVOS['sem-efeito'], imunidadeLC: sinalImunidadeLC(cfop, natOp),
    }
  }
  // 3. Listas diretas.
  if (cfop && CFOP_COMPRA_GERA_CREDITO.has(cfop)) {
    return {
      cfop, efeito: 'compra-gera', geraCredito: true, geraDebito: false,
      motivo: MOTIVOS['compra-gera'], imunidadeLC: null,
    }
  }
  if (cfop && CFOP_VENDA.has(cfop)) {
    return {
      cfop, efeito: 'venda', geraCredito: dir === 'entrada', geraDebito: dir !== 'entrada',
      motivo: MOTIVOS.venda, imunidadeLC: sinalImunidadeLC(cfop, natOp),
    }
  }
  // 4. Natureza da operação (quando o CFOP não está nas listas).
  if (nat === 'imobilizado') {
    return {
      cfop, efeito: 'imobilizado', geraCredito: false, geraDebito: false,
      motivo: `Natureza "${String(natOp ?? '').trim()}" indica ativo imobilizado — sem crédito.`,
      imunidadeLC: null,
    }
  }
  if (nat === 'nao-venda') {
    return {
      cfop, efeito: 'sem-efeito', geraCredito: false, geraDebito: false,
      motivo: `Natureza "${String(natOp ?? '').trim()}" diferente de venda — sem crédito nem débito.`,
      imunidadeLC: sinalImunidadeLC(cfop, natOp),
    }
  }
  // 5. Fallback pela direção / primeiro dígito (nunca exclui sem prova).
  if (dir === 'entrada') {
    return {
      cfop, efeito: 'compra-gera', geraCredito: true, geraDebito: false,
      motivo: nat === 'venda'
        ? MOTIVOS['compra-gera']
        : 'Entrada sem CFOP restritivo — tratada como compra com crédito (confira a natureza).',
      imunidadeLC: null,
    }
  }
  if (dir === 'saida') {
    return {
      cfop, efeito: 'venda', geraCredito: false, geraDebito: true,
      motivo: nat === 'venda'
        ? MOTIVOS.venda
        : 'Saída sem CFOP restritivo — tratada como venda com débito (confira a natureza).',
      imunidadeLC: sinalImunidadeLC(cfop, natOp),
    }
  }
  if (/^[123]/.test(cfop)) {
    return { cfop, efeito: 'compra-gera', geraCredito: true, geraDebito: false, motivo: MOTIVOS['compra-gera'], imunidadeLC: null }
  }
  if (/^[567]/.test(cfop)) {
    return { cfop, efeito: 'venda', geraCredito: false, geraDebito: true, motivo: MOTIVOS.venda, imunidadeLC: sinalImunidadeLC(cfop, natOp) }
  }
  return { cfop, efeito: 'sem-efeito', geraCredito: false, geraDebito: false, motivo: 'CFOP não identificado — separado para conferência, sem compor crédito/débito.', imunidadeLC: null }
}

/** Atalho: só o efeito (para a apuração e agregadores). */
export function efeitoDoItem(
  cfopBruto: string | null | undefined,
  natOp?: string | null,
  direcao?: DirecaoEfeito | string | null,
): EfeitoCfop {
  return classificarCfop(cfopBruto, natOp, direcao).efeito
}

/* ------------------------- bloco: naturezas da operação ------------------- */

export interface ItemParaNatureza {
  cfop: string
}

export interface NotaParaNatureza {
  chave: string
  numero: string
  emitCnpj: string
  emitNome: string
  natOp: string
  direcao: 'entrada' | 'saida' | 'quarentena'
  valorTotal: number
  itensAnalisados: ItemParaNatureza[]
}

export interface NotaNaoVenda {
  chave: string
  numero: string
  emitCnpj: string
  emitNome: string
  natOp: string
  direcao: 'entrada' | 'saida' | 'quarentena'
  valorTotal: number
  cfops: string[]
  efeito: EfeitoCfop
  motivo: string
  imunidadeLC: string | null
}

export interface GrupoNatureza {
  /** Natureza como veio na capa (exibição). */
  natOp: string
  qtdNotas: number
  valorTotal: number
  temImobilizado: boolean
  temImunidade: boolean
  notas: NotaNaoVenda[]
}

export interface ResumoNaturezas {
  grupos: GrupoNatureza[]
  totalNotas: number
  qtdNaoVenda: number
  valorNaoVenda: number
  qtdImobilizado: number
  valorImobilizado: number
  qtdSemEfeito: number
  valorSemEfeito: number
  cfopsEnvolvidos: string[]
}

/**
 * Agrupa as notas cuja natureza (ou CFOP) **não é venda** — o bloquinho que
 * fica acima dos gráficos: "fornecedor X emitiu a nota Y com natureza
 * diferente de venda". Notas de venda pura ficam de fora.
 */
export function resumirNaturezas(notas: NotaParaNatureza[]): ResumoNaturezas {
  const grupos = new Map<string, GrupoNatureza>()
  const cfops = new Set<string>()
  let qtdImobilizado = 0
  let valorImobilizado = 0
  let qtdSemEfeito = 0
  let valorSemEfeito = 0

  for (const n of notas ?? []) {
    const natExibicao = String(n?.natOp ?? '').trim() || '(sem natureza informada)'
    const natClasse = classificarNatOp(n?.natOp)
    const efeitos = new Set<EfeitoCfop>()
    const cfopsNota = new Set<string>()
    for (const it of n?.itensAnalisados ?? []) {
      const c = normalizarCfop((it as { cfop?: string })?.cfop)
      if (c) cfopsNota.add(c)
      efeitos.add(efeitoDoItem((it as { cfop?: string })?.cfop, n?.natOp, n?.direcao))
    }
    const temRestritivo = efeitos.has('sem-efeito') || efeitos.has('imobilizado')
    // CFOP restritivo manda sobre a capa: mesmo com natureza "venda", item de
    // remessa/bonificação/imobilizado entra no bloco (sem crédito). Só sai do
    // bloco a nota sem nenhum item restritivo e com natureza de venda (ou
    // sem natureza informada).
    if (!temRestritivo && natClasse !== 'nao-venda' && natClasse !== 'imobilizado') continue

    const efeitoNota: EfeitoCfop = efeitos.has('imobilizado')
      ? 'imobilizado'
      : efeitos.has('sem-efeito')
        ? 'sem-efeito'
        : natClasse === 'nao-venda'
          ? 'sem-efeito'
          : 'compra-gera'
    const cls = efeitoNota === 'imobilizado'
      ? { motivo: MOTIVOS.imobilizado, imunidadeLC: null as string | null }
      : {
        motivo: natClasse === 'nao-venda'
          ? `Natureza "${natExibicao}" diferente de venda — sem direito a crédito.`
          : MOTIVOS['sem-efeito'],
        imunidadeLC: sinalImunidadeLC([...cfopsNota][0] ?? '', n?.natOp),
      }
    for (const c of cfopsNota) cfops.add(c)
    const linha: NotaNaoVenda = {
      chave: String(n?.chave ?? ''),
      numero: String(n?.numero ?? ''),
      emitCnpj: String(n?.emitCnpj ?? ''),
      emitNome: String(n?.emitNome ?? '') || String(n?.emitCnpj ?? ''),
      natOp: natExibicao,
      direcao: n?.direcao,
      valorTotal: Number(n?.valorTotal) || 0,
      cfops: [...cfopsNota].sort(),
      efeito: efeitoNota,
      motivo: cls.motivo,
      imunidadeLC: cls.imunidadeLC,
    }
    if (efeitoNota === 'imobilizado') {
      qtdImobilizado++
      valorImobilizado += linha.valorTotal
    } else {
      qtdSemEfeito++
      valorSemEfeito += linha.valorTotal
    }
    let g = grupos.get(natExibicao)
    if (!g) {
      g = { natOp: natExibicao, qtdNotas: 0, valorTotal: 0, temImobilizado: false, temImunidade: false, notas: [] }
      grupos.set(natExibicao, g)
    }
    g.qtdNotas++
    g.valorTotal += linha.valorTotal
    if (efeitoNota === 'imobilizado') g.temImobilizado = true
    if (linha.imunidadeLC) g.temImunidade = true
    g.notas.push(linha)
  }

  const lista = [...grupos.values()].sort((a, b) => b.valorTotal - a.valorTotal)
  const arred = (v: number): number => Math.round((Number(v) || 0) * 100) / 100
  return {
    grupos: lista.map((g) => ({ ...g, valorTotal: arred(g.valorTotal) })),
    totalNotas: (notas ?? []).length,
    qtdNaoVenda: qtdImobilizado + qtdSemEfeito,
    valorNaoVenda: arred(valorImobilizado + valorSemEfeito),
    qtdImobilizado,
    valorImobilizado: arred(valorImobilizado),
    qtdSemEfeito,
    valorSemEfeito: arred(valorSemEfeito),
    cfopsEnvolvidos: [...cfops].sort(),
  }
}

/* ----------------- imunidades da LC 214/2025 (conferência) ----------------- */

/**
 * Seção de conferência do bloco de naturezas: imunidades / não incidências
 * previstas na LC para comparar com as operações separadas.
 */
export const IMUNIDADES_LC214: { titulo: string; detalhe: string }[] = [
  {
    titulo: 'Exportação de bens e serviços',
    detalhe: 'Imunidade / não incidência: CFOP 7xxx ou natureza com "exportação" — não gera débito nem crédito.',
  },
  {
    titulo: 'Operações sem transferência de titularidade',
    detalhe: 'Remessas, transferências, demonstrações, consertos, comodatos e devoluções — sem fato gerador de IBS/CBS.',
  },
  {
    titulo: 'Bonificação, doação e brinde',
    detalhe: 'CFOP 5910/1910 e similares — sem crédito nem débito nesta apuração.',
  },
  {
    titulo: 'Ativo imobilizado e uso/consumo',
    detalhe: 'Compras 1551/2551/3551 (imobilizado) e 1556/2556/3556 (uso/consumo) — sem direito a crédito.',
  },
]
