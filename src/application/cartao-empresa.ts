/**
 * Cartão informativo da empresa — "Cartão CNPJ + Anexos do Simples".
 *
 * Junta o cadastro local (`Empresa`) com a consulta viva do CNPJ
 * (`consultarPorCnpj` → BrasilAPI + tabela CNAE × Anexo Simples) e gera um
 * PDF elegante com timbrado do emitente:
 * - identificação, endereço, contatos, IE/IM;
 * - selo Simples Nacional sim/não (optante ou não);
 * - cada CNAE com o seu Anexo do Simples agregado;
 * - contador responsável (condicional — só quando preenchido; PJ resolve
 *   via BrasilAPI para exibir os dados corretos);
 * - resumo de vínculos (produtos + notas).
 */
import { fmtCnpj } from '@/domain/services/format'
import { fmtCnae } from '@/infrastructure/base/normalizacao'
import { rotuloAnexoSimples } from '@/domain/services/cnae'
import type { Emitente, Empresa } from '@/domain/entities'
import type { VereditoEmpresa } from './consultar-por-cnpj'
import type { DadosCnpjBrasilApi } from '@/infrastructure/receita/brasilapi'

export interface LinhaCnaeCartao {
  codigo7: string
  codigoFormatado: string
  descricao: string
  principal: boolean
  situacao: string | null
  anexoRotulo: string
  fatorR: boolean
}

export interface ContadorCartao {
  tipo: 'pf' | 'pj'
  nome: string
  doc: string
  crc: string | null
  email: string | null
  telefone: string | null
  /** PJ resolvido na BrasilAPI (razão social oficial + endereço). */
  razaoSocialReceita: string | null
  fantasiaReceita: string | null
  enderecoReceita: string | null
}

export interface CartaoEmpresa {
  empresa: Empresa
  veredito: VereditoEmpresa | null
  cnaes: LinhaCnaeCartao[]
  simples: boolean | null
  contador: ContadorCartao | null
  totalProdutos: number
  totalNotas: number
  geradoEm: string
}

const normDig = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

function temContador(e: Empresa): boolean {
  return Boolean(e.contadorTipo === 'pf' || e.contadorTipo === 'pj') && Boolean((e.contadorNome ?? '').trim() || (e.contadorDoc ?? '').trim())
}

/** Monta os dados do cartão (best-effort: sem rede, sai só com o cadastro local). */
export async function montarCartaoEmpresa(empresa: Empresa): Promise<CartaoEmpresa> {
  let veredito: VereditoEmpresa | null = null
  const cnpjDig = normDig(empresa.cnpj)
  if (cnpjDig.length === 14) {
    try {
      const { consultarPorCnpj } = await import('./consultar-por-cnpj')
      veredito = await consultarPorCnpj(cnpjDig)
    } catch {
      veredito = null
    }
  }
  const cnaes: LinhaCnaeCartao[] = (veredito?.atividades ?? []).map((a) => {
    const regrasOk = a.regras?.estado === 'ok' ? a.regras : null
    return {
      codigo7: a.cnae7,
      codigoFormatado: a.codigoFormatado || fmtCnae(a.cnae7),
      descricao: a.descricao || a.cnaeTabela?.descricao || '—',
      principal: a.principal,
      situacao: a.cnaeTabela?.situacao ?? (regrasOk?.situacao ?? null),
      anexoRotulo: rotuloAnexoSimples(a.cnaeTabela?.anexos ?? regrasOk?.anexoSimples ?? []),
      fatorR: Boolean(a.cnaeTabela?.fatorR ?? regrasOk?.fatorR),
    }
  })

  let contador: ContadorCartao | null = null
  if (temContador(empresa)) {
    const tipo = empresa.contadorTipo as 'pf' | 'pj'
    const base: ContadorCartao = {
      tipo,
      nome: (empresa.contadorNome ?? '').trim(),
      doc: normDig(empresa.contadorDoc),
      crc: (empresa.contadorCrc ?? '').trim() || null,
      email: (empresa.contadorEmail ?? '').trim() || null,
      telefone: (empresa.contadorTelefone ?? '').trim() || null,
      razaoSocialReceita: null,
      fantasiaReceita: null,
      enderecoReceita: null,
    }
    // PJ: consulta completa do CNPJ para ir com as informações corretas.
    if (tipo === 'pj' && base.doc.length === 14) {
      try {
        const { buscarCnpj } = await import('@/infrastructure/receita/brasilapi')
        const d: DadosCnpjBrasilApi = await buscarCnpj(base.doc)
        base.razaoSocialReceita = d.razaoSocial || null
        base.fantasiaReceita = d.fantasia || null
        base.enderecoReceita = [d.endereco, d.cidade && d.uf ? `${d.cidade}/${d.uf}` : d.cidade, d.cep].filter(Boolean).join(' · ') || null
        if (!base.nome) base.nome = d.razaoSocial || base.nome
      } catch {
        /* offline: segue com o digitado */
      }
    }
    contador = base
  }

  let totalProdutos = 0
  let totalNotas = 0
  if (empresa.id != null) {
    try {
      const mod = await import('./empresas')
      const v = await mod.contarVinculosEmpresa(empresa.id)
      totalProdutos = v.produtos
      totalNotas = v.notas
    } catch {
      /* contagem é cosmética */
    }
  }

  return {
    empresa,
    veredito,
    cnaes,
    simples: veredito?.opcaoSimples ?? (empresa.regimeTributario === 'simples' || empresa.regimeTributario === 'mei' ? true : empresa.regimeTributario === 'normal' ? false : null),
    contador,
    totalProdutos,
    totalNotas,
    geradoEm: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
  }
}

/* ------------------------------------------------------------ PDF elegante -- */

function hexCor(cor: string | undefined): string {
  const c = String(cor ?? '#0f215c').trim()
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#0f215c'
}

function etiquetaRegime(e: Empresa, simples: boolean | null): string {
  if (e.regimeTributario === 'mei') return 'MEI — optante pelo Simples Nacional'
  if (e.regimeTributario === 'simples' || simples === true) return 'Optante pelo Simples Nacional'
  if (e.regimeTributario === 'normal' || simples === false) return 'Não optante — regime normal'
  return 'Regime não identificado'
}

/** PDF elegante do cartão (timbrado do emitente + selo Simples + CNAEs com anexos). */
export async function exportarCartaoEmpresaPDF(cartao: CartaoEmpresa, emitente: Emitente): Promise<void> {
  const { baixarPdf } = await import('@/infrastructure/pdf/setup')
  const { doc, nome } = await construirDocCartao(cartao, emitente)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await baixarPdf(doc as any, nome)
}

/** Abre o cartão no visualizador para impressão (mesmo documento elegante do PDF). */
export async function imprimirCartaoEmpresa(cartao: CartaoEmpresa, emitente: Emitente): Promise<void> {
  const { abrirPdf } = await import('@/infrastructure/pdf/setup')
  const { doc } = await construirDocCartao(cartao, emitente)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await abrirPdf(doc as any)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function construirDocCartao(cartao: CartaoEmpresa, emitente: Emitente): Promise<{ doc: any; nome: string }> {
  const { timbrado, rodape, tabelaRelatorio } = await import('@/infrastructure/exporters/relatorios')
  const { fundoMarcaDagua } = await import('@/infrastructure/pdf/marca-dagua')
  const cor = hexCor(emitente.cor)
  const e = cartao.empresa
  const v = cartao.veredito
  const endereco = [e.endereco, e.cidade && e.uf ? `${e.cidade}/${e.uf}` : (e.cidade ?? e.uf), e.cep ? `CEP ${e.cep}` : ''].filter(Boolean).join(' · ')
  const contatos = [e.telefone, e.email].filter(Boolean).join(' · ')
  const simples = cartao.simples
  const seloSimples = simples === true ? 'SIMPLES NACIONAL · OPTANTE' : simples === false ? 'FORA DO SIMPLES · REGIME NORMAL' : 'SIMPLES · NÃO IDENTIFICADO'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [
    {
      text: 'Cartão informativo da empresa',
      fontSize: 16,
      bold: true,
      color: cor,
      margin: [0, 2, 0, 1],
    },
    {
      text: `Gerado em ${cartao.geradoEm} · Aurum Tax NCM (LC 214/2025)`,
      fontSize: 7.6,
      color: '#7a8896',
      margin: [0, 0, 0, 8],
    },
    // Faixa de identidade: razão + selo Simples.
    {
      table: {
        widths: ['*', 'auto'],
        body: [[
          {
            stack: [
              { text: e.razaoSocial || '—', fontSize: 13, bold: true, color: '#0f172a' },
              ...(e.fantasia ? [{ text: e.fantasia, fontSize: 9, color: '#64748b' }] : []),
              { text: `CNPJ ${e.cnpj ? fmtCnpj(e.cnpj) : 'não informado'}${v?.porte ? ` · Porte ${v.porte}` : ''}${v?.situacao ? ` · ${v.situacao}` : ''}`, fontSize: 8, color: '#475569', margin: [0, 3, 0, 0] },
              ...(endereco ? [{ text: endereco, fontSize: 7.6, color: '#64748b', margin: [0, 2, 0, 0] }] : []),
              ...(contatos ? [{ text: contatos, fontSize: 7.6, color: '#64748b' }] : []),
              ...((e.ie || e.im) ? [{ text: [e.ie ? `IE ${e.ie}` : '', e.im ? `IM ${e.im}` : ''].filter(Boolean).join(' · '), fontSize: 7.6, color: '#64748b' }] : []),
            ],
            margin: [10, 8, 10, 8],
          },
          {
            stack: [
              { text: simples === true ? '✓' : simples === false ? '○' : '?', fontSize: 22, bold: true, color: '#ffffff', alignment: 'center' },
              { text: seloSimples, fontSize: 7, bold: true, color: '#ffffff', alignment: 'center', margin: [0, 2, 0, 0] },
              { text: etiquetaRegime(e, simples), fontSize: 6.6, color: '#ffffff', alignment: 'center', margin: [0, 2, 0, 0] },
            ],
            fillColor: simples === true ? '#b45309' : simples === false ? '#0f766e' : '#64748b',
            margin: [10, 8, 10, 8],
          },
        ]],
      },
      layout: { defaultBorder: false, fillColor: () => null },
      margin: [0, 0, 0, 6],
    },
    {
      columns: [
        { text: `📦 ${cartao.totalProdutos} produto(s)`, fontSize: 7.6, bold: true, color: '#334155' },
        { text: `🧾 ${cartao.totalNotas} documento(s) fiscal(is)`, fontSize: 7.6, bold: true, color: '#334155' },
        { text: `🏭 ${cartao.cnaes.length} CNAE(s)`, fontSize: 7.6, bold: true, color: '#334155', alignment: 'right' },
      ],
      margin: [0, 0, 0, 6],
    },
  ]

  // CNAEs com anexos do Simples agregados.
  content.push({ text: 'Atividades (CNAE × Anexo do Simples Nacional)', fontSize: 10.5, bold: true, color: '#1f3d37', margin: [0, 8, 0, 1] })
  if (!cartao.cnaes.length) {
    content.push({ text: cnpjSemCnaeTexto(e), fontSize: 7.6, color: '#64748b', margin: [0, 0, 0, 4] })
  } else {
    content.push(
      tabelaRelatorio({
        cols: [
          { titulo: 'CNAE', larg: 14, mono: true, forte: true },
          { titulo: 'Atividade', larg: 38 },
          { titulo: 'Tipo', larg: 10, alin: 'center' },
          { titulo: 'Situação', larg: 16, alin: 'center' },
          { titulo: 'Anexo Simples', larg: 22, alin: 'center', forte: true },
        ],
        rows: cartao.cnaes.map((c) => [
          c.codigoFormatado,
          `${c.descricao}${c.fatorR ? ' (Fator R)' : ''}`,
          c.principal ? 'Principal' : 'Secundário',
          c.situacao ?? '—',
          c.anexoRotulo.replace('Anexo Simples ', ''),
        ]),
        corCabecalho: cor,
      }) as never,
    )
    content.push({
      text: 'Anexos I–V do Simples Nacional (elegibilidade + Fator R) — não confundir com os anexos da LC 214/2025. Fator R: folha ≥ 28% do faturamento tende ao Anexo III, senão ao V.',
      fontSize: 6.8,
      color: '#7a8896',
      margin: [0, 2, 0, 4],
    })
  }

  // Contador (condicional — só quando preenchido).
  if (cartao.contador) {
    const c = cartao.contador
    content.push({ text: 'Contador responsável', fontSize: 10.5, bold: true, color: '#1f3d37', margin: [0, 8, 0, 1] })
    content.push(
      tabelaRelatorio({
        cols: [
          { titulo: 'Campo', larg: 22, forte: true },
          { titulo: 'Valor', larg: 78 },
        ],
        rows: [
          ['Tipo', c.tipo === 'pj' ? 'Pessoa jurídica' : 'Pessoa física'],
          ['Nome', c.razaoSocialReceita && c.tipo === 'pj' ? `${c.nome} · Receita: ${c.razaoSocialReceita}${c.fantasiaReceita ? ` (${c.fantasiaReceita})` : ''}` : c.nome],
          [c.tipo === 'pj' ? 'CNPJ' : 'CPF', c.doc ? (c.tipo === 'pj' ? fmtCnpj(c.doc) : c.doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')) : '—'],
          ...(c.enderecoReceita ? [['Endereço (Receita)', c.enderecoReceita]] : []),
          ...(c.crc ? [['CRC', c.crc]] : []),
          ...(c.email ? [['E-mail', c.email]] : []),
          ...(c.telefone ? [['Telefone', c.telefone]] : []),
        ],
        corCabecalho: cor,
      }) as never,
    )
  }

  content.push({
    text: 'Fonte: cadastro local + Receita via BrasilAPI (CNAEs, porte e opção pelo Simples). Anexos do Simples por CNAE conforme tabela viva; tributação da Reforma é informativa — confirme com o contador antes de escriturar.',
    fontSize: 6.8,
    color: '#94a3b8',
    margin: [0, 10, 0, 0],
  })

  const razao = (e.razaoSocial || 'empresa').replace(/\W+/g, '_').slice(0, 40) || 'empresa'
  const doc = {
    pageSize: 'A4',
    pageMargins: [34, 102, 34, 52],
    defaultStyle: { font: 'Roboto', fontSize: 7, color: '#1e293b' },
    background: fundoMarcaDagua(300, 0.07),
    info: { title: `Cartão informativo — ${e.razaoSocial}`, author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    header: (() => timbrado(emitente, cor, 'Cartão informativo da empresa', `${e.razaoSocial} · ${e.cnpj ? fmtCnpj(e.cnpj) : 'sem CNPJ'} · ${cartao.geradoEm}`)) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    footer: rodape(emitente) as any,
    content,
  }
  return { doc, nome: `cartao_empresa_${razao}_${new Date().toISOString().slice(0, 10)}.pdf` }
}

function cnpjSemCnaeTexto(e: Empresa): string {
  if (!normDig(e.cnpj)) return 'Sem CNPJ cadastrado — cadastre o CNPJ para puxar as atividades (CNAEs) da Receita.'
  return 'Nenhum CNAE retornado pela Receita para este CNPJ — confira o número ou atualize a consulta.'
}
