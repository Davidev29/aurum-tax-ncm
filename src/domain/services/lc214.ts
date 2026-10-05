/**
 * Aurum AI — corpus offline da LC 214/2025 (fine-tuning v3).
 *
 * Problema que resolve: a IA citava a LC 214 só por tabela (CST × cClassTrib)
 * e resumos de 1 linha em `tributarios.ts`, sem conseguir EXPLICAR um artigo
 * de forma clara e técnica nem PESQUISAR ("o que diz o art. 128?", "onde a
 * lei fala de cesta básica?").
 *
 * Garantia de disponibilidade ("ler diretamente"):
 * - Este arquivo É a fonte embarcada no bundle (Vite/Electron) — funciona
 *   100% offline, sem rede, sem depender do Planalto no momento da resposta.
 * - Cada verbete tem `link` com âncora (`lcp214.htm#art128`) para a íntegra
 *   oficial no Planalto — a IA sempre oferece o link após o resumo curado.
 * - Espelho auditável em `recursos-ia/conhecimento/lc214-artigos.json`
 *   (mesmo conteúdo, para curadoria/versionamento fora do bundle).
 *
 * Fine-tuning = template determinístico (sem LLM inventando texto legal):
 * - `explicarArtigoLC214()` segue o molde fixo: O que diz → Em linguagem
 *   clara → Leitura técnica → Quando aplica → Exemplo → Base oficial + link
 *   → Próximo passo. O modelo nunca recita a lei "literalmente" — deixa
 *   claro que é RESUMO CURADO e aponta a íntegra.
 * - Artigo fora do corpus → lista os temas cobertos + link da íntegra,
 *   nunca chute.
 *
 * Curadoria: resumos fiéis à estrutura da LC 214/2025 (reduções 60/40/30%,
 * diferimento art. 138, regimes específicos, transição 2026–2033). Para a
 * redação literal vigente, vale sempre a íntegra no Planalto (link).
 */

import { LINK_LC214 } from '@/domain/constants'

export interface ArtigoLC214 {
  /** Número do artigo ("128", "138", "261"). */
  numero: string
  titulo: string
  /** Tema curto para agrupar ("reduções", "diferimento", "transição"...). */
  tema: string
  /** Aliases de busca (sinônimos populares + termos técnicos). */
  aliases: string[]
  /** 1–2 frases: o que o artigo diz (resumo curado, não literal). */
  resumo: string
  /** Explicação em linguagem simples (para o usuário não-técnico). */
  claro: string
  /** Leitura técnica: alíquota, CST/cClassTrib, anexo, condições. */
  tecnico: string
  quandoAplica: string
  exemplo?: string
  /** Anexo oficial da LC 214 quando houver ("I", "IX", "XI"...). */
  anexo?: string | null
  /** Redução típica associada ("60% IBS/CBS", "40%", "zero"...). */
  reducao?: string | null
  link: string
}

const L = (art: string): string => `${LINK_LC214}#art${art}`

export const ARTIGOS_LC214: ArtigoLC214[] = [
  {
    numero: '4',
    titulo: 'Art. 4º — Fato gerador do IBS e da CBS',
    tema: 'conceitos base',
    aliases: ['fato gerador', 'incidencia', 'o que gera ibs cbs', 'fornecimento', 'conceito ibs cbs'],
    resumo: 'Define o fato gerador do IBS e da CBS: o fornecimento de bens e serviços em território nacional, com critérios material, temporal e espacial.',
    claro: 'É o artigo que diz QUANDO o imposto nasce: toda vez que alguém fornece um bem ou serviço no Brasil, nasce IBS + CBS. Sem fornecimento, sem imposto.',
    tecnico: 'Núcleo da hipótese de incidência (material: fornecer bens/serviços; espacial: território nacional; temporal: momento do fornecimento). Base para CST 000/cClassTrib 000001 (regra geral) quando nenhum benefício se aplica.',
    quandoAplica: 'Toda operação com bens/serviços — ponto de partida antes de checar reduções (arts. 125–146) ou diferimento (art. 138).',
    exemplo: 'Venda de uma camiseta ou prestação de uma aula: há fornecimento → há IBS/CBS (alíquota cheia, salvo benefício).',
    anexo: null,
    reducao: null,
    link: L('4'),
  },
  {
    numero: '27',
    titulo: 'Art. 27 — Não cumulatividade (créditos de IBS/CBS)',
    tema: 'créditos',
    aliases: ['nao cumulatividade', 'credito ibs cbs', 'apropriar credito', 'credito sobre compras'],
    resumo: 'Consagra a não cumulatividade plena: o contribuinte apropria crédito do IBS/CBS pago nas aquisições vinculadas à atividade.',
    claro: 'O imposto que você pagou ao COMPRAR vira crédito para abater do imposto que você deve ao VENDER. Só paga sobre o valor que você agregou.',
    tecnico: 'Crédito = IBS/CBS destacado nas entradas × vínculo com atividade tributada. Exceções (uso pessoal, isenção na saída) bloqueiam o crédito. É o motor do ranking "fornecedor que dá mais crédito" no chat de dados.',
    quandoAplica: 'Empresas no regime regular apurando IBS/CBS por fora; no Simples Híbrido, a CBS por fora usa a mesma lógica (débitos − créditos).',
    exemplo: 'Comprou insumo com R$ 100 de CBS e vendeu com R$ 150 de CBS → recolhe R$ 50.',
    anexo: null,
    reducao: null,
    link: L('27'),
  },
  {
    numero: '125',
    titulo: 'Art. 125 — Cesta básica nacional (alíquota zero)',
    tema: 'reduções',
    aliases: ['cesta basica', 'aliquota zero', 'arroz feijao', 'alimentos basicos', 'anexo i'],
    resumo: 'Zera as alíquotas de IBS/CBS para os alimentos da cesta básica nacional (Anexo I).',
    claro: 'Comida essencial da cesta básica não paga IBS nem CBS: alíquota zero de verdade.',
    tecnico: 'Alíquota zero (100% de redução) vinculada ao Anexo I. Exige NCM com vínculo CST/cClassTrib do Anexo I na base oficial — sem vínculo, vale a regra geral até reclassificar.',
    quandoAplica: 'Alimentos listados no Anexo I, destinados ao consumo humano.',
    exemplo: 'Arroz e feijão do Anexo I → IBS 0 + CBS 0 sobre a base.',
    anexo: 'I',
    reducao: 'zero (100%)',
    link: L('125'),
  },
  {
    numero: '126',
    titulo: 'Art. 126 — Profissionais e insumos da cesta (orientação)',
    tema: 'reduções',
    aliases: ['cesta basica insumos', 'produtor rural cesta'],
    resumo: 'Disciplina o alcance da cesta básica (cadeia e insumos correlatos, conforme anexos).',
    claro: 'A lei estende o favor da cesta para os elos que a viabilizam, nos limites dos anexos.',
    tecnico: 'Artigo-ponte: operacionaliza o art. 125 por anexo/NCM. A IA resolve pelo vínculo oficial (CST × cClassTrib × anexo), nunca pelo nome do alimento.',
    quandoAplica: 'Quando o NCM cita Anexo I ou remissão ao art. 126 na base legal.',
    anexo: 'I',
    reducao: 'zero (100%)',
    link: L('126'),
  },
  {
    numero: '127',
    titulo: 'Art. 127 — Profissões regulamentadas (redução de 30%)',
    tema: 'reduções',
    aliases: ['profissao regulamentada', 'reducao 30%', 'advogado contador engenheiro', 'conselho profissional', 'servicos intelectuais'],
    resumo: 'Reduz em 30% as alíquotas de IBS/CBS para serviços de profissões intelectuais, científicas, literárias ou artísticas submetidas a conselho profissional.',
    claro: 'Advogado, contador, engenheiro e profissões com conselho pagam 30% a menos de IBS/CBS — desde que o serviço exija a habilitação.',
    tecnico: 'Redução 30% IBS/CBS; condição: profissão regulamentada + serviço vinculado à habilitação. No sistema aparece como CST/cClassTrib de redução 30% + Anexo correspondente.',
    quandoAplica: 'Serviços intelectuais com conselho (OAB, CRC, CREA...). TI genérica NÃO entra aqui (regra geral).',
    exemplo: 'Honorários advocatícios → base cheia × alíquota × 0,70.',
    anexo: null,
    reducao: '30% IBS/CBS',
    link: L('127'),
  },
  {
    numero: '128',
    titulo: 'Art. 128 — Redução de 60% (rol geral)',
    tema: 'reduções',
    aliases: ['reducao 60%', 'educacao saude', 'medicamentos alimentos', 'dispositivos medicos', 'higiene insumos agropecuarios', 'cultura'],
    resumo: 'Reduz em 60% as alíquotas de IBS/CBS para o rol do artigo: educação, saúde, dispositivos médicos, medicamentos, alimentos, higiene, insumos agropecuários, cultura e outros.',
    claro: 'A lista grande dos 60%: escola, hospital, remédio, comida, fralda, semente, teatro — tudo com 60% de desconto no IBS/CBS.',
    tecnico: 'Redução 60% IBS/CBS condicionada ao enquadramento em inciso do art. 128 + anexo (II–VII, conforme o bem/serviço). Cada NCM/NBS carrega o CST/cClassTrib do inciso correspondente; sem vínculo oficial, a IA trata como hipótese a verificar.',
    quandoAplica: 'Bens/serviços de ao menos um inciso do art. 128, com comprovação (registro ANVISA para medicamentos, p. ex.).',
    exemplo: 'Medicamento do inciso → IBS 19%×0,40 + CBS 9%×0,40 sobre R$ 1.000.',
    anexo: null,
    reducao: '60% IBS/CBS',
    link: L('128'),
  },
  {
    numero: '131',
    titulo: 'Art. 131 — Dispositivos médicos (detalhe do rol)',
    tema: 'reduções',
    aliases: ['dispositivo medico', 'produtos saude', 'correlatos saude'],
    resumo: 'Especifica dispositivos médicos e correlatos dentro do rol de redução de 60%.',
    claro: 'Aparelhos e materiais de saúde listados têm 60% de desconto.',
    tecnico: 'Condição: classificação sanitária + anexo correspondente. Verificar vínculo CST/cClassTrib antes de aplicar.',
    quandoAplica: 'Dispositivos médicos registrados e listados.',
    anexo: null,
    reducao: '60% IBS/CBS',
    link: L('131'),
  },
  {
    numero: '132',
    titulo: 'Art. 132 — Medicamentos de uso essencial',
    tema: 'reduções',
    aliases: ['medicamento essencial', 'farmacia', 'anvisa'],
    resumo: 'Trata de medicamentos dentro do rol de redução (registro ANVISA ou manipulação).',
    claro: 'Remédio registrado na ANVISA (ou de farmácia de manipulação) entra nos 60%.',
    tecnico: 'Condição comprobatória: registro ANVISA válido ou manipulação. Redação atualizada pela LC 227/2026 em pontos específicos — conferir a íntegra.',
    quandoAplica: 'Medicamentos com registro/condição comprovada.',
    anexo: null,
    reducao: '60% IBS/CBS',
    link: L('132'),
  },
  {
    numero: '133',
    titulo: 'Art. 133 — Medicamentos (redução de 60%)',
    tema: 'reduções',
    aliases: ['medicamentos', 'remedios', 'anvisa manipulacao'],
    resumo: 'Redução de 60% de IBS/CBS para medicamentos registrados na ANVISA ou produzidos por farmácias de manipulação.',
    claro: 'Remédio de verdade (ANVISA ou manipulação) paga 60% a menos.',
    tecnico: 'Redução 60% IBS/CBS; comprovação sanitária obrigatória. Ver LC 227/2026 para ajustes de redação.',
    quandoAplica: 'Medicamentos registrados ou manipulados.',
    exemplo: 'Dipirona registrada → alíquota × 0,40.',
    anexo: null,
    reducao: '60% IBS/CBS',
    link: L('133'),
  },
  {
    numero: '134',
    titulo: 'Art. 134 — Produtos de higiene e limpeza',
    tema: 'reduções',
    aliases: ['higiene', 'limpeza', 'fralda sabonete', 'higiene pessoal'],
    resumo: 'Inclui produtos de higiene e limpeza essenciais no rol de redução de 60%.',
    claro: 'Sabonete, fralda e itens básicos de higiene entram nos 60%.',
    tecnico: 'Rol taxativo por anexo; o NCM decide (vínculo oficial). Sem vínculo → hipótese, não fato.',
    quandoAplica: 'Itens de higiene listados no anexo correspondente.',
    anexo: null,
    reducao: '60% IBS/CBS',
    link: L('134'),
  },
  {
    numero: '135',
    titulo: 'Art. 135 — Alimentos para consumo humano (redução de 60%)',
    tema: 'reduções',
    aliases: ['alimentos', 'comida consumo humano', 'capitulos alimentos', 'arroz carne leite'],
    resumo: 'Redução de 60% de IBS/CBS para alimentos destinados ao consumo humano (fora da cesta zero).',
    claro: 'Comida que não é cesta básica (alíquota zero) ainda tem 60% de desconto — desde que seja para gente comer.',
    tecnico: 'Redução 60% IBS/CBS; condição: destino ao consumo humano (não ração/insumo/industrial). O sistema usa os capítulos do art. 135 (02–04, 07–12, 15–22) como HIPÓTESE condicional quando não há vínculo oficial.',
    quandoAplica: 'Alimentos p/ consumo humano com capítulos 02–04, 07–12, 15–22 e sem vínculo de cesta zero.',
    exemplo: 'Queijo minas (cap. 04) sem vínculo → regra geral hoje + hipótese 60% a verificar.',
    anexo: null,
    reducao: '60% IBS/CBS',
    link: L('135'),
  },
  {
    numero: '136',
    titulo: 'Art. 136 — Insumos agropecuários',
    tema: 'reduções',
    aliases: ['insumo agropecuario', 'semente fertilizante', 'defensivo racao'],
    resumo: 'Redução de 60% para insumos agropecuários listados (sementes, fertilizantes, defensivos e correlatos).',
    claro: 'Semente, adubo e defensivo listados pagam 60% a menos.',
    tecnico: 'Rol por anexo; parte dos insumos cai ainda no diferimento condicional do Anexo IX (art. 138, §2º) — redução ≠ diferimento.',
    quandoAplica: 'Insumos listados, conforme anexo.',
    anexo: 'IX',
    reducao: '60% IBS/CBS',
    link: L('136'),
  },
  {
    numero: '137',
    titulo: 'Art. 137 — Produtos in natura (redução de 60%)',
    tema: 'reduções',
    aliases: ['in natura', 'agropecuario in natura', 'pesca extrativismo', 'produto agricola sem industrializar'],
    resumo: 'Reduz em 60% IBS/CBS sobre produtos agropecuários, aquícolas, pesqueiros, florestais e extrativistas vegetais in natura.',
    claro: 'Produto do campo/pesca/mata, sem industrializar de verdade, tem 60% de desconto.',
    tecnico: 'Redução 60% IBS/CBS; condição: estado in natura (sem industrialização relevante). Capítulos in natura disparam HIPÓTESE condicional no sistema; o fato vigente exige vínculo oficial.',
    quandoAplica: 'Produtos in natura comprovados (cadeia primária).',
    exemplo: 'Peixe fresco (cap. 03) sem vínculo → regra geral + hipótese art. 137.',
    anexo: null,
    reducao: '60% IBS/CBS',
    link: L('137'),
  },
  {
    numero: '138',
    titulo: 'Art. 138 — Diferimento (Anexo IX e §2º)',
    tema: 'diferimento',
    aliases: ['diferimento', 'anexo ix', 'cst 510 515', 'diferir imposto', 'insumos diferidos'],
    resumo: 'Disciplina o diferimento: o pagamento do imposto é adiado para etapa posterior da cadeia (Anexo IX; §2º trata do diferimento condicional com redução).',
    claro: 'Diferir = não pagar agora, pagar depois (na venda seguinte). A lei diz quais insumos podem e em que condição.',
    tecnico: 'CST 510 (diferimento puro) / 515 (diferimento com redução); cClassTribs 200038/515001 marcam o Anexo IX. §2º = diferimento CONDICIONAL (só se a operação se enquadrar). O sistema separa diferidos efetivos de condicionais.',
    quandoAplica: 'Insumos do Anexo IX com CST 510/515 e condição do §2º comprovada.',
    exemplo: 'Insumo Anexo IX com CST 515 → IBS/CBS diferidos na entrada.',
    anexo: 'IX',
    reducao: 'conforme CST (diferimento)',
    link: L('138'),
  },
  {
    numero: '139',
    titulo: 'Art. 139 — Cultura e eventos (redução de 60%)',
    tema: 'reduções',
    aliases: ['cultura', 'eventos shows', 'audiovisual jornalismo', 'producao nacional'],
    resumo: 'Redução de 60% para produções nacionais artísticas, culturais, de eventos, jornalísticas e audiovisuais.',
    claro: 'Show, teatro, cinema e jornalismo nacionais têm 60% de desconto.',
    tecnico: 'Condição: produção nacional + enquadramento no inciso. Serviços correlatos seguem NBS × CST × cClassTrib.',
    quandoAplica: 'Produções nacionais dos incisos.',
    anexo: null,
    reducao: '60% IBS/CBS',
    link: L('139'),
  },
  {
    numero: '140',
    titulo: 'Art. 140 — Transporte e logística vinculados (rol)',
    tema: 'reduções',
    aliases: ['transporte reducao', 'logistica', 'frete reducao'],
    resumo: 'Trata de reduções aplicáveis a elos de transporte/logística do rol.',
    claro: 'Fretes e transportes listados entram nas reduções do rol.',
    tecnico: 'Ver inciso e anexo correspondentes; transporte coletivo de passageiros tem artigo próprio (art. 286).',
    quandoAplica: 'Operações de transporte listadas.',
    anexo: null,
    reducao: 'conforme inciso',
    link: L('140'),
  },
  {
    numero: '144',
    titulo: 'Art. 144 — Redução de 100% (alíquota zero) — casos específicos',
    tema: 'reduções',
    aliases: ['aliquota zero', 'reducao 100%', 'isencao reforma'],
    resumo: 'Casos de alíquota zero (redução de 100%) previstos na lei.',
    claro: 'Aqui a lei zera o imposto: IBS zero + CBS zero na operação enquadrada.',
    tecnico: 'Alíquota zero ≠ isenção técnica: mantém lógica de crédito conforme o regime. Exige vínculo CST/cClassTrib de alíquota zero.',
    quandoAplica: 'Hipóteses expressas do artigo/anexo.',
    anexo: null,
    reducao: 'zero (100%)',
    link: L('144'),
  },
  {
    numero: '149',
    titulo: 'Art. 149 — Regime específico: serviços financeiros',
    tema: 'regimes específicos',
    aliases: ['servicos financeiros', 'banco regime especifico', 'credito financeiro'],
    resumo: 'Regime específico para serviços financeiros (base e ajustes próprios).',
    claro: 'Banco e financeira têm regra própria de apuração, diferente da venda comum.',
    tecnico: 'Regime específico com base ajustada; NBS do setor + CST próprios. Simulação exige parâmetros do regime.',
    quandoAplica: 'Instituições e serviços financeiros enquadrados.',
    anexo: null,
    reducao: null,
    link: L('149'),
  },
  {
    numero: '155',
    titulo: 'Art. 155 — Regime específico: saúde (planos e seguros)',
    tema: 'regimes específicos',
    aliases: ['plano saude', 'seguro saude', 'regime saude'],
    resumo: 'Regime específico para operações de saúde suplementar.',
    claro: 'Plano de saúde tem apuração própria, separada da consulta comum.',
    tecnico: 'Base e créditos conforme o regime; NBS de saúde + CST específico.',
    quandoAplica: 'Operadoras e serviços enquadrados.',
    anexo: null,
    reducao: null,
    link: L('155'),
  },
  {
    numero: '157',
    titulo: 'Art. 157 — Reabilitação urbana (base reduzida)',
    tema: 'regimes específicos',
    aliases: ['reabilitacao urbana', 'imovel reabilitado', 'habite-se 5 anos'],
    resumo: 'Base do regime de reabilitação urbana (ponte para a redução de 80% do art. 158).',
    claro: 'Imóvel em área reabilitada pela prefeitura tem caminho para 80% de desconto no aluguel.',
    tecnico: 'Condições: zona delimitada por lei municipal/distrital + prazo de 5 anos do habite-se. Ver art. 158.',
    quandoAplica: 'Locações em zonas reabilitadas delimitadas.',
    anexo: null,
    reducao: null,
    link: L('157'),
  },
  {
    numero: '158',
    titulo: 'Art. 158 — Reabilitação urbana (redução de 80%)',
    tema: 'reduções',
    aliases: ['reducao 80%', 'reabilitacao urbana 80', 'locacao imovel reabilitado'],
    resumo: 'Redução de 80% de IBS/CBS para locação de imóveis em zonas reabilitadas, por 5 anos do habite-se.',
    claro: 'Aluguel em área reabilitada: 80% de desconto por 5 anos.',
    tecnico: 'Redução 80%; condições cumulativas: projeto delimitado + habite-se + prazo. Sem lei municipal delimitando, não aplica.',
    quandoAplica: 'Locação em zona reabilitada, dentro do prazo.',
    anexo: null,
    reducao: '80% IBS/CBS',
    link: L('158'),
  },
  {
    numero: '163',
    titulo: 'Art. 163 — Locação de bens móveis e imóveis (regras)',
    tema: 'regimes específicos',
    aliases: ['locacao', 'aluguel regra', 'bens imoveis locacao'],
    resumo: 'Regras de locação de bens no IBS/CBS (ponte para reduções dos arts. 158/261).',
    claro: 'Aluguel tem regra própria — e em dois casos tem desconto grande (80% reabilitação, 70% imóveis).',
    tecnico: 'Artigo-ponte: o percentual aplicável está nos arts. 158 (80%) e 261 (50%/70%).',
    quandoAplica: 'Locações em geral; desconto só nos casos expressos.',
    anexo: null,
    reducao: null,
    link: L('163'),
  },
  {
    numero: '168',
    titulo: 'Art. 168 — Cashback e devolução personalizada',
    tema: 'conceitos base',
    aliases: ['cashback', 'devolucao imposto', 'imposto devolvido baixa renda'],
    resumo: 'Prevê mecanismos de devolução personalizada (cashback) do IBS/CBS a pessoas físicas de baixa renda.',
    claro: 'Parte do imposto volta para quem é de baixa renda (programa de devolução).',
    tecnico: 'Operacionalização por regulamento; não altera a apuração do vendedor (o débito/crédito segue normal).',
    quandoAplica: 'Consumidores elegíveis, conforme regulamento.',
    anexo: null,
    reducao: null,
    link: L('168'),
  },
  {
    numero: '213',
    titulo: 'Art. 213 — Comitê Gestor do IBS',
    tema: 'administração',
    aliases: ['comite gestor', 'cgibs', 'quem administra ibs'],
    resumo: 'Institui o Comitê Gestor do IBS (entes federativos) e suas competências.',
    claro: 'O "síndico" do IBS: comitê de estados e municípios que administra o imposto.',
    tecnico: 'Fonte da Res. CGIBS nº 6/2026 (regulamento do IBS). Atos do comitê detalham transição e regimes.',
    quandoAplica: 'Interpretação de regulamentos do IBS.',
    anexo: null,
    reducao: null,
    link: L('213'),
  },
  {
    numero: '214',
    titulo: 'Art. 214 — Regulamentação do IBS/CBS',
    tema: 'administração',
    aliases: ['regulamentacao', 'decreto cbs', 'resolucao cgibs', 'quem regulamenta'],
    resumo: 'Distribui a competência regulamentar (CGIBS para IBS, Executivo federal para CBS).',
    claro: 'Quem detalha a lei: comitê (IBS) e governo federal (CBS, Decreto 12.955/2026).',
    tecnico: 'Base dos atos infralegais citados no app (Res. CGIBS 6/2026, Decreto 12.955/2026).',
    quandoAplica: 'Quando um detalhe operacional não está na lei, buscar o regulamento.',
    anexo: null,
    reducao: null,
    link: L('214'),
  },
  {
    numero: '261',
    titulo: 'Art. 261 — Bens imóveis (redução de 50% / 70%)',
    tema: 'reduções',
    aliases: ['bens imoveis', 'reducao 50% 70%', 'venda imovel locacao imovel', 'incorporacao'],
    resumo: 'Redução de 50% nas operações com bens imóveis e de 70% na locação, cessão onerosa e arrendamento.',
    claro: 'Vender imóvel: 50% de desconto. Alugar imóvel: 70% de desconto.',
    tecnico: 'Redução 50% (operações) / 70% (locação/cessão/arrendamento) sobre IBS/CBS. Regime de bens imóveis com base ajustada.',
    quandoAplica: 'Operações e locações de bens imóveis enquadradas.',
    exemplo: 'Aluguel de R$ 10.000 → base cheia × alíquota × 0,30.',
    anexo: null,
    reducao: '50% / 70% IBS/CBS',
    link: L('261'),
  },
  {
    numero: '275',
    titulo: 'Art. 275 — Bares e restaurantes (redução de 40%)',
    tema: 'reduções',
    aliases: ['bar restaurante', 'reducao 40%', 'alimentacao fora do lar', 'lanchonete'],
    resumo: 'Redução de 40% de IBS/CBS para bares e restaurantes.',
    claro: 'Bar e restaurante pagam 40% a menos de IBS/CBS.',
    tecnico: 'Redução 40% IBS/CBS; NBS do serviço + CST correspondente. Distinto do alimento industrializado (art. 135).',
    quandoAplica: 'Serviços de bares/restaurantes.',
    anexo: null,
    reducao: '40% IBS/CBS',
    link: L('275'),
  },
  {
    numero: '281',
    titulo: 'Art. 281 — Hotelaria e parques (redução de 40%)',
    tema: 'reduções',
    aliases: ['hotelaria', 'parque diversao tematico', 'hospedagem reducao'],
    resumo: 'Redução de 40% para hotelaria, parques de diversão e parques temáticos.',
    claro: 'Hotel e parque: 40% de desconto.',
    tecnico: 'Redução 40% IBS/CBS sobre os serviços enquadrados.',
    quandoAplica: 'Hospedagem e parques enquadrados.',
    anexo: null,
    reducao: '40% IBS/CBS',
    link: L('281'),
  },
  {
    numero: '286',
    titulo: 'Art. 286 — Transporte coletivo (redução de 40%)',
    tema: 'reduções',
    aliases: ['transporte coletivo', 'onibus interestadual', 'transporte passageiros reducao'],
    resumo: 'Redução de 40% para transporte coletivo rodoviário, ferroviário e hidroviário intermunicipal e interestadual.',
    claro: 'Ônibus/van/trem/barco entre cidades: 40% de desconto.',
    tecnico: 'Redução 40% IBS/CBS; escopo: coletivo intermunicipal/interestadual de passageiros.',
    quandoAplica: 'Transporte coletivo intermunicipal/interestadual.',
    anexo: null,
    reducao: '40% IBS/CBS',
    link: L('286'),
  },
  {
    numero: '287',
    titulo: 'Art. 287 — Transporte aéreo regional (redução de 40%)',
    tema: 'reduções',
    aliases: ['transporte aereo regional', 'voo regional', 'carga aerea regional'],
    resumo: 'Redução de 40% para transporte aéreo regional coletivo (passageiros ou carga).',
    claro: 'Voo regional (passageiro ou carga): 40% de desconto.',
    tecnico: 'Redução 40% IBS/CBS; condição: caráter regional/coletivo.',
    quandoAplica: 'Aéreo regional coletivo.',
    anexo: null,
    reducao: '40% IBS/CBS',
    link: L('287'),
  },
  {
    numero: '289',
    titulo: 'Art. 289 — Agências de turismo (redução de 40%)',
    tema: 'reduções',
    aliases: ['agencia turismo', 'pacote turistico', 'turismo reducao'],
    resumo: 'Redução de 40% para agências de turismo.',
    claro: 'Agência de viagem: 40% de desconto.',
    tecnico: 'Redução 40% IBS/CBS sobre os serviços da agência.',
    quandoAplica: 'Agências de turismo.',
    anexo: null,
    reducao: '40% IBS/CBS',
    link: L('289'),
  },
  {
    numero: '308',
    titulo: 'Art. 308 — Prouni (IBS −60% / CBS −100%)',
    tema: 'reduções',
    aliases: ['prouni', 'bolsa educacao', 'cbs zero prouni'],
    resumo: 'Serviços de educação do Prouni: redução de 60% do IBS e alíquota zero da CBS.',
    claro: 'Faculdade do Prouni: IBS com 60% de desconto e CBS zerada.',
    tecnico: 'Redução mista (IBS −60%, CBS −100%); cClassTrib misto. É o caso "misto" do sistema (IBS ≠ CBS).',
    quandoAplica: 'Serviços educacionais vinculados ao Prouni.',
    anexo: null,
    reducao: 'IBS 60% / CBS 100%',
    link: L('308'),
  },
  {
    numero: '391',
    titulo: 'Art. 391 — Transição: convivência de regimes (2026–2033)',
    tema: 'transição',
    aliases: ['transicao', '2026 2033', 'convivencia icms ibs', 'teste 2026', 'cronograma reforma'],
    resumo: 'Disciplina a transição 2026–2033, com convivência entre tributos antigos (ICMS/ISS/PIS-Cofins) e IBS/CBS e recolhimento em percentuais progressivos.',
    claro: 'A troca não é de um dia para o outro: de 2026 a 2033 os dois sistemas convivem, com o novo subindo aos poucos.',
    tecnico: 'Fases: 2026 (teste, alíquotas simbólicas), 2027–2028 (CBS plena + IBS parcial), 2029–2032 (redução progressiva dos antigos), 2033 (plena). Escrituração e vigência de NCM/cClassTrib variam por ano — o app alerta "transição 2026–2033".',
    quandoAplica: 'Qualquer planejamento 2026–2033 e leitura de vigência.',
    exemplo: 'Em 2026 o destaque é teste; o cálculo do app usa a regra vigente + alerta de transição.',
    anexo: null,
    reducao: null,
    link: L('391'),
  },
]

/** Temas cobertos (para orientação quando não há match). */
export const TEMAS_LC214: string[] = [
  'conceitos base',
  'créditos',
  'reduções',
  'diferimento',
  'regimes específicos',
  'administração',
  'transição',
]

function normSimples(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Extrai o número do artigo citado ("art. 128", "artigo 137", "art138").
 * Retorna só os dígitos ou null.
 */
export function extrairNumeroArtigoLC214(texto: string): string | null {
  const t = String(texto ?? '')
  const m = t.match(/art(?:igo)?\.?\s*(\d{1,3})\s*(?:[-–—]\s*[A-Z])?/i)
  if (m) return m[1].replace(/^0+/, '') || m[1]
  return null
}

/** Busca exata por número ("128" ou 128). */
export function buscarArtigoLC214(numero: string | number): ArtigoLC214 | null {
  const n = String(numero ?? '').replace(/\D+/g, '').replace(/^0+/, '')
  if (!n) return null
  return ARTIGOS_LC214.find((a) => a.numero === n) ?? null
}

export interface ResultadoPesquisaLC214 {
  artigo: ArtigoLC214
  score: number
  motivos: string[]
}

/**
 * Pesquisa textual no corpus (determinística, offline).
 * Score = overlaps ponderados (título 3, aliases 3, tema 1, resumo/técnico 1).
 */
export function pesquisarLC214(termo: string, limite = 3): ResultadoPesquisaLC214[] {
  const n = ` ${normSimples(termo)} `
  if (!n.trim()) return []
  const toks = n.split(/\s+/).map((t) => t.replace(/\W+/g, '')).filter((t) => t.length >= 3)
  if (!toks.length) return []
  const out: ResultadoPesquisaLC214[] = []
  for (const a of ARTIGOS_LC214) {
    let score = 0
    const motivos: string[] = []
    const tituloN = normSimples(a.titulo)
    const temaN = normSimples(a.tema)
    const aliasN = a.aliases.map(normSimples).join(' | ')
    const corpoN = normSimples(`${a.resumo} ${a.tecnico} ${a.quandoAplica}`)
    for (const t of toks) {
      if (tituloN.includes(t)) { score += 3; motivos.push(`título:${t}`) }
      if (aliasN.includes(t)) { score += 3; motivos.push(`tema:${t}`) }
      if (temaN.includes(t)) { score += 1; motivos.push(`grupo:${t}`) }
      if (corpoN.includes(t)) { score += 1; motivos.push(`texto:${t}`) }
    }
    // Número citado junto ("128" em "artigo 128 sobre saúde") ancora forte.
    const num = extrairNumeroArtigoLC214(termo)
    if (num && num === a.numero) { score += 10; motivos.push('artigo citado') }
    if (score > 0) out.push({ artigo: a, score, motivos })
  }
  out.sort((x, y) => y.score - x.score || Number(x.artigo.numero) - Number(y.artigo.numero))
  return out.slice(0, Math.max(1, Math.min(5, limite)))
}

/**
 * Disponibilidade do corpus (para status/debug e para a IA citar).
 * Sempre offline: embarcado no bundle, sem fetch.
 */
export function disponibilidadeLC214(): {
  offline: boolean
  totalArtigos: number
  temas: string[]
  fonteOficial: string
  espelhoCuradoria: string
  comoAtualizar: string
} {
  return {
    offline: true,
    totalArtigos: ARTIGOS_LC214.length,
    temas: TEMAS_LC214,
    fonteOficial: LINK_LC214,
    espelhoCuradoria: 'recursos-ia/conhecimento/lc214-artigos.json',
    comoAtualizar: 'Curadoria em src/domain/services/lc214.ts (fonte do bundle) + espelho JSON; a íntegra vigente está sempre no Planalto.',
  }
}

/**
 * Texto determinístico do artigo no molde fine-tuning v3:
 * O que diz → Em linguagem clara → Leitura técnica → Quando aplica →
 * Exemplo → Base oficial + link → Próximo passo.
 */
export function textoArtigoLC214(a: ArtigoLC214): string {
  return (
    `**${a.titulo}**\n` +
    `${a.resumo}\n\n` +
    `**Em linguagem clara:** ${a.claro}\n\n` +
    `**Leitura técnica:** ${a.tecnico}\n\n` +
    `**Quando aplica:** ${a.quandoAplica}` +
    (a.exemplo ? `\n**Exemplo:** ${a.exemplo}` : '') +
    (a.reducao ? `\n**Efeito:** ${a.reducao}` : '') +
    (a.anexo ? ` · **Anexo ${a.anexo} da LC 214/2025**` : '') +
    `\n\n**Base oficial:** resumo curado da LC 214/2025 — a redação literal vigente está na íntegra: ${a.link}` +
    `\n\n**Próximo passo:** quer que eu cruze este artigo com um NCM/NBS seu, simule o IBS/CBS, ou explique outro artigo?`
  )
}

/**
 * Resolve "explique o art. X" / "o que diz a lei sobre Y" em texto pronto.
 * Nunca inventa: sem match, orienta com temas + íntegra.
 */
export function explicarArtigoLC214(entrada: string | number): string {
  const num = typeof entrada === 'number' ? String(entrada) : (extrairNumeroArtigoLC214(String(entrada)) ?? String(entrada ?? '').trim())
  const direto = buscarArtigoLC214(num)
  if (direto) return textoArtigoLC214(direto)
  if (typeof entrada === 'string') {
    const achados = pesquisarLC214(entrada, 3)
    if (achados.length) {
      const principal = achados[0].artigo
      const outros = achados.slice(1).map((r) => `• Art. ${r.artigo.numero} — ${r.artigo.titulo.replace(/^Art\. \d+º? — /, '')}`).join('\n')
      return (
        `${textoArtigoLC214(principal)}` +
        (outros ? `\n\n**Também relacionado:**\n${outros}` : '')
      )
    }
  }
  return (
    `Não encontrei esse ponto no meu resumo curado da LC 214/2025 (cobertura atual: ${ARTIGOS_LC214.length} artigos-guia em ${TEMAS_LC214.join(', ')}).\n\n` +
    `Me diga o número ("explica o art. 128") ou o tema ("onde a lei fala de cesta básica?") que eu pesquiso no corpus offline. ` +
    `Para a redação literal vigente, a íntegra oficial está aqui: ${LINK_LC214}`
  )
}
