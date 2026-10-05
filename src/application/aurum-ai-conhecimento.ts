/**
 * Aurum AI — conhecimento simples do sistema (respostas determinísticas).
 *
 * Fine-tuning v2: a IA pode responder "coisas diversas desde que simples".
 * Este arquivo é a ÚNICA fonte para a intenção `conceito`: cada verbete tem
 * resumo curto, onde ver no sistema e exemplo. Nada aqui calcula, nada
 * inventa número — valores só via motor determinístico.
 *
 * Se o termo não está aqui → não é conceito simples do sistema → o
 * orquestrador responde com orientação/recusa, nunca com chute.
 */

export interface VerbeteConceito {
  chave: string;
  titulo: string;
  aliases: string[];
  resumo: string;
  ondeVer: string;
  exemplo?: string;
}

export const CONCEITOS_AURUM_AI: VerbeteConceito[] = [
  {
    chave: 'ibs',
    titulo: 'IBS — Imposto sobre Bens e Serviços',
    aliases: ['ibs', 'imposto sobre bens', 'imposto bens servicos'],
    resumo:
      'O IBS substitui ICMS e ISS na Reforma (LC 214/2025). É calculado sobre a base cheia da operação, com alíquota de referência reduzida conforme o enquadramento (CST × cClassTrib) de cada NCM/NBS.',
    ondeVer: 'Calculadora Tributária → adicione um NCM e veja IBS por item.',
  },
  {
    chave: 'cbs',
    titulo: 'CBS — Contribuição sobre Bens e Serviços',
    aliases: ['cbs', 'contribuicao sobre bens'],
    resumo:
      'A CBS substitui PIS/Cofins na Reforma (LC 214/2025). Segue a mesma lógica do IBS: base cheia × alíquota de referência com reduções do enquadramento. No Simples Híbrido ela é apurada por fora (débitos menos créditos).',
    ondeVer: 'Calculadora Tributária ou Simples Nacional → regime Híbrido.',
  },
  {
    chave: 'ncm',
    titulo: 'NCM — Nomenclatura Comum do Mercosul',
    aliases: ['ncm', 'nomenclatura'],
    resumo:
      'Código de 8 dígitos que identifica mercadorias. No sistema, cada NCM carrega CST + cClassTrib + reduções vigentes + vigência. A Aurum AI classifica pela descrição e o resolvedor oficial valida.',
    ondeVer: 'Consulta NCM → digite produto ou código.',
    exemplo: 'Ex.: "tem algum ncm de banana?"',
  },
  {
    chave: 'nbs',
    titulo: 'NBS — Nomenclatura Brasileira de Serviços',
    aliases: ['nbs', 'nomenclatura de servicos'],
    resumo:
      'Código de 9 dígitos para serviços, com CST + cClassTrib próprios (LC 214/2025). Dá para buscar por nome do serviço ou puxar CNAEs via CNPJ.',
    ondeVer: 'Serviços (NBS) → busca manual ou por CNPJ.',
  },
  {
    chave: 'cst',
    titulo: 'CST — Código de Situação Tributária',
    aliases: ['cst'],
    resumo:
      'Indica a situação do item na Reforma (ex.: 000 tributação integral, 200 com redução, 510/515 diferimento). Sempre anda junto do cClassTrib.',
    ondeVer: 'Ficha do NCM/NBS ou Tabelas auxiliares.',
  },
  {
    chave: 'cclasstrib',
    titulo: 'cClassTrib — Classificação Tributária',
    aliases: ['cclasstrib', 'cclasstrib', 'classificacao tributaria', 'class trib'],
    resumo:
      'Código que liga CST × benefício × anexo da LC 214/2025 (ex.: 000001 regra geral). Define a redução de IBS/CBS aplicada no cálculo.',
    ondeVer: 'Ficha do NCM/NBS → linha CST · cClassTrib.',
  },
  {
    chave: 'fator_r',
    titulo: 'Fator R — Folha ÷ RBT12 (limite 28%)',
    aliases: ['fator r', 'fatorr', 'fator-r'],
    resumo:
      'Fator R = Folha dos últimos 12 meses ÷ RBT12. Se ≥ 28%, serviços vão para o Anexo III (mais barato); se < 28%, caem no Anexo V. O sistema mostra o gap de folha e o pró-labore mensal que falta.',
    ondeVer: 'Simples Nacional → card Fator R.',
    exemplo: 'Ex.: "meu DAS no Anexo III com RBT12 500 mil e receita 40 mil"',
  },
  {
    chave: 'anexo_iii_v',
    titulo: 'Anexo III × Anexo V (serviços)',
    aliases: ['anexo iii', 'anexo v', 'anexo 3', 'anexo 5', 'iii ou v', 'iii x v'],
    resumo:
      'Anexo III é para serviços com folha relevante (Fator R ≥ 28%) e tem alíquota menor; Anexo V é para serviços sem folha suficiente e é mais caro. A matriz do relatório mostra os 4 cenários (III/V × Convencional/Híbrido) e o veredito de menor carga.',
    ondeVer: 'Simples Nacional → relatório analítico (matriz III×V).',
  },
  {
    chave: 'das',
    titulo: 'DAS — guia do Simples Nacional',
    aliases: ['das', 'guia simples', 'documento de arrecadacao'],
    resumo:
      'Guia única do Simples (LC 123/2006). Alíquota efetiva = (RBT12 × nominal − dedução) ÷ RBT12, aplicada sobre a receita do mês. No regime convencional a CBS vem dentro; no híbrido ela sai e é apurada por fora.',
    ondeVer: 'Simples Nacional → informe anexo + RBT12 + receita.',
  },
  {
    chave: 'sublimite',
    titulo: 'Sublimite — R$ 3,6 milhões',
    aliases: ['sublimite', 'sub-limite', '3,6'],
    resumo:
      'Acima de R$ 3,6 mi (RBT12 ou RBA), ICMS/ISS/IBS passam a regras próprias por faixa. O motor trata os 4 cenários automaticamente e exibe a regra aplicada no relatório.',
    ondeVer: 'Simples Nacional → linha "regra do DAS".',
  },
  {
    chave: 'hibrido',
    titulo: 'Regime Híbrido × Convencional',
    aliases: ['hibrido', 'híbrido', 'convencional'],
    resumo:
      'Convencional = DAS com CBS dentro (guia única). Híbrido = DAS reduzido (sem CBS) + CBS por fora (débitos sobre receita menos créditos sobre despesas). Compensa quando os créditos são grandes; senão, o convencional vence.',
    ondeVer: 'Simples Nacional → duelo Conv × Híb + memória do híbrido.',
  },
  {
    chave: 'relatorio',
    titulo: 'Relatórios do sistema',
    aliases: ['relatorio', 'relatório', 'exportar', 'pdf', 'csv'],
    resumo:
      'Cada módulo exporta seus dados reais: Simples gera analítico (PDF/JSON/CSV), Notas Fiscais gera apuração, Produtos e Lote exportam CSV/JSON/PDF. No chat eu gero relatório da conversa ou do cálculo em PDF (timbrado), CSV, JSON ou TXT.',
    ondeVer: 'Peça "gera um relatório dessa conversa" e escolha o formato.',
  },
  {
    chave: 'simples',
    titulo: 'Simples Nacional no sistema',
    aliases: ['simples', 'simples nacional'],
    resumo:
      'Cobre Anexos I–V com Reforma (Convencional × Híbrido), Fator R, sublimite 3,6M e repartição por tributo. Você informa anexo (ou via CNPJ/CNAE), RBT12, receita e folha; o motor calcula o resto.',
    ondeVer: 'Simples Nacional → simule e exporte o analítico.',
  },
  {
    chave: 'lc116',
    titulo: 'LC 116/2003 — lista de serviços (ISS)',
    aliases: ['lc 116', 'lc116', 'lista de servicos', 'iss'],
    resumo:
      'A LC 116 lista os serviços tributados pelo ISS municipal — o item 1 cobre informática (análise, programação, licenciamento, suporte, processamento de dados). No chat, "programação de computadores" cai na regra geral do IBS/CBS (sem NBS com benefício) e o CNAE (6201–6209) decide o Anexo do Simples via Fator R.',
    ondeVer: 'Serviços (NBS) → busque o serviço ou consulte pelo CNPJ.',
    exemplo: 'Ex.: "qual o NBS para programação de computadores?"',
  },
  {
    chave: 'cnpj',
    titulo: 'Consulta por CNPJ no sistema',
    aliases: ['cnpj', 'consultar cnpj', 'atividades do cnpj'],
    resumo:
      'Diga o CNPJ com ou sem formatação ("Quais atividades o CNPJ 53.795.990/0001-68 tem?") que busco na BrasilAPI e listo CNAEs + Anexo do Simples + Fator R + NBS/hipóteses. Depois posso simular o DAS, comparar convencional × híbrido ou salvar como cliente do emissor.',
    ondeVer: 'Serviços (NBS) → consulta por CNPJ, ou direto no chat.',
  },
];

function normSimples(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Encontra o verbete de conceito para a pergunta (ou null se não é conceito simples). */
export function encontrarConceito(pergunta: string): VerbeteConceito | null {
  const n = ` ${normSimples(pergunta)} `;
  let melhor: VerbeteConceito | null = null;
  let melhorScore = 0;
  for (const v of CONCEITOS_AURUM_AI) {
    let score = 0;
    for (const a of v.aliases) {
      const al = normSimples(a);
      if (!al) continue;
      if (n.includes(` ${al} `) || n.includes(` ${al},`) || n.includes(`(${al}`)) score += al.length >= 5 ? 3 : 2;
      else if (n.includes(al)) score += 1;
    }
    if (score > melhorScore) {
      melhorScore = score;
      melhor = v;
    }
  }
  return melhorScore > 0 ? melhor : null;
}

/** Texto determinístico do conceito (sem cálculo, sem número inventado). */
export function textoConceito(v: VerbeteConceito): string {
  return (
    `**${v.titulo}**\n${v.resumo}\n\n` +
    `Onde ver: ${v.ondeVer}` +
    (v.exemplo ? `\n${v.exemplo}` : '')
  );
}
