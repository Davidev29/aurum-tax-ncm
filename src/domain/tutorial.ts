/**
 * Tour guiado — conteúdo do onboarding pós-instalação.
 *
 * Um passo por menu (10 views). Cada passo explica:
 * - o que o menu faz
 * - como usar (3-5 ações)
 * - dica prática
 *
 * 100% local, sem rede. Textos em linguagem de usuário.
 */
import type { ViewId } from '@/store/ui'

export interface PassoTour {
  id: ViewId
  /** Rótulo do menu na sidebar. */
  menu: string
  icone: string
  /** O que este menu faz (1-2 frases). */
  oQueFaz: string
  /** Como usar — passo a passo curto. */
  comoUsar: string[]
  /** Dica prática / atalho. */
  dica: string
  /**
   * Texto do antigo botão "Abrir …" (removido da UI — o tour agora é
   * 100% informativo com quadro animado; mantido só p/ contrato/testes).
   * @deprecated não renderizar; o tour não navega mais sozinho.
   */
  acao: string
}

export const PASSOS_TOUR: PassoTour[] = [
  {
    id: 'calculadora',
    menu: 'Calculadora',
    icone: '🧮',
    oQueFaz: 'Simule IBS + CBS de uma cesta de produtos em tempo real, com carga efetiva e alíquotas de referência editáveis.',
    comoUsar: [
      'Busque um produto salvo por SKU, nome ou NCM — ou clique em “NCM manual”.',
      'Ajuste quantidade e valor unitário direto na lista.',
      'Confira o Resumo: base · IBS (R$) · CBS (R$) · total · carga efetiva.',
    ],
    dica: 'As alíquotas de referência (padrão IBS 19% + CBS 9%) valem para todo o sistema. A redução é congelada no momento em que o item entra na cesta.',
    acao: 'Abrir Calculadora',
  },
  {
    id: 'simples',
    menu: 'Simples Nacional',
    icone: '🧾',
    oQueFaz: 'Calcule o DAS por Anexo I–V com Reforma (CBS/IBS), Fator R, sublimite e o duelo Convencional × Híbrido — mais o Relatório Analítico e Inteligente.',
    comoUsar: [
      'Passo 1: escolha Manual (Anexo I–V) ou Automático por CNPJ (1 CNAE).',
      'Passo 2: informe RBT12 + receita do mês (+ folha se Anexo V/Fator R).',
      'Passo 3: clique em “Visualizar cálculo” — DAS + repartição + Fator R + sublimite + duelo + relatório.',
      'Só via CNPJ: “Dividir faturamento” abre o wizard de segregação em 5 etapas.',
    ],
    dica: 'Passe o mouse sobre os meses da projeção para ver a memória de cálculo. Exporte CSV/JSON/PDF com o timbrado do emitente.',
    acao: 'Abrir Simples Nacional',
  },
  {
    id: 'consulta',
    menu: 'Consulta NCM',
    icone: '🔍',
    oQueFaz: 'Descubra CST, cClassTrib, reduções, anexo oficial e base legal de qualquer NCM de 8 dígitos.',
    comoUsar: [
      'Digite o NCM com ou sem ponto (ex.: 02011000) ou o nome do produto.',
      'Clique em Classificar e leia um card por classificação encontrada.',
      'Ajuste o simulador e abra a lei no artigo exato pelo deep-link.',
    ],
    dica: 'Sem vínculo exato o sistema tenta a herança por família (SH6 ≥ 60%, SH4 ≥ 75%, capítulo ≥ 95%) com carimbo de confiança — ou aplica a regra geral em âmbar.',
    acao: 'Abrir Consulta NCM',
  },
  {
    id: 'servicos',
    menu: 'Serviços (NBS)',
    icone: '🧰',
    oQueFaz: 'Classifique serviços por código NBS de 9 dígitos, por descrição livre ou pelo CNPJ (CNAEs → NBS).',
    comoUsar: [
      'Aba manual: digite o NBS ou descreva (“aula de inglês online”).',
      'Aba CNPJ: busque as atividades e veja 1 cartão por CNAE com anexo e elegibilidade.',
      'Confira CST/cClassTrib, reduções, anexo da LC 214 e a trilha de auditoria.',
    ],
    dica: 'Fora da base (1.090 CNAEs + 122 vínculos NBS), vale a regra geral 000/000001 — o cartão avisa.',
    acao: 'Abrir Serviços (NBS)',
  },
  {
    id: 'cnaes',
    menu: 'Consulta de CNAEs',
    icone: '🏢',
    oQueFaz: 'Do CNAE para a regra do Simples + NBS vinculado e o benefício da Reforma (referência anual).',
    comoUsar: [
      'Digite o CNAE ou parte da descrição da atividade.',
      'Veja anexo do Simples, Fator R aplicável e NBS relacionados.',
      'Use a ponte CNAE → NBS para pular direto aos serviços.',
    ],
    dica: 'Ideal antes do Simples por CNPJ: confirme o anexo e a elegibilidade antes de calcular o DAS.',
    acao: 'Abrir Consulta de CNAEs',
  },
  {
    id: 'lote',
    menu: 'Classificação em lote',
    icone: '📁',
    oQueFaz: 'Classifique centenas de produtos de uma vez a partir de CSV/XLSX — com revisão linha a linha.',
    comoUsar: [
      'Na primeira vez, baixe o modelo CSV na tela.',
      'Arraste o arquivo para a área pontilhada (COD/SKU · NOME · NCM · CFOP · CST · PIS · COFINS).',
      'Confira as pills (classificadas · regra geral · múltiplas · inválidos) e troque no <select> quando houver N opções.',
      'Clique em “Salvar todos como produtos” (idempotente — repetir não duplica).',
    ],
    dica: 'Linhas sem SKU/NCM válido são ignoradas com aviso — corrija na planilha e reimporte.',
    acao: 'Abrir Classificação em lote',
  },
  {
    id: 'nfe',
    menu: 'Notas Fiscais (XML)',
    icone: '🧾',
    oQueFaz: 'Importe XMLs de NF-e/NFC-e e veja veredito, confronto Antigo × Novo, ranking de fornecedores e apuração assistida.',
    comoUsar: [
      'Selecione a empresa ativa e arraste 1 ou N arquivos .xml (duplicadas vão para quarentena, sem duplicar).',
      'Leia o hero executivo: veredito (A pagar / Saldo credor / Zerado) + base + IBS+CBS + carga + barra de cobertura.',
      'Explore as 5 abas: Notas · Fornecedores · Produtos · NCM · Insights — confira Naturezas da operação e o selo CEST/ST.',
    ],
    dica: 'Vale o crédito efetivo do XML; a estimativa via NCM é informativa. Alterne o layout Polida ↔ Clássica quando quiser — a escolha fica salva.',
    acao: 'Abrir Notas Fiscais (XML)',
  },
  {
    id: 'produtos',
    menu: 'Produtos',
    icone: '📦',
    oQueFaz: 'Cadastro de produtos vinculado à empresa ativa, com filtro rápido e exports — alimenta Calculadora e Lote.',
    comoUsar: [
      'Filtre por SKU, nome ou NCM e pagine a lista.',
      'Edite ou exclua direto na linha; importe em massa pelo Lote.',
      'Exporte CSV/JSON/PDF com o timbrado.',
    ],
    dica: 'Sem empresa ativa você fica no modo visualização. Defina a empresa no cabeçalho (🏢) para organizar por cliente.',
    acao: 'Abrir Produtos',
  },
  {
    id: 'auxiliares',
    menu: 'Tabelas auxiliares',
    icone: '📚',
    oQueFaz: 'As 8 listas editáveis do sistema (CST IBS/CBS, cClassTrib, NCM, CFOP, CST ICMS, CST PIS/COFINS, vínculo NCM×Classificação, CNAE).',
    comoUsar: [
      'Escolha a lista, filtre e clique em “Novo” ou edite na linha.',
      'Valide antes de salvar — a edição vale na hora para todo o cálculo.',
      'Use quando a legislação atualizar um código antes da próxima base oficial.',
    ],
    dica: 'Mudou a base oficial? A atualização do programa (Configurações → Atualização) renova tudo de uma vez.',
    acao: 'Abrir Tabelas auxiliares',
  },
  {
    id: 'legislacao',
    menu: 'Legislação',
    icone: '⚖️',
    oQueFaz: 'LC 214/2025, Decreto 12.955/2026, Res. CGIBS 6/2026 e RICMS-CE com leitura dentro do app e links oficiais.',
    comoUsar: [
      'Abra a norma e leia no modal interno — sem sair do sistema.',
      'Use os deep-links (#art128 etc.) vindos da Consulta para cair no artigo exato.',
      'Portais externos abrem em nova aba quando exigem certificado.',
    ],
    dica: 'Em divergência, vale o texto oficial (Planalto/CGIBS/SEFAZ) — a Reforma está em transição e o app avisa isso nos cartões.',
    acao: 'Abrir Legislação',
  },
]

/** Chave que marca o tour como concluído (por máquina). */
export const TOUR_KEY = 'aurum:tour-guiado-visto'

/** Versão do conteúdo do tour — bump força reexibição opcional. */
export const TOUR_VERSAO = '1.0'
