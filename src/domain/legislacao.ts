/**
 * Catálogo de legislações da Reforma Tributária + ICMS-CE, com helpers de
 * ancoragem.
 *
 * Utilidade (pedido do usuário): todos os produtos referenciam algum
 * artigo/parágrafo da lei. Por isso:
 * - o menu **Legislação** abre cada norma **na íntegra em nova aba**,
 *   organizada em grupos (base federal, decretos federais, RICMS-CE, portais);
 * - na **Consulta**, "Visualizar legislação" abre um **modal** com `iframe`
 *   apontando para a URL **com âncora** (`#art128`, `#art137`, …), de modo
 *   que o `scroll` do documento já cai exatamente no trecho citado.
 *
 * As URLs vindas da base (`referencia.urlLegislacao`) já trazem a âncora
 * (`lcp214.htm#art93`, …). Os links genéricos (`LINK_LC214` puro) ganham a
 * âncora via `urlComAncora(url, textoRef)`, que extrai `Art. NNN` do título
 * ou da referência legal.
 *
 * Fontes dos índices:
 * - decretos federais: Portal da Legislação do Planalto
 *   (`LINK_PORTAL_DECRETOS_PLANALTO`);
 * - decretos/leis do ICMS-CE: portal SEFAZLEGIS (`LINK_SEFAZLEGIS_CE`).
 *   O SEFAZLEGIS é um SPA sem URL profunda por norma — por isso os itens do
 *   RICMS-CE apontam para o portal com o campo `buscaPortal` indicando o
 *   número exato a pesquisar. Não se importa a íntegra de *todos* os decretos
 *   federais (milhares, fora do escopo fiscal): catalogam-se os decretos com
 *   impacto tributário + os índices oficiais para consulta completa.
 */
import {
  LINK_DECRETO_12955,
  LINK_EC132,
  LINK_LC214,
  LINK_LC227,
  LINK_PORTAL_CFF,
  LINK_PORTAL_DECRETOS_PLANALTO,
  LINK_RES_CGIBS_6,
  LINK_RFB_LEGISLACAO_REFORMA,
  LINK_SEFAZCE_LEGISLACAO,
  LINK_SEFAZLEGIS_CE,
} from './constants'

export type TipoLegislacao = 'emenda' | 'lei' | 'decreto' | 'resolucao' | 'portal'

export type EsferaLegislacao = 'federal' | 'estadual-ce'

/** Grupo de exibição no menu Legislação (ordem do array = ordem na tela). */
export type GrupoLegislacao =
  | 'base-federal'
  | 'decretos-federais'
  | 'icms-ce'
  | 'portais'

export interface ItemLegislacao {
  id: string
  sigla: string
  titulo: string
  descricao: string
  utilidade: string
  url: string
  tipo: TipoLegislacao
  rotuloTipo: string
  esfera: EsferaLegislacao
  grupo: GrupoLegislacao
  /**
   * Termo exato a pesquisar no portal de origem quando ele não oferece
   * link profundo por norma (ex.: SEFAZLEGIS). Exibido no card.
   */
  buscaPortal?: string
}

export const GRUPOS_LEGISLACAO: { id: GrupoLegislacao; titulo: string; descricao: string }[] = [
  {
    id: 'base-federal',
    titulo: 'Reforma Tributária — base federal',
    descricao: 'Emenda constitucional, leis complementares e regulamentos do IBS/CBS.',
  },
  {
    id: 'decretos-federais',
    titulo: 'Decretos federais — índice oficial',
    descricao:
      'O Portal da Legislação do Planalto lista todos os decretos. Abaixo, o regulamento da CBS com impacto direto no sistema + o índice completo.',
  },
  {
    id: 'icms-ce',
    titulo: 'ICMS Ceará — RICMS (SEFAZLEGIS)',
    descricao:
      'Nova Lei do ICMS-CE e os decretos do Regulamento (RICMS por livros). Use o termo indicado para localizar cada decreto no portal SEFAZLEGIS.',
  },
  {
    id: 'portais',
    titulo: 'Portais oficiais',
    descricao: 'Acesso operacional aos portais da Reforma e do fisco cearense.',
  },
]

export const LEGISLACOES: ItemLegislacao[] = [
  // ------------------------------------------------- base federal --
  {
    id: 'ec132',
    sigla: 'EC 132/2023',
    titulo: 'Emenda Constitucional nº 132/2023',
    descricao:
      'Base constitucional da Reforma Tributária do Consumo: cria o IBS, a CBS e o Imposto Seletivo e define a transição.',
    utilidade: 'Fundamento constitucional invocado pela LC 214/2025 e seus regulamentos.',
    url: LINK_EC132,
    tipo: 'emenda',
    rotuloTipo: 'Emenda Constitucional',
    esfera: 'federal',
    grupo: 'base-federal',
  },
  {
    id: 'lc214',
    sigla: 'LC 214/2025',
    titulo: 'Lei Complementar nº 214/2025',
    descricao:
      'Institui o IBS, a CBS e o Imposto Seletivo. É a norma-mãe da Reforma — todos os trechos citados nos produtos (artigos, parágrafos e anexos) vêm daqui.',
    utilidade:
      'Referência direta dos trechos citados na Consulta. Use "Visualizar legislação" no produto para cair exatamente no artigo citado.',
    url: LINK_LC214,
    tipo: 'lei',
    rotuloTipo: 'Lei Complementar',
    esfera: 'federal',
    grupo: 'base-federal',
  },
  {
    id: 'lc227',
    sigla: 'LC 227/2026',
    titulo: 'Lei Complementar nº 227/2026',
    descricao:
      'Altera dispositivos da LC 214/2025 (ex.: regras de medicamentos com alíquota zero e ajustes de redação).',
    utilidade: 'Conferir a redação atualizada dos artigos da LC 214 alterados em 2026.',
    url: LINK_LC227,
    tipo: 'lei',
    rotuloTipo: 'Lei Complementar',
    esfera: 'federal',
    grupo: 'base-federal',
  },
  {
    id: 'res-cgibs-6',
    sigla: 'Res. CGIBS nº 6/2026',
    titulo: 'Resolução CGIBS nº 6, de 30.04.2026 — Regulamenta o IBS',
    descricao:
      'Regulamentação do Imposto sobre Bens e Serviços (IBS) pelo Comitê Gestor — regras de transição, regimes específicos e procedimentos (PDF oficial).',
    utilidade: 'Consulta operacional do IBS: regulamento do Comitê Gestor.',
    url: LINK_RES_CGIBS_6,
    tipo: 'resolucao',
    rotuloTipo: 'Resolução CGIBS',
    esfera: 'federal',
    grupo: 'base-federal',
  },
  // --------------------------------------------- decretos federais --
  {
    id: 'dec12955',
    sigla: 'Decreto 12.955/2026',
    titulo: 'Decreto nº 12.955, de 29.04.2026 — CBS',
    descricao:
      'Regulamenta a Contribuição sobre Bens e Serviços (CBS) no âmbito federal, detalhando operacionalização, apuração e recolhimento (1.164 artigos).',
    utilidade:
      'Consulta operacional da CBS: prazos, apuração e obrigações acessórias federais.',
    url: LINK_DECRETO_12955,
    tipo: 'decreto',
    rotuloTipo: 'Decreto Federal',
    esfera: 'federal',
    grupo: 'decretos-federais',
  },
  {
    id: 'portal-decretos-planalto',
    sigla: 'Índice de decretos',
    titulo: 'Portal da Legislação — todos os decretos federais',
    descricao:
      'Índice oficial do Planalto com todos os decretos por ano (2026, 2025, …). Use para localizar qualquer outro decreto federal além do da CBS.',
    utilidade: 'Pesquisa completa de decretos federais por ano/número no site oficial.',
    url: LINK_PORTAL_DECRETOS_PLANALTO,
    tipo: 'portal',
    rotuloTipo: 'Índice oficial',
    esfera: 'federal',
    grupo: 'decretos-federais',
  },
  // ---------------------------------------------------- ICMS-CE --
  {
    id: 'lei18665-ce',
    sigla: 'Lei 18.665/2023 (CE)',
    titulo: 'Lei Estadual nº 18.665/2023 — Nova Lei do ICMS-CE',
    descricao:
      'Nova lei do ICMS do Estado do Ceará: fato gerador, contribuintes, Cadastro Geral da Fazenda (CGF) e regras do imposto estadual.',
    utilidade: 'Base legal do ICMS-CE vigente; os decretos do RICMS a regulamentam.',
    url: LINK_SEFAZLEGIS_CE,
    tipo: 'lei',
    rotuloTipo: 'Lei Estadual (CE)',
    esfera: 'estadual-ce',
    grupo: 'icms-ce',
    buscaPortal: 'Lei nº 18.665/2023',
  },
  {
    id: 'dec24569-ce',
    sigla: 'Decreto 24.569/1997 (CE)',
    titulo: 'Decreto nº 24.569/1997 — RICMS-CE (base)',
    descricao:
      'Consolida e regulamenta a legislação do ICMS-CE. Partes foram revogadas pelos livros publicados em decretos próprios; permanece vigente sobretudo o Livro III.',
    utilidade: 'Regulamento-base do ICMS-CE; consultar a consolidação vigente no SEFAZLEGIS.',
    url: LINK_SEFAZLEGIS_CE,
    tipo: 'decreto',
    rotuloTipo: 'Decreto Estadual (CE)',
    esfera: 'estadual-ce',
    grupo: 'icms-ce',
    buscaPortal: 'Decreto nº 24.569/1997',
  },
  {
    id: 'dec33327-ce',
    sigla: 'Decreto 33.327/2019 (CE)',
    titulo: 'Decreto nº 33.327/2019 — RICMS-CE, Livro I',
    descricao:
      'Livro I do RICMS-CE (parte do regulamento republicada em livro próprio). Um dos livros mais impactados pela Nova Lei do ICMS.',
    utilidade: 'Localizar o Livro I vigente do RICMS-CE no SEFAZLEGIS.',
    url: LINK_SEFAZLEGIS_CE,
    tipo: 'decreto',
    rotuloTipo: 'Decreto Estadual (CE)',
    esfera: 'estadual-ce',
    grupo: 'icms-ce',
    buscaPortal: 'Decreto nº 33.327/2019',
  },
  {
    id: 'dec35061-ce',
    sigla: 'Decreto 35.061/2022 (CE)',
    titulo: 'Decreto nº 35.061/2022 — RICMS-CE, Livro II',
    descricao:
      'Livro II do RICMS-CE: obrigações acessórias (CGF, livros e escrituração fiscal, selos fiscais de trânsito e de águas, documentos de arrecadação). Vigência a partir de 01/05/2023.',
    utilidade: 'Obrigações acessórias do ICMS-CE (cadastro, livros, selos, arrecadação).',
    url: LINK_SEFAZLEGIS_CE,
    tipo: 'decreto',
    rotuloTipo: 'Decreto Estadual (CE)',
    esfera: 'estadual-ce',
    grupo: 'icms-ce',
    buscaPortal: 'Decreto nº 35.061/2022',
  },
  {
    id: 'dec34605-ce',
    sigla: 'Decreto 34.605/2022 (CE)',
    titulo: 'Decreto nº 34.605/2022 — RICMS-CE, Livro IV',
    descricao:
      'Livro IV do RICMS-CE (vigência a partir de 01/06/2022): disciplina ainda o processo de consulta tributária (arts. 160 e seguintes).',
    utilidade: 'Consulta tributária estadual e demais matérias do Livro IV.',
    url: LINK_SEFAZLEGIS_CE,
    tipo: 'decreto',
    rotuloTipo: 'Decreto Estadual (CE)',
    esfera: 'estadual-ce',
    grupo: 'icms-ce',
    buscaPortal: 'Decreto nº 34.605/2022',
  },
  // ----------------------------------------------------- portais --
  {
    id: 'portal-cff',
    sigla: 'Conformidade Fácil',
    titulo: 'Portal da Conformidade Fácil (CFF)',
    descricao:
      'Ambiente oficial da SEFAZ-RS para emissão assistida, conformidade e serviços do IBS/CBS em produção.',
    utilidade: 'Acesso operacional ao portal oficial (ambiente externo).',
    url: LINK_PORTAL_CFF,
    tipo: 'portal',
    rotuloTipo: 'Portal oficial',
    esfera: 'federal',
    grupo: 'portais',
  },
  {
    id: 'rfb-legislacao-reforma',
    sigla: 'RFB — Reforma',
    titulo: 'Receita Federal — Legislação da Reforma do Consumo',
    descricao:
      'Página oficial com os marcos regulatórios da Reforma (EC, LCs, decreto da CBS, atos conjuntos e atos técnicos conjuntos).',
    utilidade: 'Acompanhar novos atos da Reforma (marcos regulatórios e atos conjuntos).',
    url: LINK_RFB_LEGISLACAO_REFORMA,
    tipo: 'portal',
    rotuloTipo: 'Portal oficial',
    esfera: 'federal',
    grupo: 'portais',
  },
  {
    id: 'sefazlegis-ce',
    sigla: 'SEFAZLEGIS-CE',
    titulo: 'Portal SEFAZLEGIS — legislação tributária do Ceará',
    descricao:
      'Portal oficial da SEFAZ-CE com leis, decretos, normas de execução e demais atos da legislação tributária estadual.',
    utilidade: 'Pesquisar qualquer decreto/lei estadual pelo número (ex.: os decretos do RICMS acima).',
    url: LINK_SEFAZLEGIS_CE,
    tipo: 'portal',
    rotuloTipo: 'Portal oficial (CE)',
    esfera: 'estadual-ce',
    grupo: 'portais',
  },
  {
    id: 'sefazce-legislacao',
    sigla: 'SEFAZ-CE',
    titulo: 'SEFAZ-CE — Legislação Tributária e informativos',
    descricao:
      'Página da SEFAZ-CE com informativos quinzenais das normas editadas pelo fisco estadual (a publicação eletrônica não substitui o DOE).',
    utilidade: 'Monitorar novidades normativas do fisco cearense a cada 15 dias.',
    url: LINK_SEFAZCE_LEGISLACAO,
    tipo: 'portal',
    rotuloTipo: 'Portal oficial (CE)',
    esfera: 'estadual-ce',
    grupo: 'portais',
  },
]

/**
 * Fontes oficiais para buscar as bases de dados (bloco fixo no topo da tela
 * Legislação, acima de todos os grupos).
 *
 * Espelha os 3 cards da aba "Bases" (Configurações): cada fonte indica qual
 * base alimenta, qual arquivo baixar e o passo para importar.
 */
export interface FonteBase {
  id: string
  titulo: string
  base: 'referencia' | 'reforma' | 'nomenclatura'
  rotuloBase: string
  descricao: string
  arquivo: string
  passo: string
  url: string
  /** Quando true, o modal avisa que o portal pode pedir certificado e-CNPJ. */
  exigeCert: boolean
}

export const FONTES_BASES: FonteBase[] = [
  {
    id: 'fonte-ncm-siscomex',
    titulo: 'Siscomex — NCM vigente',
    base: 'nomenclatura',
    rotuloBase: 'Alimenta: NCM vigente (Siscomex)',
    descricao:
      'Portal Único Siscomex (módulo Classif): tabela NCM vigente com descrições, vigências e extintos. Arquivo regenerado diariamente.',
    arquivo: 'Tabela_NCM_Vigente_*.json',
    passo: 'No portal Classif, abra Nomenclatura/Tabela ou use o download JSON público, salve o arquivo e importe no card “NCM vigente (Siscomex)” da aba Bases.',
    url: 'https://portalunico.siscomex.gov.br/classif/',
    exigeCert: false,
  },
  {
    id: 'fonte-classificacao-dfe',
    titulo: 'Portal DFe — Classificação Tributária',
    base: 'referencia',
    rotuloBase: 'Alimenta: Classificação tributária',
    descricao:
      'Portal DFe (SEFAZ-RS): referência oficial CST × cClassTrib com reduções, anexos e documentos habilitados (164 registros).',
    arquivo: 'classificacao_tributaria.json',
    passo: 'No portal DFe, abra Classificação Tributária, baixe o JSON oficial e importe no card “Classificação tributária” da aba Bases.',
    url: 'https://dfe-portal.svrs.rs.gov.br/DFE/ClassificacaoTributaria',
    exigeCert: true,
  },
  {
    id: 'fonte-reforma-cff',
    titulo: 'Conformidade Fácil — planilha Reforma por NCM (Excel)',
    base: 'reforma',
    rotuloBase: 'Alimenta: Reforma por NCM / NBS',
    descricao:
      'Planilha “Reforma Tributaria consulta por NCM” gerada pela Conformidade Fácil (2345 NCM + 137 NBS com CST e cClassTrib). Traz só 132 pares CST×cClassTrib — o dicionário completo (164) vem da base de Classificação Tributária acima.',
    arquivo: 'reforma_tributaria_por_ncm.json (via Excel original)',
    passo: 'Use a planilha Excel da Conformidade Fácil, converta para reforma_tributaria_por_ncm.json e importe no card “Reforma por NCM / NBS” da aba Bases. Confira a redação vigente na página da RFB.',
    url: LINK_RFB_LEGISLACAO_REFORMA,
    exigeCert: false,
  },
  {
    id: 'fonte-api-cff-tribs',
    titulo: 'API CFF — classTrib e anexos',
    base: 'referencia',
    rotuloBase: 'Alimenta: Classificação tributária e anexos',
    descricao:
      'Endpoints oficiais da Conformidade Fácil: classTrib (164 referências em formato nativo), anexos (NCM/NBS × anexo × permissão), credPresumido e indOper. Exigem certificado digital e-CNPJ.',
    arquivo: 'classTrib.json, anexos.json, credPresumido.json, indOper.json',
    passo: 'Acesse um dos endpoints (…/classTrib, …/anexos, …/credPresumido, …/indOper) com o certificado, salve cada JSON e importe todos de uma vez na aba Bases — o sistema reconhece cada um.',
    url: 'https://cff.svrs.rs.gov.br/api/v1/consultas/classTrib',
    exigeCert: true,
  },
  {
    id: 'fonte-api-cff-produtos',
    titulo: 'API CFF — produtos por DFe',
    base: 'reforma',
    rotuloBase: 'Alimenta: Produtos por DFe',
    descricao:
      'Endpoint ConsultaClassificacaoProduto por sistema (NFCom, NFAg, NF3e, NFGas): catálogo de produtos de cada documento fiscal. Exige certificado; o arquivo não declara o sistema.',
    arquivo: 'ConsultaClassificacaoProduto.json (+ sistema)',
    passo: 'Acesse …/ConsultaClassificacaoProduto?sistema=NFCom (troque o sistema para cada um dos 4), salve os JSONs, importe todos e informe o sistema de cada arquivo na aba Bases.',
    url: 'https://cff.svrs.rs.gov.br/api/v1/consultas/ConsultaClassificacaoProduto?sistema=NFCom',
    exigeCert: true,
  },
]

/** Extrai `art128` de textos como "Art. 128 — Redução…", "art133", "Artigo 137". */
export function ancoraParaArtigo(texto?: string | null): string | null {
  if (!texto) return null
  const m = texto.match(/art(?:igo|\.)?\s*\.?\s*(\d{1,3})\s*(?:-[A-Z])?/i)
  if (!m) return null
  return `art${m[1]}`
}

/**
 * Devolve a URL com âncora para o artigo citado.
 *
 * - Se a URL já tem `#…`, mantém como está (a base já referencia o ponto exato).
 * - Se for página HTML do Planalto/CGIBS e o texto cita `Art. NNN`, anexa `#artNNN`.
 * - PDFs e portais não aceitam âncora de artigo: devolve a URL pura.
 */
export function urlLegislacaoComAncora(
  url?: string | null,
  textoRef?: string | null,
): string | null {
  if (!url) return null
  if (url.includes('#')) return url
  const ancora = ancoraParaArtigo(textoRef)
  if (!ancora) return url
  if (/\.pdf(\?|$)/i.test(url)) return url
  if (/planalto\.gov\.br| identif|legislacao/i.test(url) || url.startsWith(LINK_LC214))
    return `${url}#${ancora}`
  if (/cgibs\.gov\.br/i.test(url) && !/\.pdf/i.test(url)) return `${url}#${ancora}`
  // LC 214 e decretos do Planalto usam âncoras `artNNN` — tenta mesmo assim.
  if (/planalto/i.test(url)) return `${url}#${ancora}`
  return url
}

/** Rótulo curto do destino exibido no modal ("lcp214.htm · art. 128"). */
export function rotuloDestino(url: string): string {
  try {
    const u = new URL(url)
    const base = u.pathname.split('/').pop() || u.hostname
    const hash = u.hash ? ` · ${u.hash.replace('#', '').replace(/^art/i, 'art. ')}` : ''
    return `${base}${hash}`
  } catch {
    return url
  }
}
