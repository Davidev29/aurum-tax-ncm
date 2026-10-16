/**
 * Tour guiado — conteúdo do onboarding pós-instalação.
 *
 * Redesenho v2 (pós-avaliação multiagente):
 * - 10 passos preservados (contrato menu a menu), mas agrupados em
 *   3 TRILHAS por objetivo — Calcular / Organizar / Dominar.
 * - Cada passo tem `promessa` (em 30s…) + `resultado` (concluído quando…),
 *   linguagem de verbo + exemplo clicável, jargão glossarizado inline
 *   e dica como GANHO, não aviso.
 *
 * 100% local, sem rede. Textos em linguagem de usuário.
 */
import type { ViewId } from '@/store/ui'

export type TrilhaId = 'calcular' | 'organizar' | 'dominar'

export interface TrilhaTour {
  id: TrilhaId
  titulo: string
  descricao: string
  icone: string
  passos: ViewId[]
}

export const TRILHAS_TOUR: TrilhaTour[] = [
  {
    id: 'calcular',
    titulo: 'Calcular impostos',
    descricao: 'Do produto ao imposto em ~2 min',
    icone: '🧮',
    passos: ['calculadora', 'consulta', 'simples', 'servicos'],
  },
  {
    id: 'organizar',
    titulo: 'Organizar dados',
    descricao: 'Produtos, planilhas e notas',
    icone: '🗂️',
    passos: ['cnaes', 'produtos', 'lote', 'nfe'],
  },
  {
    id: 'dominar',
    titulo: 'Dominar as regras',
    descricao: 'Tabelas e lei, sem mistério',
    icone: '⚖️',
    passos: ['auxiliares', 'legislacao'],
  },
]

export interface PassoTour {
  id: ViewId
  /** Rótulo do menu na sidebar. */
  menu: string
  icone: string
  /** Trilha de objetivo a que pertence. */
  trilha: TrilhaId
  /** Promessa de 1 frase ("Em 30s: …"). */
  promessa: string
  /** O que este menu faz (1-2 frases, verbo + tarefa). */
  oQueFaz: string
  /** Como usar — 3-4 micro-ações numeradas (verbo + onde clicar + o que ver). */
  comoUsar: string[]
  /** Dica prática — formulada como ganho. */
  dica: string
  /** Critério de conclusão visível ("Você concluiu quando vê…"). */
  resultado: string
  /**
   * Rótulo do CTA "Experimentar agora" (navega ao menu real).
   * Mantido também para o contrato de testes.
   */
  acao: string
}

export const PASSOS_TOUR: PassoTour[] = [
  {
    id: 'calculadora',
    menu: 'Calculadora',
    icone: '🧮',
    trilha: 'calcular',
    promessa: 'Em 30 segundos: do produto ao imposto da cesta.',
    oQueFaz: 'Monte uma cesta de produtos e veja IBS + CBS e a carga efetiva recalculando na hora.',
    comoUsar: [
      'Busque um produto salvo por SKU, nome ou NCM — ou use “NCM manual”.',
      'Ajuste quantidade e valor unitário direto na lista.',
      'Leia o Resumo: base · IBS (R$) · CBS (R$) · total · carga efetiva em %.',
    ],
    dica: 'As alíquotas de referência valem para todo o sistema e a redução é congelada quando o item entra na cesta.',
    resultado: 'Você concluiu quando vê o total IBS + CBS e a carga % no Resumo.',
    acao: 'Abrir Calculadora',
  },
  {
    id: 'consulta',
    menu: 'Consulta NCM',
    icone: '🔍',
    trilha: 'calcular',
    promessa: 'Em 30 segundos: do NCM ao imposto + base legal.',
    oQueFaz: 'Digite um NCM de 8 dígitos e receba CST, cClassTrib (o código da Reforma), reduções e o artigo da lei.',
    comoUsar: [
      'Digite 02011000 (carne bovina) com ou sem ponto — ou o nome do produto.',
      'Clique em Classificar e leia 1 cartão por regra encontrada.',
      'Abra a lei no artigo exato pelo link do cartão e ajuste o simulador.',
    ],
    dica: 'Sem regra exata mostramos a família do produto (SH6 = 6 primeiros dígitos) com selo de confiança: verde confia, âmbar revisa.',
    resultado: 'Você concluiu quando vê 1 cartão com CST + alíquota + artigo clicável.',
    acao: 'Abrir Consulta NCM',
  },
  {
    id: 'simples',
    menu: 'Simples Nacional',
    icone: '🧾',
    trilha: 'calcular',
    promessa: 'Em 1 minuto: descubra se o Híbrido vence o Convencional.',
    oQueFaz: 'Apure o DAS por Anexo I–V com Reforma (CBS/IBS), Fator R, sublimite e o duelo Convencional × Híbrido.',
    comoUsar: [
      'Passo 1: escolha Manual (Anexo I–V) ou Automático por CNPJ.',
      'Passo 2: informe RBT12 + receita do mês (+ folha se Anexo V ou Fator R).',
      'Passo 3: clique em “Visualizar cálculo” e leia DAS + duelo + relatório.',
      'Só via CNPJ: “Dividir faturamento” abre a segregação em 5 etapas.',
    ],
    dica: 'Passe o mouse na projeção para ver a memória de cálculo; exporte CSV/JSON/PDF com o timbrado do emitente.',
    resultado: 'Você concluiu quando vê o DAS dos dois regimes lado a lado.',
    acao: 'Abrir Simples Nacional',
  },
  {
    id: 'servicos',
    menu: 'Serviços (NBS)',
    icone: '🧰',
    trilha: 'calcular',
    promessa: 'Em 30 segundos: do serviço ao NBS correto.',
    oQueFaz: 'Classifique serviços pelo NBS de 9 dígitos, por descrição livre ou pelo CNPJ (CNAEs → NBS).',
    comoUsar: [
      'Aba Manual: digite o NBS ou descreva (“aula de inglês online”).',
      'Aba CNPJ: busque a empresa e veja 1 cartão por CNAE, com anexo e elegibilidade.',
      'Confira CST/cClassTrib, reduções, anexo da LC 214 e a trilha de auditoria.',
    ],
    dica: 'Fora da base (1.090 CNAEs + 122 vínculos NBS) vale a regra geral 000/000001 — o cartão avisa em âmbar.',
    resultado: 'Você concluiu quando vê o cartão do serviço com NBS + CST + anexo.',
    acao: 'Abrir Serviços (NBS)',
  },
  {
    id: 'cnaes',
    menu: 'Consulta de CNAEs',
    icone: '🏢',
    trilha: 'organizar',
    promessa: 'Em 20 segundos: do CNAE ao anexo do Simples.',
    oQueFaz: 'Descubra o anexo do Simples, o Fator R e o NBS vinculado a partir do CNAE.',
    comoUsar: [
      'Digite o CNAE ou parte da descrição da atividade.',
      'Veja anexo do Simples, Fator R aplicável e NBS relacionados.',
      'Use a ponte CNAE → NBS para pular direto aos serviços.',
    ],
    dica: 'Confira o anexo aqui antes do Simples por CNPJ — evita refazer o cálculo com o anexo errado.',
    resultado: 'Você concluiu quando vê o anexo + NBS vinculado ao CNAE.',
    acao: 'Abrir Consulta de CNAEs',
  },
  {
    id: 'produtos',
    menu: 'Produtos',
    icone: '📦',
    trilha: 'organizar',
    promessa: 'Em 20 segundos: seu catálogo pronto para calcular.',
    oQueFaz: 'Cadastre produtos por empresa (cliente), com filtro rápido e exports — alimenta Calculadora e Lote.',
    comoUsar: [
      'Filtre por SKU, nome ou NCM e pagine a lista.',
      'Edite ou exclua direto na linha; importe em massa pelo Lote.',
      'Exporte CSV/JSON/PDF com o timbrado do emitente.',
    ],
    dica: 'Sem empresa ativa você fica no modo visualização — defina a empresa no cabeçalho (🏢) para organizar por cliente.',
    resultado: 'Você concluiu quando encontra 1 produto pelo filtro.',
    acao: 'Abrir Produtos',
  },
  {
    id: 'lote',
    menu: 'Classificação em lote',
    icone: '📁',
    trilha: 'organizar',
    promessa: 'Em 1 minuto: centenas de produtos classificados.',
    oQueFaz: 'Classifique centenas de produtos de uma vez a partir de CSV/XLSX — com revisão linha a linha.',
    comoUsar: [
      'Na primeira vez, baixe o modelo CSV na tela.',
      'Arraste o arquivo para a área pontilhada (SKU · nome · NCM · CFOP · CST · PIS · COFINS).',
      'Confira as contagens (classificadas · regra geral · inválidas) e ajuste no seletor quando houver opções.',
      'Clique em “Salvar todos como produtos” — repetir não duplica.',
    ],
    dica: 'Linhas sem SKU ou NCM válido são ignoradas com aviso: corrija na planilha e reimporte só elas.',
    resultado: 'Você concluiu quando vê as contagens verde/âmbar/vermelha do arquivo.',
    acao: 'Abrir Classificação em lote',
  },
  {
    id: 'nfe',
    menu: 'Notas Fiscais (XML)',
    icone: '🧾',
    trilha: 'organizar',
    promessa: 'Em 1 minuto: do XML ao veredito A pagar / Saldo credor.',
    oQueFaz: 'Importe XMLs de NF-e/NFC-e e veja veredito, confronto Antigo × Novo, ranking de fornecedores e apuração assistida.',
    comoUsar: [
      'Selecione a empresa ativa e arraste 1 ou N arquivos .xml — duplicadas vão para quarentena (lista de repetidas, sem duplicar).',
      'Leia o topo executivo: veredito + base + IBS/CBS + carga + barra de cobertura.',
      'Explore as abas: Notas · Fornecedores · Produtos · NCM · Insights.',
    ],
    dica: 'Vale o crédito efetivo do XML; a estimativa via NCM é informativa. Alterne o layout Polida ↔ Clássica — a escolha fica salva.',
    resultado: 'Você concluiu quando vê o veredito no topo após importar 1 XML.',
    acao: 'Abrir Notas Fiscais (XML)',
  },
  {
    id: 'auxiliares',
    menu: 'Tabelas auxiliares',
    icone: '📚',
    trilha: 'dominar',
    promessa: 'Em 20 segundos: corrija um código sem esperar atualização.',
    oQueFaz: 'Edite as 8 listas do sistema (CST IBS/CBS, cClassTrib, NCM, CFOP, CST ICMS, CST PIS/COFINS, vínculos, CNAE).',
    comoUsar: [
      'Escolha a lista, filtre e clique em “Novo” ou edite na linha.',
      'Valide antes de salvar — a edição vale na hora para todo o cálculo.',
      'Use quando a legislação atualizar um código antes da próxima base oficial.',
    ],
    dica: 'Chegou base oficial nova? Atualize tudo de uma vez em Configurações → Atualização.',
    resultado: 'Você concluiu quando edita 1 linha e vê o cálculo refletir na hora.',
    acao: 'Abrir Tabelas auxiliares',
  },
  {
    id: 'legislacao',
    menu: 'Legislação',
    icone: '⚖️',
    trilha: 'dominar',
    promessa: 'Em 20 segundos: a lei exata, sem sair do app.',
    oQueFaz: 'Leia LC 214/2025, Decreto 12.955/2026, Res. CGIBS 6/2026 e RICMS-CE dentro do app, com links oficiais.',
    comoUsar: [
      'Abra a norma e leia no modal interno — sem sair do sistema.',
      'Use os links vindos da Consulta (#art128 etc.) para cair no artigo exato.',
      'Portais externos abrem em nova aba quando exigem certificado.',
    ],
    dica: 'Em divergência vale o texto oficial (Planalto/CGIBS/SEFAZ) — a Reforma está em transição e o app avisa nos cartões.',
    resultado: 'Você concluiu quando abre 1 artigo pelo link vindo da Consulta.',
    acao: 'Abrir Legislação',
  },
]

/** Trilha de um passo. */
export function trilhaDoPasso(id: ViewId): TrilhaTour {
  const achada = TRILHAS_TOUR.find((t) => t.passos.includes(id))
  return achada ?? TRILHAS_TOUR[0]
}

/** Índice do primeiro passo de uma trilha (para os atalhos de trilha). */
export function primeiroIndiceDaTrilha(trilha: TrilhaId): number {
  const primeiro = TRILHAS_TOUR.find((t) => t.id === trilha)?.passos[0]
  const i = PASSOS_TOUR.findIndex((p) => p.id === primeiro)
  return i < 0 ? 0 : i
}

/** Seção do menu lateral real (espelha `Layout.tsx` > NAV) — breadcrumb "onde fica". */
export function secaoDoPasso(id: ViewId): { secao: string; pos: number; de: number } {
  switch (id) {
    case 'calculadora':
      return { secao: 'Trabalho', pos: 1, de: 7 }
    case 'simples':
      return { secao: 'Trabalho', pos: 2, de: 7 }
    case 'consulta':
      return { secao: 'Trabalho', pos: 3, de: 7 }
    case 'servicos':
      return { secao: 'Trabalho', pos: 4, de: 7 }
    case 'cnaes':
      return { secao: 'Trabalho', pos: 5, de: 7 }
    case 'lote':
      return { secao: 'Trabalho', pos: 6, de: 7 }
    case 'nfe':
      return { secao: 'Trabalho', pos: 7, de: 7 }
    case 'produtos':
      return { secao: 'Dados', pos: 1, de: 2 }
    case 'auxiliares':
      return { secao: 'Dados', pos: 2, de: 2 }
    default:
      return { secao: 'Referência', pos: 1, de: 1 }
  }
}

/** Chave que marca o tour como concluído (por máquina). */
export const TOUR_KEY = 'aurum:tour-guiado-visto'

/** Versão do conteúdo do tour — bump força reexibição opcional. */
export const TOUR_VERSAO = '2.0'
