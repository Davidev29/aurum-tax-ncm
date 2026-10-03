/**
 * Classificador por descrição livre de SERVIÇOS — etapa 1 (pura, sem IndexedDB).
 *
 * Espelho de `./classificador-descricao` para bens: transforma
 * "aula de inglês online" em sinais auditáveis. A etapa 2
 * (`src/application/classificacao-inteligente-servicos.ts`) ancora cada
 * candidato no NBS vigente + vínculo oficial — **nunca inventa NBS**.
 */
import { normalizarBusca, tokenizarBusca } from './busca-texto'
import { SINONIMOS_SERVICOS, expandirSinonimoServico } from './vocabulario-servicos'
import { expandirSinonimoFiscal } from './vocabulario'

/** Entrada do classificador de serviços + contexto opcional. */
export interface EntradaDescricaoServico {
  descricao: string
  /** Tomador do serviço (ex.: pessoa física, empresa, exterior). */
  tomador?: string
  /** Local da prestação (ex.: presencial, remoto/online, domicílio). */
  local?: string
  /** Destinação/uso (ex.: produção artística nacional, consumo próprio). */
  uso?: string
}

export type ConfiancaServico = 'alta' | 'media' | 'baixa'

/** Sinais fiscais de serviços (ids estáveis, usados em testes).
 * Fine-tuning NBS v2: cobertura por setor da Reforma (LC 214/2025) —
 * cada sinal mapeia gatilhos do dia a dia → hipótese de Anexo/cct,
 * sem nunca decidir sozinho (a prova é o vínculo NBS + resolvedor). */
export type SinalServico =
  | 'ENSINO'
  | 'SAUDE'
  | 'CULTURA_EVENTO'
  | 'AUDIOVISUAL'
  | 'SOBERANIA_SEGURANCA'
  | 'CIBERSEGURANCA'
  | 'TI_SOFTWARE'
  | 'SERV_PROFISSIONAL'
  | 'TRANSPORTE_LOGISTICA'
  | 'BELEZA_BEMESTAR'
  | 'ALIMENTACAO_HOSPEDAGEM'
  | 'TURISMO'
  | 'MANUTENCAO_REPARO'
  | 'LIMPEZA_CONSERVACAO'
  | 'SEGURANCA_PATRIMONIAL'
  | 'FINANCEIRO'
  | 'IMOBILIARIO'
  | 'PUBLICIDADE_MARKETING'
  | 'CONSTRUCAO'
  | 'PRESENCIAL'
  | 'REMOTO'
  | 'DOMICILIAR'
  | 'TOMADOR_EXTERIOR'
  | 'PRODUCAO_NACIONAL'
  | 'PESQUISA_ICT'
  | 'COOPERATIVA'
  | 'ESPORTE'
  | 'AMBIENTAL'
  | 'AGRO_INSUMO'
  | 'COMUN_PUBLICA'

export interface AnaliseDescricaoServico {
  textoNormalizado: string
  tokens: string[]
  sinais: SinalServico[]
  ambiguidades: string[]
  consultasExpandidas: string[]
  insuficiente: boolean
}

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'sem', 'em', 'no', 'na',
  'nos', 'nas', 'e', 'ou', 'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as',
  'tipo', 'servico', 'servicos', 'prestacao', 'item', 'que', 'por', 'meu', 'minha',
  // Ruído de pedido ("quero cortar cabelo", "preciso de frete") — sem valor
  // fiscal; sem isso o AND estrito morre por 1 termo de cortesia.
  'quero', 'queria', 'gostaria', 'preciso', 'precisando', 'fazer', 'alguem', 'favor',
])

const REGRAS_SINAL: { sinal: SinalServico; gatilhos: string[] }[] = [
  { sinal: 'ENSINO', gatilhos: ['educacao', 'escola', 'colegio', 'faculdade', 'universidade', 'curso', 'aula', 'ensino', 'treinamento', 'idioma', 'ingles', 'espanhol', 'aluno', 'professor', 'vestibular', 'concurso', 'cursinho', 'creche', 'autoescola', 'cnh', 'reforco', 'tutoria', 'mentoria', 'workshop', 'escolinha', 'maternal', 'supletivo', 'enem', 'pedagogia', 'instrutor', 'professora', 'aluna', 'estudante', 'especializacao', 'ead', 'cursinhos', 'idiomas', 'reforcos', 'oficinas', 'autoescolas', 'habilitacao', 'matricula', 'ensinar', 'estudar', 'treinar'] },
  { sinal: 'SAUDE', gatilhos: ['saude', 'humana', 'humano', 'medico', 'medica', 'medicos', 'hospital', 'clinica', 'consulta', 'consultas', 'exame', 'exames', 'dentista', 'odontologia', 'odonto', 'fisioterapia', 'enfermagem', 'enfermeiro', 'terapia', 'terapias', 'psicologo', 'psiquiatra', 'pediatra', 'nutricionista', 'nutricao', 'paciente', 'cirurgia', 'vacina', 'vacinacao', 'laboratorio', 'diagnostico', 'telemedicina', 'ambulancia', 'emergencia', 'massoterapia', 'acupuntura', 'checkup', 'triagem', 'cuidador', 'parto', 'obstetra', 'doula', 'quiropraxia', 'psicoterapia', 'rpg', 'tratar', 'consultar', 'examinar', 'operar', 'internar', 'vacinar', 'fono'] },
  { sinal: 'CULTURA_EVENTO', gatilhos: ['espetaculo', 'espetaculos', 'teatral', 'teatrais', 'show', 'shows', 'evento', 'eventos', 'feira', 'feiras', 'congresso', 'congressos', 'musical', 'musicais', 'danca', 'circo', 'circenses', 'carnaval', 'carnavalescos', 'exposicao', 'exposicoes', 'palestra', 'festa', 'casamento', 'formatura', 'buffet', 'fotografia', 'festival', 'museu', 'cerimonial', 'ator', 'atriz', 'elenco', 'atuar', 'dancarino', 'bailarino', 'palhaco', 'trapezista', 'magico', 'ilusionista', 'carnavalesco', 'passista', 'cantor', 'musico', 'sertanejo', 'forro', 'pagode', 'samba', 'expositor', 'feirante', 'congressista', 'decorador', 'palestrante', 'fotografo', 'aniversario', 'event', 'party', 'wedding', 'desfile', 'desfiles', 'folclore', 'academico', 'conferencia', 'mostras'] },
  { sinal: 'AUDIOVISUAL', gatilhos: ['filme', 'filmes', 'serie', 'series', 'novela', 'novelas', 'cinema', 'documentario', 'documentarios', 'jornalistico', 'jornalisticos', 'programa', 'programas', 'auditorio', 'entrevista', 'entrevistas', 'clipe', 'clipes', 'audiovisual', 'audiovisuais', 'filmagem', 'podcast', 'streaming', 'live', 'cinegrafista', 'cineasta', 'roteirista', 'roteiro', 'youtuber', 'influencer', 'streamer', 'blogueiro', 'locutor', 'apresentador', 'reporter', 'jornalista', 'filmar'] },
  { sinal: 'SOBERANIA_SEGURANCA', gatilhos: ['soberania', 'seguranca', 'administracao', 'publica', 'defesa'] },
  { sinal: 'CIBERSEGURANCA', gatilhos: ['cibernetica', 'informacao', 'software', 'socio', 'brasileiro', 'firewall', 'pentest', 'lgpd', 'antivirus', 'ciberataque', 'invasao', 'invasoes', 'ransomware', 'phishing', 'malware', 'criptografia', 'hacker', 'datacenter', 'licenca'] },
  // --- fine-tuning NBS v2+v3: setores que antes caíam em "sem lastro" ---
  { sinal: 'TI_SOFTWARE', gatilhos: ['software', 'app', 'aplicativo', 'sistema', 'site', 'ecommerce', 'programacao', 'desenvolvimento', 'suporte', 'helpdesk', 'nuvem', 'cloud', 'hospedagem', 'backup', 'dominio', 'instalacao', 'configuracao', 'programador', 'desenvolvedor', 'webdesigner', 'website', 'hardware', 'formatacao', 'upgrade'] },
  { sinal: 'SERV_PROFISSIONAL', gatilhos: ['advogado', 'advogados', 'advogada', 'advogadas', 'juridico', 'contador', 'contadores', 'contadora', 'contabilistas', 'contabeis', 'auditoria', 'auditor', 'pericia', 'peritos', 'peticao', 'consultoria', 'assessoria', 'engenheiro', 'engenheiros', 'engenharia', 'arquiteto', 'arquitetos', 'arquitetura', 'urbanista', 'projeto', 'laudo', 'vistoria', 'tradutor', 'traducao', 'despachante', 'corretor', 'intermediacao', 'administrador', 'administradores', 'agronomo', 'topografo', 'laudos', 'vistorias', 'parecer', 'consultores', 'coaching', 'mentor', 'fotografos', 'tradutores', 'interpretes', 'despachantes', 'corretagem', 'cartorio', 'tabeliao', 'assistente', 'bibliotecario', 'biologo', 'economista', 'estatistico', 'museologo', 'quimico', 'profissao', 'conselho'] },
  { sinal: 'TRANSPORTE_LOGISTICA', gatilhos: ['transporte', 'frete', 'carreto', 'mudanca', 'entrega', 'delivery', 'motoboy', 'taxi', 'logistica', 'armazenagem', 'estoque', 'van', 'onibus', 'motorista', 'caminhao', 'truck', 'carreta', 'kombi', 'microonibus', 'mototaxi', 'freteiro', 'carreteiro', 'caminhoneiro', 'entregador', 'motofrete', 'fretamento', 'transportadora', 'embarcador', 'guincho', 'reboque', 'mudancas', 'carretos', 'transfer', 'logistico', 'dirigir', 'entregar', 'zpe', 'exportado', 'exportados', 'ferroviario', 'hidroviario', 'metro', 'urbano', 'urbanos', 'coletivo', 'trem', 'barca', 'passageiros'] },
  { sinal: 'BELEZA_BEMESTAR', gatilhos: ['beleza', 'cabeleireiro', 'salao', 'barbearia', 'barbeiro', 'manicure', 'pedicure', 'estetica', 'depilacao', 'massagem', 'spa', 'tatuagem', 'maquiagem', 'sobrancelha', 'esporte', 'academia', 'personal', 'pilates', 'yoga', 'corte', 'cortar', 'cabelo', 'cabelos', 'cabeleireira', 'cabeleleiro', 'unha', 'unhas', 'mao', 'maos', 'pes', 'esmalteria', 'escova', 'progressiva', 'hidratacao', 'coloracao', 'tintura', 'mechas', 'luzes', 'barba', 'barbear', 'sobrancelhas', 'sombrancelha', 'cilio', 'lash', 'depilador', 'epilacao', 'bronzeamento', 'facial', 'massagista', 'esteticista', 'manicures', 'maquiador', 'hair', 'nail', 'makeup', 'barber', 'salon', 'penteado', 'saloes', 'personal', 'crossfit', 'natacao'] },
  { sinal: 'ALIMENTACAO_HOSPEDAGEM', gatilhos: ['alimentacao', 'restaurante', 'lanchonete', 'pizzaria', 'hamburgueria', 'padaria', 'confeitaria', 'marmita', 'catering', 'hotelaria', 'hotel', 'pousada', 'hostel', 'hospedagem', 'cozinheiro', 'chef', 'garcom', 'garconete', 'churrasqueiro', 'pizzaiolo', 'sushiman', 'confeiteiro', 'padeiro', 'barista', 'bartender', 'copeira', 'selfservice', 'rodizio', 'marmitas', 'marmitex', 'quentinha', 'bar', 'bares', 'boteco', 'pub', 'cervejaria', 'adega', 'lanchonetes', 'foodtruck', 'cozinhar', 'servir', 'parque', 'parques', 'diversao', 'tematico', 'motel'] },
  { sinal: 'TURISMO', gatilhos: ['turismo', 'viagem', 'agencia', 'passeio', 'guia', 'hospedagem', 'hotelaria', 'hospede', 'camareira', 'concierge', 'resort', 'motel', 'albergue', 'turista', 'turistico', 'excursao', 'roteiro', 'receptivo', 'viajar', 'passear', 'hospedar', 'pacote'] },
  { sinal: 'MANUTENCAO_REPARO', gatilhos: ['manutencao', 'reparo', 'eletricista', 'encanador', 'marcenaria', 'serralheria', 'chaveiro', 'mecanico', 'funilaria', 'instalacao', 'conserto', 'reforma', 'soldador', 'funileiro', 'lanterneiro', 'borracheiro', 'marceneiros', 'serralheiros', 'chaveiros', 'vidraceiro', 'hardware', 'upgrade', 'formatacao', 'consertar', 'consertos', 'reparos', 'costureira', 'alfaiate', 'sapateiros', 'relojoeiro', 'ourives', 'costurar'] },
  { sinal: 'LIMPEZA_CONSERVACAO', gatilhos: ['limpeza', 'faxina', 'diarista', 'conservacao', 'dedetizacao', 'jardinagem', 'lavanderia', 'limpeza', 'faxineira', 'zelador', 'zeladoria', 'jardineiro', 'caseiro', 'dedetizador', 'desentupidor', 'lavador', 'lavagem', 'lavanderias', 'tinturaria', 'limpar', 'lavar', 'aspirar'] },
  { sinal: 'SEGURANCA_PATRIMONIAL', gatilhos: ['seguranca', 'portaria', 'vigia', 'monitoramento', 'alarme', 'escolta', 'vigilante', 'guarda', 'escoltas', 'alarmes', 'ronda', 'vigias', 'porteiro', 'vigiar', 'monitorar'] },
  { sinal: 'FINANCEIRO', gatilhos: ['financeiro', 'banco', 'credito', 'emprestimo', 'financiamento', 'consorcio', 'seguro', 'corretora', 'cobranca', 'bancario', 'seguradora', 'consorcios', 'emprestimos', 'financiamentos', 'cobrador', 'factoring', 'previdencia', 'capitalizacao', 'fgts', 'curador', 'importador', 'importacao'] },
  { sinal: 'IMOBILIARIO', gatilhos: ['imobiliario', 'imovel', 'imoveis', 'aluguel', 'locacao', 'condominio', 'sindico', 'corretor', 'locador', 'inquilino', 'administradora', 'condominos', 'imobiliarias', 'locatarios', 'arrendamento', 'cessao', 'reabilitacao', 'historica', 'alugar'] },
  { sinal: 'PUBLICIDADE_MARKETING', gatilhos: ['publicidade', 'marketing', 'propaganda', 'design', 'grafico', 'impressao', 'midia', 'grafica', 'copiadora', 'xerox', 'plotagem', 'encadernacao', 'carimbo'] },
  { sinal: 'CONSTRUCAO', gatilhos: ['construcao', 'pedreiro', 'reforma', 'obra', 'pintura', 'empreitada', 'pintor', 'pedreiros', 'gesseiro', 'azulejista', 'telhadista', 'carpinteiro', 'armador', 'construtor', 'construtora', 'empreiteiro', 'pintar', 'construir', 'reformar'] },
  { sinal: 'PRESENCIAL', gatilhos: ['presencial', 'domicilio', 'domiciliar', 'local', 'clinica'] },
  { sinal: 'REMOTO', gatilhos: ['online', 'remoto', 'distancia', 'ead', 'internet', 'plataforma'] },
  { sinal: 'DOMICILIAR', gatilhos: ['domicilio', 'domiciliar', 'casa', 'residencia', 'home'] },
  { sinal: 'TOMADOR_EXTERIOR', gatilhos: ['exterior', 'estrangeiro', 'exportacao', 'internacional'] },
  { sinal: 'PRODUCAO_NACIONAL', gatilhos: ['nacional', 'brasileira', 'producao', 'cultural', 'artistica'] },
  { sinal: 'PESQUISA_ICT', gatilhos: ['pesquisa', 'pesquisador', 'ict', 'inovacao', 'cientifica', 'tecnologica', 'instituto'] },
  { sinal: 'COOPERATIVA', gatilhos: ['cooperativa', 'cooperativas', 'cooperado', 'associado', 'cooperativismo'] },
  { sinal: 'ESPORTE', gatilhos: ['esporte', 'esportivo', 'desportiva', 'desportivas', 'desporto', 'futebol', 'clube', 'clubes', 'ingresso', 'ingressos', 'atleta', 'torcedor', 'federacao', 'academia'] },
  { sinal: 'AMBIENTAL', gatilhos: ['ambiental', 'ambientais', 'vegetacao', 'nativa', 'conservacao', 'recuperacao', 'reflorestamento', 'manejo', 'mata', 'floresta'] },
  { sinal: 'AGRO_INSUMO', gatilhos: ['insumo', 'insumos', 'diferimento', 'agropecuario', 'agropecuarios', 'aquicola', 'aquicolas', 'adubo', 'semente', 'racao'] },
  { sinal: 'COMUN_PUBLICA', gatilhos: ['comunicacao', 'comunic', 'institucional', 'instit', 'imprensa', 'prefeitura', 'municipio', 'admin'] },
]

/** Todos os gatilhos conhecidos (para lastro de escopo e cobertura). */
export const GATILHOS_SERVICOS: Set<string> = new Set(
  REGRAS_SINAL.flatMap((r) => r.gatilhos),
)

/**
 * Juridiquês boilerplate da base NBS — match SÓ nesses termos não é lastro
 * ("consultoria"→"servico" casava os 112 NBS e sugeria benefício errado).
 * O filtro remove esses tokens das consultas efetivas e da pontuação.
 */
export const TOKENS_JURIDIQUES_NBS: Set<string> = new Set([
  'servico', 'servicos', 'fornecimento', 'fornecimentos', 'prestacao',
  'prestacoes', 'anexo', 'anexos', 'nbs', 'lei', 'complementar', 'lcp',
  'art', 'artigo', 'artigos', 'observado', 'observada', 'classificacao',
  'classificacoes', 'especificacao', 'especificacoes', 'respectiva',
  'respectivas', 'respectivo', 'respectivos', 'nomenclatura', 'brasileira',
  'brasileiro', 'intangiveis', 'intangivel', 'operacao', 'operacoes',
  'produzem', 'variacoes', 'patrimonio',
])

/** Remove o boilerplate mantendo o núcleo semântico da consulta. */
export function semJuridiques(tokens: string[]): string[] {
  return tokens.filter((t) => !TOKENS_JURIDIQUES_NBS.has(t))
}

export function expandirSinonimoServicos(token: string): string | null {
  return expandirSinonimoServico(token) ?? expandirSinonimoFiscal(token)
}

export function extrairSinaisServicos(tokens: string[]): SinalServico[] {
  const tem = new Set(tokens)
  const out: SinalServico[] = []
  for (const regra of REGRAS_SINAL) {
    if (regra.gatilhos.some((g) => tem.has(g))) out.push(regra.sinal)
  }
  return out
}

export function expandirConsultasServicos(tokensUteis: string[]): string[] {
  const base = tokensUteis.join(' ')
  if (!base) return []
  const consultas = [base]
  const expandidos = tokensUteis.map((t) => expandirSinonimoServicos(t) ?? t)
  const expandida = [...new Set(expandidos.join(' ').split(' '))].join(' ')
  if (expandida && expandida !== base) consultas.push(expandida)
  return [...new Set(consultas)].slice(0, 2)
}

/**
 * Tolerância a ruído com o vocabulário de SERVIÇOS (espelho de
 * `consultasTolerantes` de bens, que usa o sinônimo de NCM e vaza falso
 * positivo para cá — ex.: "petshop" via sinônimo de bens).
 * Tenta cada consulta sem 1 termo por vez; unigrama recorre ao sinônimo
 * de serviços.
 */
export function consultasTolerantesServicos(consultas: string[]): { consultas: string[]; ignorados: string[] } {
  const extras: string[] = []
  const ignorados: string[] = []
  for (const base of consultas) {
    const termos = base.split(' ').filter(Boolean)
    if (termos.length < 2) {
      for (const t of termos) {
        const s = expandirSinonimoServicos(t)
        if (s && !consultas.includes(s) && !extras.includes(s)) {
          extras.push(s)
          if (!ignorados.includes(t)) ignorados.push(t)
        }
      }
      continue
    }
    for (const t of termos) {
      const sem = termos.filter((x) => x !== t).join(' ')
      if (sem && !consultas.includes(sem) && !extras.includes(sem)) {
        extras.push(sem)
        if (!ignorados.includes(t)) ignorados.push(t)
      }
    }
    if (extras.length >= 12) break
  }
  return { consultas: extras.slice(0, 12), ignorados }
}

/**
 * Lastro de serviço (para a barreira de escopo não recusar consulta legítima
 * como "teste de software": 'teste' é marcador externo, mas 'software' é
 * termo do sistema de serviços).
 */
export function temLastroServico(texto: unknown): boolean {
  const cru = String(texto ?? '')
  if (!cru.trim()) return false
  if (/\d{2,}/.test(cru)) return true
  const norm = normalizarBusca(cru)
  if (!norm) return false
  const tokens = norm.split(' ').filter(Boolean)
  return tokens.some(
    (t) =>
      SINONIMOS_SERVICOS[t] !== undefined ||
      Object.values(SINONIMOS_SERVICOS).includes(t) ||
      GATILHOS_SERVICOS.has(t),
  )
}

/** Rótulo do setor para orientação honesta quando não há benefício mapeado. */
export function rotuloSetorServico(sinais: SinalServico[]): string | null {
  if (sinais.includes('ENSINO')) return 'educação'
  if (sinais.includes('SAUDE')) return 'saúde'
  if (sinais.includes('CULTURA_EVENTO') || sinais.includes('AUDIOVISUAL')) return 'cultura/eventos/audiovisual'
  if (sinais.includes('CIBERSEGURANCA') || sinais.includes('SOBERANIA_SEGURANCA')) return 'segurança da informação'
  if (sinais.includes('TI_SOFTWARE')) return 'tecnologia da informação'
  if (sinais.includes('TRANSPORTE_LOGISTICA')) return 'transporte/logística'
  if (sinais.includes('BELEZA_BEMESTAR')) return 'beleza/bem-estar'
  if (sinais.includes('ALIMENTACAO_HOSPEDAGEM')) return 'alimentação/hospedagem'
  if (sinais.includes('TURISMO')) return 'turismo'
  if (sinais.includes('SERV_PROFISSIONAL')) return 'serviços profissionais'
  if (sinais.includes('MANUTENCAO_REPARO')) return 'manutenção/reparos'
  if (sinais.includes('LIMPEZA_CONSERVACAO')) return 'limpeza/conservação'
  if (sinais.includes('SEGURANCA_PATRIMONIAL')) return 'segurança patrimonial'
  if (sinais.includes('FINANCEIRO')) return 'serviços financeiros'
  if (sinais.includes('IMOBILIARIO')) return 'serviços imobiliários'
  if (sinais.includes('PUBLICIDADE_MARKETING')) return 'publicidade/marketing'
  if (sinais.includes('CONSTRUCAO')) return 'construção/reformas'
  if (sinais.includes('PESQUISA_ICT')) return 'pesquisa científica (ICT)'
  if (sinais.includes('COOPERATIVA')) return 'cooperativismo'
  if (sinais.includes('ESPORTE')) return 'esporte'
  if (sinais.includes('AMBIENTAL')) return 'meio ambiente'
  if (sinais.includes('AGRO_INSUMO')) return 'insumos agropecuários'
  if (sinais.includes('COMUN_PUBLICA')) return 'comunicação pública'
  return null
}

export function analisarDescricaoServico(entrada: EntradaDescricaoServico): AnaliseDescricaoServico {
  const combinado = [entrada.descricao, entrada.tomador ?? '', entrada.local ?? '', entrada.uso ?? '']
    .join(' ')
    .trim()
  const textoNormalizado = normalizarBusca(combinado)
  const tokens = tokenizarBusca(combinado).filter((t) => !STOPWORDS.has(t))
  const sinais = extrairSinaisServicos(tokens)

  const ambiguidades: string[] = []
  // Anexo X exige destinação nacional também no audiovisual (filme/série/
  // programa só têm benefício quando produção nacional) — teto `media`.
  if ((sinais.includes('CULTURA_EVENTO') || sinais.includes('AUDIOVISUAL')) && !sinais.includes('PRODUCAO_NACIONAL')) {
    ambiguidades.push('O benefício do Anexo X exige destinação a produção nacional artística/cultural — confirmar a destinação do serviço.')
  }
  if (sinais.includes('CIBERSEGURANCA')) {
    ambiguidades.push('O benefício do Anexo XI para cibersegurança exige sociedade com sócio brasileiro (≥20%) — confirmar a composição societária.')
  }
  if (sinais.includes('TOMADOR_EXTERIOR')) {
    ambiguidades.push('Tomador no exterior pode mudar o enquadramento (exportação de serviços) — confirmar o local do tomador.')
  }
  // Fine-tuning NBS v2 — raciocínio por setor (condições que mudam o Anexo/cct).
  // Só viram ambiguidade (teto `media`) quando há risco real de Anexo errado;
  // o resto é refino via perguntas, sem penalizar a confiança do caso claro
  // (ex.: "aula de inglês online" continua `alta` no determinístico).
  if (sinais.includes('TRANSPORTE_LOGISTICA') && sinais.includes('TOMADOR_EXTERIOR')) {
    ambiguidades.push('Transporte com tomador/destino no exterior pode ser exportação de serviço — confirmar origem, destino e tomador.')
  }
  if (sinais.includes('FINANCEIRO')) {
    ambiguidades.push('Serviço financeiro tem alíquota uniforme setorial (Anexo específico) — confirmar a natureza (crédito, seguro, intermediação?).')
  }
  if (sinais.includes('IMOBILIARIO')) {
    ambiguidades.push('Locação/cessão de imóvel: confirmar se é locação pura, administração condominial ou intermediação — cada uma tem cct próprio.')
  }

  const unico = tokens.length === 1 ? tokens[0] : ''
  // Palavra única conhecida do sistema (vocábulo, gatilho ou pin) com ≥3
  // letras já é pesquisável ("show", "spa", "bar", "taxi", "app", "aula"):
  // antes exigia ≥5 e a IA "não sugeria nada" para o trivial.
  const unicoConhecido =
    unico.length >= 3 &&
    (SINONIMOS_SERVICOS[unico] !== undefined ||
      GATILHOS_SERVICOS.has(unico))
  const unicoForte = (unico.length >= 5 && !STOPWORDS.has(unico)) || unicoConhecido
  const insuficiente = tokens.length === 0 || (tokens.length < 2 && !unicoForte)
  return {
    textoNormalizado,
    tokens,
    sinais,
    ambiguidades,
    consultasExpandidas: expandirConsultasServicos(tokens),
    insuficiente,
  }
}

export function perguntasComplementaresServicos(analise: AnaliseDescricaoServico): string[] {
  const perguntas: string[] = []
  if (analise.insuficiente) {
    perguntas.push('Descreva o serviço com 1–2 detalhes (ex.: aula de inglês online para adultos? consulta médica domiciliar? frete com destino ao exterior?).')
    return perguntas
  }
  if (analise.sinais.includes('ENSINO')) {
    perguntas.push('O ensino é presencial ou a distância (online)? Qual o nível (livre, técnico, superior)?')
  }
  if (analise.sinais.includes('SAUDE')) {
    perguntas.push('O atendimento é presencial, domiciliar ou por telemedicina? Qual a especialidade?')
  }
  if (analise.sinais.includes('CULTURA_EVENTO') || analise.sinais.includes('AUDIOVISUAL')) {
    perguntas.push('O serviço destina-se a produção nacional (teatro, show, filme, evento)? Qual o tipo de produção?')
  }
  // Fine-tuning NBS v2 — refino por setor (raciocínio guiado).
  if (analise.sinais.includes('TI_SOFTWARE')) {
    perguntas.push('É desenvolvimento, licenciamento, suporte ou hospedagem? O uso é próprio ou revenda? Presencial ou remoto?')
  }
  if (analise.sinais.includes('SERV_PROFISSIONAL')) {
    perguntas.push('Qual a atividade principal (advocacia, contábil, engenharia, consultoria?) e quem é o tomador (empresa, pessoa física, exterior?)?')
  }
  if (analise.sinais.includes('TRANSPORTE_LOGISTICA')) {
    perguntas.push('Qual a origem e o destino (municipal, intermunicipal, interestadual, exterior?) e o tomador? Há armazenagem junto?')
  }
  if (analise.sinais.includes('BELEZA_BEMESTAR')) {
    perguntas.push('Qual o serviço (cabelo, estética, massagem, academia?) e o local (salão, domicílio, online?)')
  }
  if (analise.sinais.includes('ALIMENTACAO_HOSPEDAGEM') || analise.sinais.includes('TURISMO')) {
    perguntas.push('É consumo no local, delivery, hospedagem ou pacote turístico? Para quantas pessoas e onde?')
  }
  if (analise.sinais.includes('MANUTENCAO_REPARO') || analise.sinais.includes('CONSTRUCAO')) {
    perguntas.push('Há fornecimento de peças/materiais junto com a mão de obra? É reforma, reparo pontual ou obra nova?')
  }
  if (analise.sinais.includes('LIMPEZA_CONSERVACAO') || analise.sinais.includes('SEGURANCA_PATRIMONIAL')) {
    perguntas.push('É contrato contínuo (condomínio/empresa) ou avulso? Qual o local e a frequência?')
  }
  if (analise.sinais.includes('FINANCEIRO')) {
    perguntas.push('Qual a natureza (crédito, seguro, consórcio, intermediação?) e quem é o tomador?')
  }
  if (analise.sinais.includes('IMOBILIARIO')) {
    perguntas.push('É locação, administração, intermediação ou condomínio? Qual o imóvel e o período?')
  }
  if (analise.sinais.includes('PUBLICIDADE_MARKETING')) {
    perguntas.push('É criação, veiculação ou impressão? Qual o meio (digital, impresso, externo?)')
  }
  // Fine-tuning v4 — refino dos novos setores com benefício.
  if (analise.sinais.includes('PESQUISA_ICT')) {
    perguntas.push('A prestadora é ICT sem fins lucrativos? Quem é o tomador (governo ou contribuinte regular)?')
  }
  if (analise.sinais.includes('COOPERATIVA')) {
    perguntas.push('A cooperativa optou pelo regime específico? É fluxo associado ↔ cooperativa?')
  }
  if (analise.sinais.includes('ESPORTE')) {
    perguntas.push('O clube/associação é filiado à federação? É educação desportiva ou gestão/exploração?')
  }
  if (analise.sinais.includes('AMBIENTAL')) {
    perguntas.push('É vegetação nativa com conformidade legal (não jardim ornamental)?')
  }
  if (analise.sinais.includes('AGRO_INSUMO')) {
    perguntas.push('O insumo está no Anexo IX? A operação é com diferimento?')
  }
  if (analise.sinais.includes('COMUN_PUBLICA')) {
    perguntas.push('O tomador é órgão público? É comunicação institucional (não marketing privado)?')
  }
  if (!perguntas.length && analise.tokens.length <= 2) {
    perguntas.push('Informe o tomador (pessoa física, empresa, exterior?) e o local (presencial ou remoto?).')
  }
  return perguntas
}

export function calcularConfiancaServicos(args: {
  totalCandidatos: number
  margemTopo: number
  tokensUteis: number
  temCondicaoRisco: boolean
}): ConfiancaServico {
  if (args.totalCandidatos === 0 || args.tokensUteis < 2) return 'baixa'
  if (args.temCondicaoRisco) return 'media'
  if (args.totalCandidatos === 1 || args.margemTopo >= 30) return 'alta'
  return 'media'
}
