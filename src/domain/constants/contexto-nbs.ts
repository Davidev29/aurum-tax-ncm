/**
 * Contexto personalizado por NBS (LC 214/2025) — espelho em código de
 * `recursos-ia/conhecimento/contexto-nbs.json` (gerado por
 * `scripts/gerar-contexto-nbs.py` a partir da base viva + curadoria de grupos).
 *
 * Papel: dar a cada item NBS um contexto próprio para a descrição preditiva —
 * resumo fiel ao texto oficial, quando se aplica / quando NÃO se aplica,
 * condições (destinação nacional, sócio BR, tomador público), consultas
 * típicas, termos populares e perguntas de refino. A UI exibe esse contexto
 * junto de cada sugestão; o preditivo usa os termos como camada de match
 * (`origem: 'contexto-personalizado'`).
 *
 * Regras:
 * - Nada aqui altera CST/cct/redução/base legal (nível Deus, só leitura);
 *   os vínculos vêm da base viva via resolvedor.
 * - 107 NBS em 5 grupos; textos oficiais idênticos por grupo, personalização
 *   por vínculos reais (ccts por código, dualidade 200043×200044, cluster,
 *   flag representante). Ver NORMAS-CURADORIA.md §9.
 */

export type GrupoNbsId =
  | 'EDU' | 'SAUDE' | 'ART-X' | 'ADM-XI' | 'CIBER-XI' | 'PROF-30'
  | 'SAUDE-INTERM' | 'TRANSP-ZPE' | 'PESQUISA-ICT' | 'FGTS-OP' | 'FIN-IMPORT'
  | 'COOP' | 'TRANSP-PUB' | 'EDU-PROUNI' | 'LOC-REAB' | 'LOCACAO'
  | 'AMBIENTAL' | 'COMUN-PUB' | 'ESPORTE' | 'IMOVEL' | 'HOTEL' | 'TURISMO'
  | 'DIFER-INSUMO'

export interface GrupoContextoNbs {
  grupo: GrupoNbsId
  cct: string
  cst: string
  tituloCurto: string
  /** Rótulo curto para hipóteses sem NBS direto (sem truncamento). */
  rotuloHipotese: string
  /** Anexo LC 214 (`II`, `X`…) ou `''` quando regime próprio sem anexo numerado. */
  anexo: string
  artigo: string
  reducaoIBS: number
  reducaoCBS: number
  documentos: string[]
  resumo: string
  quandoSeAplica: string[]
  quandoNaoSeAplica: string[]
  condicoes: string[]
  consultasTipicas: string[]
  termosPopulares: string[]
  perguntasRefino: string[]
  cnaeDivisoes: string[]
  documentosNota: string
}

export interface ItemContextoNbs {
  /** NBS, 9 dígitos (só dígitos). */
  nbs: string
  grupo: GrupoNbsId
  /** Bloco estrutural (5 primeiros dígitos) — dica de família dentro do grupo. */
  cluster: string
  /** ccts com vínculo real na base viva. */
  ccts: string[]
  documentos: string[]
  /** Código canônico usado pelos pins do dicionário de serviços. */
  representante: boolean
  /** `true` nos 5 códigos XI com duplo enquadramento 200043×200044. */
  multiEnquadramento: boolean
}

/** Nota fixa dos códigos com duplo enquadramento (200043 × 200044). */
export const NOTA_DUAL_XI =
  'Este NBS tem DOIS enquadramentos possíveis na base: 200/200043 (venda à administração pública em soberania/segurança, sem exigência societária) e 200/200044 (segurança da informação/cibernética, exige sócio brasileiro ≥20%). A escolha depende da operação real: tomador público → 200043; prestadora com sócio BR ≥20% em segurança da informação → 200044.'

export const GRUPOS_CONTEXTO_NBS: Record<GrupoNbsId, GrupoContextoNbs> = {
  'EDU': {
    grupo: 'EDU',
    cct: '200028',
    cst: '200',
    tituloCurto: 'Serviços de educação — Anexo II',
    rotuloHipotese: 'Serviços de educação — redução de 60% (art. 129)',
    anexo: 'II',
    artigo: 'Art. 129 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFSE'],
    resumo: 'Fornecimento de serviços de educação com redução de 60% das alíquotas de IBS e CBS (art. 129, Anexo II da LC 214/2025). Vale para o ensino em todos os níveis e modalidades — da creche ao superior, incluindo cursos livres, idiomas, formação de condutores e treinamento profissional — desde que a atividade prestada seja educacional.',
    quandoSeAplica: [
      'Aulas e cursos presenciais ou a distância (EAD), em qualquer nível',
      'Escolas, faculdades, universidades, cursos de idiomas e cursinhos',
      'Autoescolas e formação de condutores',
      'Treinamento e capacitação profissional',
      'Educação infantil (creche e pré-escola)',
    ],
    quandoNaoSeAplica: [
      'Venda de material didático, livros e apostilas em separado (são bens, NCM)',
      'Transporte escolar (serviço de transporte, sem benefício mapeado)',
      'Alimentação escolar e cantina (alimentação, sem benefício mapeado)',
      'Festa de formatura e shows (avaliar Anexo X, exige destinação nacional)',
    ],
    condicoes: [
      'Sem exigência de destinação nacional ou composição societária',
      'Tomador no exterior pode caracterizar exportação de serviços (regra própria) — confirmar',
    ],
    consultasTipicas: [
      'aula de inglês online',
      'formação de condutores',
      'autoescola',
      'reforço escolar',
      'curso preparatório para concurso',
      'curso de idiomas',
      'treinamento corporativo',
      'educação infantil',
    ],
    termosPopulares: [
      'aula', 'curso', 'escola', 'faculdade', 'universidade', 'colegio',
      'autoescola', 'cursinho', 'vestibular', 'enem', 'idioma', 'ingles',
      'ensino', 'educacao', 'treinamento', 'creche', 'ead', 'professor',
      'aluno', 'formacao', 'condutores', 'reforco', 'pedagogia',
    ],
    perguntasRefino: [
      'O ensino é presencial ou a distância (online)?',
      'Qual o nível — infantil, fundamental, médio, técnico, superior, livre?',
      'Quem é o tomador (pessoa física, empresa, exterior)?',
    ],
    cnaeDivisoes: ['85'],
    documentosNota: 'Emitido por NFSE.',
  },
  'SAUDE': {
    grupo: 'SAUDE',
    cct: '200029',
    cst: '200',
    tituloCurto: 'Serviços de saúde humana — Anexo III',
    rotuloHipotese: 'Serviços de saúde humana — redução de 60% (art. 130)',
    anexo: 'III',
    artigo: 'Art. 130 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFSE'],
    resumo: 'Fornecimento de serviços de saúde humana com redução de 60% das alíquotas de IBS e CBS (art. 130, Anexo III da LC 214/2025). Abrange consultas, exames, odontologia, fisioterapia, enfermagem, vacinação e demais atendimentos à saúde humana — no consultório, no hospital, em domicílio ou por telemedicina.',
    quandoSeAplica: [
      'Consultas médicas e odontológicas, em qualquer especialidade',
      'Exames laboratoriais e de imagem (sangue, ultrassom, raio-x)',
      'Fisioterapia, enfermagem, nutrição, psicologia e terapias',
      'Vacinação e campanhas de imunização',
      'Atendimento domiciliar (home care) e telemedicina',
      'Cirurgias e internações em serviços de saúde humana',
    ],
    quandoNaoSeAplica: [
      'Venda de medicamentos, vacinas e insumos em separado (são bens, NCM)',
      'Serviços veterinários (saúde animal — fora do Anexo III)',
      'Estética puramente cosmética sem caráter terapêutico (verificar caso a caso)',
      'Planos e seguros de saúde (análise própria da operação — perguntar)',
    ],
    condicoes: [
      'Destinado à saúde HUMANA (exclui veterinária)',
      'Sem exigência de destinação nacional ou composição societária',
      'Local do atendimento (presencial, domiciliar, remoto) deve constar — muda perguntas, não o benefício',
    ],
    consultasTipicas: [
      'consulta médica',
      'dentista',
      'exame de sangue',
      'fisioterapia',
      'consulta médica domiciliar',
      'pronto socorro',
      'vacinação',
      'telemedicina',
    ],
    termosPopulares: [
      'saude', 'humana', 'medico', 'consulta', 'exame', 'dentista',
      'odontologia', 'fisioterapia', 'enfermagem', 'hospital', 'clinica',
      'vacina', 'laboratorio', 'cirurgia', 'emergencia', 'psicologo',
      'nutricionista', 'ultrassom', 'checkup', 'domiciliar', 'telemedicina',
    ],
    perguntasRefino: [
      'O atendimento é presencial, domiciliar ou por telemedicina?',
      'Qual a especialidade?',
      'É saúde humana (exclui veterinária)?',
    ],
    cnaeDivisoes: ['86', '87', '88'],
    documentosNota: 'Emitido por NFSE.',
  },
  'ART-X': {
    grupo: 'ART-X',
    cct: '200039',
    cst: '200',
    tituloCurto: 'Produções nacionais artísticas e culturais — Anexo X',
    rotuloHipotese: 'Produções nacionais — redução de 60% (art. 139, exige destinação)',
    anexo: 'X',
    artigo: 'Art. 139 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFE', 'NFSE'],
    resumo: 'Fornecimento de serviços e licenciamento ou cessão de direitos com redução de 60% de IBS e CBS (art. 139, Anexo X), CONDICIONADO à destinação a produções nacionais artísticas, culturais, de eventos, jornalísticas e audiovisuais: espetáculos teatrais, circenses e de dança, shows musicais, desfiles carnavalescos ou folclóricos, eventos acadêmicos e científicos (congressos, conferências, simpósios), feiras de negócios, exposições e mostras culturais, artísticas e literárias, programas de auditório ou jornalísticos, filmes, documentários, séries, novelas, entrevistas e clipes musicais.',
    quandoSeAplica: [
      'Shows, peças de teatro, espetáculos de dança e circo de produção nacional',
      'Filmes, séries, novelas, documentários e clipes nacionais',
      'Congressos, feiras, exposições e eventos acadêmicos/científicos',
      'Desfiles carnavalescos e manifestações folclóricas',
      'Licenciamento ou cessão de direitos dessas produções',
    ],
    quandoNaoSeAplica: [
      'Evento particular sem caráter cultural/artístico comprovado (festa privada comum)',
      'Produção estrangeira (exige produção NACIONAL)',
      'Publicidade comercial comum sem enquadramento em produção nacional',
      'Sem destinação comprovada, vale a regra geral — confirmar a destinação',
    ],
    condicoes: [
      'DESTINAÇÃO NACIONAL OBRIGATÓRIA: sem comprovação, não se aplica',
      'A destinação deve constar da operação (contrato, projeto, edital)',
    ],
    consultasTipicas: [
      'show',
      'teatro',
      'cinema',
      'festa de casamento',
      'feira de artesanato',
      'congresso',
      'festival de música',
      'circo',
      'desfile de carnaval',
      'documentário',
    ],
    termosPopulares: [
      'show', 'shows', 'teatro', 'teatrais', 'cinema', 'filme', 'filmes',
      'serie', 'series', 'novela', 'circo', 'circenses', 'danca', 'evento',
      'eventos', 'feira', 'feiras', 'congresso', 'festival', 'carnaval',
      'exposicao', 'museu', 'espetaculo', 'espetaculos', 'musical',
      'desfile', 'folclore', 'documentario', 'entrevista', 'clipe',
      'programa', 'jornalistico', 'producao', 'nacional', 'artistica',
      'cultural', 'audiovisual',
    ],
    perguntasRefino: [
      'O serviço destina-se a produção nacional (qual? teatro, filme, evento...)?',
      'Há comprovação da destinação (contrato, projeto, edital)?',
      'É show, espetáculo, feira, congresso ou produção audiovisual?',
    ],
    cnaeDivisoes: ['58', '59', '60', '74', '82', '90', '91', '92', '93'],
    documentosNota: 'Emitido por NFe ou NFSe, conforme a operação.',
  },
  'ADM-XI': {
    grupo: 'ADM-XI',
    cct: '200043',
    cst: '200',
    tituloCurto: 'Soberania e segurança — venda à administração pública (Anexo XI)',
    rotuloHipotese: 'Soberania/segurança p/ governo — redução de 60% (art. 142)',
    anexo: 'XI',
    artigo: 'Art. 142 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFE', 'NFSE'],
    resumo: 'Fornecimento à administração pública direta, autarquias e fundações públicas de serviços e bens de soberania, segurança nacional, segurança da informação e segurança cibernética, com redução de 60% de IBS e CBS (art. 142, Anexo XI). O traço distintivo é o TOMADOR: só vale vendendo para o poder público nessas finalidades.',
    quandoSeAplica: [
      'Venda de serviços/bens de soberania e segurança nacional ao governo',
      'Contratos com administração direta, autarquias e fundações públicas',
      'Segurança da informação e cibernética contratada por órgão público',
    ],
    quandoNaoSeAplica: [
      'Venda para empresa privada ou pessoa física (avaliar 200/200044 se for segurança da informação/cibernética, senão regra geral)',
      'Serviço sem vínculo com soberania/segurança nacional',
      'Segurança patrimonial privada comum (portaria de condomínio, vigilância privada)',
    ],
    condicoes: [
      'TOMADOR OBRIGATÓRIO: administração pública direta, autarquia ou fundação pública',
      'Sem exigência de composição societária neste enquadramento',
    ],
    consultasTipicas: [
      'vigilância patrimonial',
      'segurança para órgão público',
      'monitoramento',
      'portaria',
      'segurança',
    ],
    termosPopulares: [
      'seguranca', 'soberania', 'administracao', 'publica', 'nacional',
      'informacao', 'cibernetica', 'vigilancia', 'monitoramento',
      'portaria', 'escolta', 'alarme', 'defesa',
    ],
    perguntasRefino: [
      'O tomador é administração pública direta, autarquia ou fundação?',
      'O objeto é soberania, segurança nacional, da informação ou cibernética?',
      'Se for empresa privada: a prestadora tem sócio brasileiro ≥20%? (pode ser 200/200044)',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFe ou NFSe, conforme a operação.',
  },
  'CIBER-XI': {
    grupo: 'CIBER-XI',
    cct: '200044',
    cst: '200',
    tituloCurto: 'Segurança da informação e cibernética com sócio brasileiro (Anexo XI)',
    rotuloHipotese: 'Segurança da informação — redução de 60% (art. 142, exige sócio BR)',
    anexo: 'XI',
    artigo: 'Art. 142 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFCE', 'NFE', 'NFSE'],
    resumo: 'Operações e prestações de serviços de segurança da informação e segurança cibernética com redução de 60% de IBS e CBS (art. 142, Anexo XI), quando prestadas por sociedade com sócio brasileiro detendo no mínimo 20% do capital social. O traço distintivo é duplo: OBJETO (segurança da informação/cibernética) + COMPOSIÇÃO (sócio BR ≥20%).',
    quandoSeAplica: [
      'Pentest, firewall gerenciado e resposta a incidentes por empresa com sócio BR ≥20%',
      'Monitoramento SOC e antivírus corporativo nessas condições',
      'Consultoria LGPD com foco em segurança da informação (verificar objeto)',
    ],
    quandoNaoSeAplica: [
      'Prestadora SEM sócio brasileiro ≥20% (vai para regra geral ou 200/200043 se tomador público)',
      'TI genérico sem caráter de segurança (desenvolvimento, suporte, hospedagem)',
      'Venda de software de prateleira sem prestação de serviço de segurança',
    ],
    condicoes: [
      'COMPOSIÇÃO OBRIGATÓRIA: sócio brasileiro com ≥20% do capital',
      'OBJETO: segurança da informação / segurança cibernética (não TI genérico)',
    ],
    consultasTipicas: [
      'firewall',
      'pentest',
      'teste de invasão',
      'segurança da informação',
      'antivírus corporativo',
      'LGPD',
    ],
    termosPopulares: [
      'seguranca', 'informacao', 'cibernetica', 'ciberataque', 'firewall',
      'pentest', 'antivirus', 'ransomware', 'phishing', 'malware',
      'criptografia', 'lgpd', 'socio', 'brasileiro', 'sociedade',
      'invasao', 'hacker',
    ],
    perguntasRefino: [
      'A prestadora tem sócio brasileiro com ≥20% do capital?',
      'O objeto é segurança da informação/cibernética (não TI genérico)?',
      'O tomador é público ou privado?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFCe, NFe ou NFSe, conforme a operação.',
  },
  'PROF-30': {
    grupo: 'PROF-30',
    cct: '200052',
    cst: '200',
    tituloCurto: 'Profissões intelectuais regulamentadas — art. 127',
    rotuloHipotese: 'Profissões intelectuais — redução de 30% (art. 127)',
    anexo: '',
    artigo: 'Art. 127 (redação do art. 202) da LC 214/2025',
    reducaoIBS: 30,
    reducaoCBS: 30,
    documentos: ['NFSE'],
    resumo: 'Prestação de serviços por profissionais liberais em atividades intelectuais de natureza científica, literária ou artística, submetidas à fiscalização por conselho profissional, com redução de 30% das alíquotas de IBS e CBS (art. 127, redação do art. 202 da LC 214/2025). Não há NBS vinculado na base atual — o enquadramento é por hipótese legal (200/200052), a confirmar com o contador.',
    quandoSeAplica: [
      'Advogados, contabilistas, engenheiros e agrônomos no exercício liberal',
      'Administradores, arquitetos e urbanistas, economistas, estatísticos',
      'Assistentes sociais, bibliotecários, biólogos, químicos, museólogos',
      'Profissionais de educação física e de relações públicas',
      'Médicos veterinários e zootecnistas, técnicos industriais e agrícolas',
      'Economistas domésticos',
    ],
    quandoNaoSeAplica: [
      'Profissional sem registro no conselho de fiscalização',
      'Atividade comercial ou operacional sem caráter intelectual (ex.: comércio, transporte)',
      'Serviço prestado como empregado CLT (não é prestação de serviço liberal)',
      'Pessoa jurídica sem profissional habilitado responsável (verificar)',
    ],
    condicoes: [
      'PROFISSÃO REGULAMENTADA: atividade submetida a conselho profissional',
      'NATUREZA INTELECTUAL: científica, literária ou artística',
      'Sem NBS vinculado — hipótese a confirmar com o contador',
    ],
    consultasTipicas: [
      'advogado',
      'contador',
      'engenheiro',
      'contabilista',
      'administrador',
      'arquiteto',
    ],
    termosPopulares: [
      'advogado', 'advogados', 'contador', 'contadores', 'contabilista',
      'contabilistas', 'engenheiro', 'engenheiros', 'administrador',
      'administradores', 'arquiteto', 'arquitetos', 'urbanista',
      'assistente', 'bibliotecario', 'biologo', 'economista',
      'estatistico', 'veterinario', 'museologo', 'quimico',
      'profissao', 'profissoes', 'intelectual', 'conselho',
    ],
    perguntasRefino: [
      'Qual a profissão (advogado, contador, engenheiro...)? Tem registro no conselho?',
      'A atividade é intelectual (científica, literária ou artística)?',
      'É prestação liberal ou vínculo CLT?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'SAUDE-INTERM': {
    grupo: 'SAUDE-INTERM',
    cct: '011003',
    cst: '011',
    tituloCurto: 'Intermediação de planos de saúde — art. 240',
    rotuloHipotese: 'Intermediação de planos de saúde — redução de 60% (art. 240)',
    anexo: '',
    artigo: 'Art. 240 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFSE'],
    resumo: 'Intermediação (corretagem) de planos de assistência à saúde com redução de 60% de IBS e CBS (art. 240 da LC 214/2025). É o serviço do corretor/intermediário — distinto da operadora do plano. Sem NBS vinculado: hipótese legal (011/011003), a confirmar com o contador.',
    quandoSeAplica: [
      'Corretagem e intermediação na contratação de plano de saúde',
      'Assessoria ao cliente na escolha e adesão ao plano',
    ],
    quandoNaoSeAplica: [
      'Operadora do plano de saúde (benefício próprio distinto)',
      'Intermediação de plano funerário ou pet (outros regimes)',
      'Consultoria sem intermediação efetiva (verificar objeto)',
    ],
    condicoes: [
      'OBJETO: intermediação de planos de SAÚDE (não o plano em si)',
      'Sem NBS vinculado — hipótese a confirmar com o contador',
    ],
    consultasTipicas: [
      'corretor de plano de saúde',
      'intermediação de plano de saúde',
      'corretagem de plano de saúde',
    ],
    termosPopulares: [
      'intermediacao', 'corretor', 'corretagem', 'corretora', 'saude',
      'plano', 'planos',
    ],
    perguntasRefino: [
      'É intermediação/corretagem ou a operadora do plano?',
      'O plano é de saúde humana?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'TRANSP-ZPE': {
    grupo: 'TRANSP-ZPE',
    cct: '200001',
    cst: '200',
    tituloCurto: 'Transporte para ZPE e exportados — art. 103 (alíquota zero)',
    rotuloHipotese: 'Transporte p/ ZPE — alíquota zero (art. 103)',
    anexo: '',
    artigo: 'Art. 103 da LC 214/2025',
    reducaoIBS: 100,
    reducaoCBS: 100,
    documentos: ['CTE', 'CTEOS', 'NFSE'],
    resumo: 'Serviços de transporte de bens ATÉ as zonas de processamento de exportação (ZPE) e de bens exportados A PARTIR das ZPE, com alíquota zero de IBS e CBS (art. 103 da LC 214/2025). Sem NBS vinculado: hipótese legal (200/200001), a confirmar com o contador.',
    quandoSeAplica: [
      'Frete rodoviário de bens com destino a ZPE',
      'Transporte de bens exportados saindo da ZPE',
    ],
    quandoNaoSeAplica: [
      'Frete comum no mercado interno (sem ZPE)',
      'Transporte de passageiros, mudanças e táxi',
      'Transporte internacional sem vínculo com ZPE (verificar exportação)',
    ],
    condicoes: [
      'ORIGEM/DESTINO ZPE: até a zona ou exportado a partir dela',
      'OBJETO: bens (não passageiros)',
    ],
    consultasTipicas: [
      'frete para zpe',
      'transporte para zona de processamento de exportação',
      'frete de exportação zpe',
    ],
    termosPopulares: [
      'transporte', 'frete', 'exportacao', 'exportado', 'exportados',
      'zpe', 'carreto',
    ],
    perguntasRefino: [
      'A origem ou o destino é zona de processamento de exportação (ZPE)?',
      'É transporte de bens (não passageiros)? Qual o modal?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'CTe/CTe OS (e NFSE quando cabível).',
  },
  'PESQUISA-ICT': {
    grupo: 'PESQUISA-ICT',
    cct: '200016',
    cst: '200',
    tituloCurto: 'Pesquisa por ICT sem fins lucrativos — art. 156 (alíquota zero)',
    rotuloHipotese: 'Pesquisa por ICT — alíquota zero (art. 156)',
    anexo: '',
    artigo: 'Art. 156 da LC 214/2025',
    reducaoIBS: 100,
    reducaoCBS: 100,
    documentos: ['NFSE'],
    resumo: 'Prestação de serviços de pesquisa e desenvolvimento por Instituição Científica, Tecnológica e de Inovação (ICT) sem fins lucrativos, para a administração pública ou contribuinte do regime regular, com alíquota zero de IBS e CBS (art. 156 da LC 214/2025). Sem NBS vinculado: hipótese legal (200/200016).',
    quandoSeAplica: [
      'Pesquisa científica/tecnológica por ICT sem fins lucrativos',
      'Desenvolvimento experimental e inovação sob encomenda pública',
      'Tomador: governo ou contribuinte do regime regular',
    ],
    quandoNaoSeAplica: [
      'P&D por empresa com fins lucrativos',
      'Consultoria técnica comum sem pesquisa',
      'TI genérico (desenvolvimento de software comercial)',
    ],
    condicoes: [
      'PRESTADORA: ICT sem fins lucrativos',
      'TOMADOR: administração pública ou contribuinte do regime regular',
    ],
    consultasTipicas: [
      'pesquisa científica',
      'instituto de pesquisa',
      'inovação tecnológica',
      'pesquisa e desenvolvimento',
    ],
    termosPopulares: [
      'pesquisa', 'pesquisador', 'ict', 'inovacao', 'cientifica',
      'tecnologica', 'instituto', 'desenvolvimento',
    ],
    perguntasRefino: [
      'A prestadora é ICT sem fins lucrativos?',
      'Quem é o tomador (governo ou contribuinte regular)?',
      'É pesquisa/inovação ou consultoria comum?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'FGTS-OP': {
    grupo: 'FGTS-OP',
    cct: '200017',
    cst: '200',
    tituloCurto: 'Operações do FGTS — art. 212 (alíquota zero)',
    rotuloHipotese: 'Operações do FGTS — alíquota zero (art. 212)',
    anexo: '',
    artigo: 'Art. 212 da LC 214/2025',
    reducaoIBS: 100,
    reducaoCBS: 100,
    documentos: ['NFSE'],
    resumo: 'Operações relacionadas ao FGTS (Lei 8.036/1990) realizadas pelo Conselho Curador ou pela Secretaria Executiva do FGTS, com alíquota zero de IBS e CBS (art. 212 da LC 214/2025). Hipótese legal (200/200017), sem NBS vinculado.',
    quandoSeAplica: [
      'Operações do FGTS pelo Conselho Curador',
      'Atuação da Secretaria Executiva do FGTS',
    ],
    quandoNaoSeAplica: [
      'Banco comum fora do circuito do FGTS',
      'Empréstimo ou crédito pessoal comum',
    ],
    condicoes: ['AGENTE: Conselho Curador ou Secretaria Executiva do FGTS'],
    consultasTipicas: ['operações do fgts', 'fgts conselho curador'],
    termosPopulares: ['fgts', 'curador', 'conselho'],
    perguntasRefino: ['O agente é do circuito oficial do FGTS?'],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'FIN-IMPORT': {
    grupo: 'FIN-IMPORT',
    cct: '200019',
    cst: '200',
    tituloCurto: 'Importador de serviço financeiro com crédito — art. 231 (zero)',
    rotuloHipotese: 'Importação de serviço financeiro — alíquota zero (art. 231)',
    anexo: '',
    artigo: 'Art. 231 da LC 214/2025',
    reducaoIBS: 100,
    reducaoCBS: 100,
    documentos: ['NFSE'],
    resumo: 'Importador de serviços financeiros que seja contribuinte e tenha direito à apropriação de créditos na aquisição do mesmo serviço no País, com alíquota zero de IBS e CBS (art. 231 da LC 214/2025). Hipótese legal (200/200019), sem NBS vinculado.',
    quandoSeAplica: [
      'Importação de serviço financeiro por contribuinte',
      'Com direito a crédito do mesmo serviço adquirido no País',
    ],
    quandoNaoSeAplica: [
      'Importador sem direito a crédito correspondente',
      'Serviço financeiro doméstico comum (regime próprio)',
    ],
    condicoes: [
      'CONTRIBUINTE com direito de apropriação de créditos',
      'MESMO serviço adquirido no País',
    ],
    consultasTipicas: ['importação de serviço financeiro'],
    termosPopulares: ['importador', 'importacao', 'financeiro', 'credito', 'creditos'],
    perguntasRefino: [
      'O importador é contribuinte com direito ao crédito?',
      'É o mesmo serviço adquirido no País?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'COOP': {
    grupo: 'COOP',
    cct: '200020',
    cst: '200',
    tituloCurto: 'Cooperativas em regime específico — art. 271 (alíquota zero)',
    rotuloHipotese: 'Operação com cooperativa — alíquota zero (art. 271)',
    anexo: '',
    artigo: 'Art. 271 da LC 214/2025',
    reducaoIBS: 100,
    reducaoCBS: 100,
    documentos: ['NFE', 'NFCE', 'CTE', 'NFSE'],
    resumo: 'Operação de sociedade cooperativa optante pelo regime específico: associado destina bem ou serviço à cooperativa e a cooperativa fornece bem ou serviço a associado do regime regular, com alíquota zero de IBS e CBS (art. 271 da LC 214/2025). Hipótese legal (200/200020), sem NBS vinculado.',
    quandoSeAplica: [
      'Associado destina produção/serviço à sua cooperativa',
      'Cooperativa fornece a associado do regime regular',
      'Cooperativa optante pelo regime específico',
    ],
    quandoNaoSeAplica: [
      'Cooperativa fora do regime específico',
      'Venda a não associado (verificar enquadramento)',
    ],
    condicoes: [
      'COOPERATIVA optante pelo regime específico',
      'FLUXO associado ↔ cooperativa',
    ],
    consultasTipicas: [
      'cooperativa',
      'cooperado',
      'operação com cooperativa',
    ],
    termosPopulares: [
      'cooperativa', 'cooperativas', 'cooperado', 'associado',
      'cooperativismo',
    ],
    perguntasRefino: [
      'A cooperativa optou pelo regime específico?',
      'É fluxo associado ↔ cooperativa?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Conforme a operação (NFe, NFCe, CTe ou NFSE).',
  },
  'TRANSP-PUB': {
    grupo: 'TRANSP-PUB',
    cct: '200021',
    cst: '200',
    tituloCurto: 'Transporte público ferroviário/hidroviário — art. 285 (zero)',
    rotuloHipotese: 'Transporte público trilhos/águas — alíquota zero (art. 285)',
    anexo: '',
    artigo: 'Art. 285 da LC 214/2025',
    reducaoIBS: 100,
    reducaoCBS: 100,
    documentos: ['NFSE'],
    resumo: 'Serviços de transporte público coletivo de passageiros ferroviário e hidroviário, urbanos, semiurbanos e metropolitanos, com alíquota zero de IBS e CBS (art. 285 da LC 214/2025). Hipótese legal (200/200021), sem NBS vinculado.',
    quandoSeAplica: [
      'Metrô, trem metropolitano e transporte sobre trilhos urbano',
      'Barcas e transporte hidroviário urbano de passageiros',
    ],
    quandoNaoSeAplica: [
      'Ônibus rodoviário comum (outro enquadramento)',
      'Táxi, uber e transporte individual',
      'Fretamento privado e transporte de carga',
    ],
    condicoes: [
      'MODAL: ferroviário ou hidroviário',
      'COLETIVO de passageiros, urbano/semiurbano/metropolitano',
    ],
    consultasTipicas: ['metrô', 'trem metropolitano', 'barca', 'transporte hidroviário'],
    termosPopulares: [
      'ferroviario', 'hidroviario', 'metro', 'metroviario',
      'metropolitanos', 'urbano', 'urbanos', 'coletivo', 'trem',
      'barca', 'transporte', 'passageiros',
    ],
    perguntasRefino: [
      'É ferroviário ou hidroviário (não rodoviário)?',
      'É transporte público coletivo urbano de passageiros?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'EDU-PROUNI': {
    grupo: 'EDU-PROUNI',
    cct: '200025',
    cst: '200',
    tituloCurto: 'Educação ProUni — art. 308 (−60% IBS, zero CBS)',
    rotuloHipotese: 'Educação ProUni — zero CBS (art. 308)',
    anexo: '',
    artigo: 'Art. 308 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 100,
    documentos: ['NFSE'],
    resumo: 'Serviços de educação do Programa Universidade para Todos (ProUni, Lei 11.096/2005), com redução de 60% do IBS e alíquota zero de CBS (art. 308 da LC 214/2025). Hipótese legal (200/200025), sem NBS vinculado — distinta do 200/200028 (educação geral).',
    quandoSeAplica: [
      'Cursos em instituição aderente ao ProUni',
      'Bolsas e vagas do programa',
    ],
    quandoNaoSeAplica: [
      'Curso fora do ProUni (avaliar 200/200028, −60%)',
      'Escola livre sem vínculo com o programa',
    ],
    condicoes: ['VÍNCULO com o ProUni (Lei 11.096/2005)'],
    consultasTipicas: ['faculdade prouni', 'bolsa prouni', 'universidade prouni'],
    termosPopulares: ['prouni', 'universidade', 'universitario', 'faculdade', 'educacao'],
    perguntasRefino: [
      'A instituição é aderente ao ProUni?',
      'É curso superior (bolsa) do programa?',
    ],
    cnaeDivisoes: ['85'],
    documentosNota: 'Emitido por NFSE.',
  },
  'LOC-REAB': {
    grupo: 'LOC-REAB',
    cct: '200026',
    cst: '200',
    tituloCurto: 'Locação em zona reabilitada — art. 158 (−80%, 5 anos)',
    rotuloHipotese: 'Locação em zona reabilitada — redução de 80% (art. 158)',
    anexo: '',
    artigo: 'Art. 158 da LC 214/2025',
    reducaoIBS: 80,
    reducaoCBS: 80,
    documentos: ['NFSE'],
    resumo: 'Locação de imóveis em zonas reabilitadas (históricas ou áreas críticas de recuperação), pelo prazo de 5 anos do habite-se, com redução de 80% de IBS e CBS (art. 158 da LC 214/2025). Hipótese legal (200/200026), sem NBS vinculado.',
    quandoSeAplica: [
      'Aluguel de imóvel em zona histórica reabilitada',
      'Dentro dos 5 anos contados do habite-se',
      'Zona delimitada por lei municipal/distrital',
    ],
    quandoNaoSeAplica: [
      'Fora de zona delimitada (avaliar 200/200027)',
      'Após os 5 anos do habite-se',
      'Imóvel novo comum fora de reabilitação',
    ],
    condicoes: [
      'ZONA delimitada por lei municipal ou distrital',
      'PRAZO: 5 anos do habite-se',
    ],
    consultasTipicas: ['aluguel em zona histórica', 'locação em área reabilitada'],
    termosPopulares: ['locacao', 'aluguel', 'reabilitacao', 'reabilitar', 'historica', 'historicas', 'imovel', 'zona', 'habite'],
    perguntasRefino: [
      'O imóvel está em zona reabilitada delimitada em lei?',
      'Está dentro dos 5 anos do habite-se?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'LOCACAO': {
    grupo: 'LOCACAO',
    cct: '200027',
    cst: '200',
    tituloCurto: 'Locação e arrendamento de imóveis — art. 261 (−70%)',
    rotuloHipotese: 'Locação de imóveis — redução de 70% (art. 261)',
    anexo: '',
    artigo: 'Art. 261 da LC 214/2025',
    reducaoIBS: 70,
    reducaoCBS: 70,
    documentos: ['NFSE'],
    resumo: 'Locação, cessão onerosa e arrendamento de bens imóveis, com redução de 70% de IBS e CBS (art. 261 da LC 214/2025). Hipótese legal (200/200027), sem NBS vinculado.',
    quandoSeAplica: [
      'Aluguel residencial e comercial',
      'Arrendamento de imóvel',
      'Cessão onerosa de uso de imóvel',
    ],
    quandoNaoSeAplica: [
      'Venda do imóvel (operação com bem — avaliar 200/200046)',
      'Hospedagem e hotel (200/200048)',
      'Zona reabilitada nos 5 anos (200/200026, −80%)',
    ],
    condicoes: ['OPERAÇÃO: locação, cessão onerosa ou arrendamento de imóvel'],
    consultasTipicas: ['aluguel', 'arrendamento de imóvel', 'cessão de imóvel', 'aluguel comercial'],
    termosPopulares: ['locacao', 'aluguel', 'arrendamento', 'cessao', 'imovel', 'imoveis', 'alugar'],
    perguntasRefino: [
      'É locação, cessão ou arrendamento (não venda nem hospedagem)?',
      'Está em zona reabilitada nos 5 anos (pode ser −80%)?',
    ],
    cnaeDivisoes: ['68'],
    documentosNota: 'Emitido por NFSE.',
  },
  'AMBIENTAL': {
    grupo: 'AMBIENTAL',
    cct: '200037',
    cst: '200',
    tituloCurto: 'Serviços ambientais de vegetação nativa — art. 137 (−60%)',
    rotuloHipotese: 'Serviços ambientais — redução de 60% (art. 137)',
    anexo: '',
    artigo: 'Art. 137 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFSE'],
    resumo: 'Serviços ambientais de conservação ou recuperação da vegetação nativa — inclusive sob manejo sustentável agroflorestal — com redução de 60% de IBS e CBS (art. 137 da LC 214/2025). Hipótese legal (200/200037), sem NBS vinculado.',
    quandoSeAplica: [
      'Recuperação de mata e vegetação nativa',
      'Conservação ambiental certificada',
      'Manejo sustentável agroflorestal conforme a legislação',
    ],
    quandoNaoSeAplica: [
      'Jardinagem ornamental urbana comum',
      'Desmatamento e supressão',
      'Consultoria sem execução vinculada (verificar)',
    ],
    condicoes: [
      'VEGETAÇÃO NATIVA (não jardim ornamental)',
      'Conformidade com a legislação específica',
    ],
    consultasTipicas: ['recuperação de mata nativa', 'conservação ambiental', 'reflorestamento'],
    termosPopulares: ['ambiental', 'ambientais', 'vegetacao', 'nativa', 'conservacao', 'recuperacao', 'reflorestamento', 'manejo', 'mata', 'floresta'],
    perguntasRefino: [
      'É vegetação nativa (não jardim ou paisagismo)?',
      'Há conformidade com a legislação ambiental específica?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'COMUN-PUB': {
    grupo: 'COMUN-PUB',
    cct: '200040',
    cst: '200',
    tituloCurto: 'Comunicação institucional p/ governo — art. 140 (−60%)',
    rotuloHipotese: 'Comunicação p/ governo — redução de 60% (art. 140)',
    anexo: '',
    artigo: 'Art. 140 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFSE'],
    resumo: 'Serviços de comunicação institucional para a administração pública (sites, redes sociais, SEO, imprensa) com redução de 60% de IBS e CBS (art. 140 da LC 214/2025). Hipótese legal (200/200040), sem NBS vinculado.',
    quandoSeAplica: [
      'Site institucional e páginas de prefeitura/órgão',
      'Gestão de redes sociais do governo',
      'Assessoria de imprensa pública',
    ],
    quandoNaoSeAplica: [
      'Publicidade e marketing para empresa privada',
      'Site comercial comum',
      'Propaganda eleitoral (regras próprias)',
    ],
    condicoes: [
      'TOMADOR PÚBLICO + objeto institucional',
    ],
    consultasTipicas: ['site para prefeitura', 'assessoria de imprensa pública', 'redes sociais do governo'],
    termosPopulares: ['comunicacao', 'comunic', 'institucional', 'instit', 'imprensa', 'prefeitura', 'municipio', 'admin'],
    perguntasRefino: [
      'O tomador é órgão público?',
      'O objeto é comunicação institucional (não marketing privado)?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'Emitido por NFSE.',
  },
  'ESPORTE': {
    grupo: 'ESPORTE',
    cct: '200041',
    cst: '200',
    tituloCurto: 'Desporto: educação e gestão federada — art. 141 (−60%)',
    rotuloHipotese: 'Atividade desportiva federada — redução de 60% (art. 141)',
    anexo: '',
    artigo: 'Art. 141 da LC 214/2025',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFSE'],
    resumo: 'Educação desportiva e gestão/exploração do desporto por associações e clubes filiados (ingressos, sócio-torcedor, cessão de direitos), com redução de 60% de IBS e CBS (art. 141 da LC 214/2025: 200/200041 e 200/200042). Hipótese legal, sem NBS vinculado.',
    quandoSeAplica: [
      'Escolinha e educação desportiva federada',
      'Clube/associação filiada com gestão e ingressos',
      'Sócio-torcedor e cessão de direitos desportivos',
    ],
    quandoNaoSeAplica: [
      'Academia comum sem federação',
      'Evento sem vínculo desportivo federado (avaliar Anexo X)',
      'E-sports sem enquadramento (verificar)',
    ],
    condicoes: [
      'FEDERAÇÃO: clube/associação filiada ao órgão estadual/federal (p/ gestão)',
      'Educação desportiva ou exploração federada',
    ],
    consultasTipicas: ['escolinha de futebol', 'sócio-torcedor', 'clube', 'ingressos'],
    termosPopulares: ['esporte', 'esportivo', 'desportiva', 'desportivas', 'desporto', 'futebol', 'clube', 'clubes', 'ingresso', 'ingressos', 'atleta', 'torcedor', 'academia', 'federacao'],
    perguntasRefino: [
      'O clube/associação é filiado à federação?',
      'É educação desportiva ou gestão/exploração?',
    ],
    cnaeDivisoes: ['93'],
    documentosNota: 'Emitido por NFSE.',
  },
  'IMOVEL': {
    grupo: 'IMOVEL',
    cct: '200046',
    cst: '200',
    tituloCurto: 'Operações com bens imóveis — art. 261 (−50%)',
    rotuloHipotese: 'Operações com imóveis — redução de 50% (art. 261)',
    anexo: '',
    artigo: 'Art. 261 da LC 214/2025',
    reducaoIBS: 50,
    reducaoCBS: 50,
    documentos: ['NFSE'],
    resumo: 'Operações com bens imóveis com redução de 50% de IBS e CBS (art. 261 da LC 214/2025). Hipótese legal (200/200046), sem NBS vinculado — confirmar o enquadramento frente à locação (200/200027).',
    quandoSeAplica: [
      'Operações imobiliárias do art. 261 (confirmar enquadramento)',
    ],
    quandoNaoSeAplica: [
      'Locação pura (200/200027, −70%)',
      'Zona reabilitada nos 5 anos (200/200026, −80%)',
      'Hospedagem (200/200048)',
    ],
    condicoes: ['Enquadramento no art. 261 — confirmar com o contador'],
    consultasTipicas: ['operação com imóvel'],
    termosPopulares: ['imovel', 'imoveis', 'imobiliario'],
    perguntasRefino: [
      'É locação, venda ou outra operação com o imóvel?',
      'Não seria locação (200/200027) ou zona reabilitada (200/200026)?',
    ],
    cnaeDivisoes: ['68'],
    documentosNota: 'Emitido por NFSE.',
  },
  'HOTEL': {
    grupo: 'HOTEL',
    cct: '200048',
    cst: '200',
    tituloCurto: 'Hotelaria e parques — art. 281 (−40%)',
    rotuloHipotese: 'Hotelaria e parques — redução de 40% (art. 281)',
    anexo: '',
    artigo: 'Art. 281 da LC 214/2025',
    reducaoIBS: 40,
    reducaoCBS: 40,
    documentos: ['NFSE'],
    resumo: 'Hotelaria, parques de diversão e parques temáticos, com redução de 40% de IBS e CBS (art. 281 da LC 214/2025). Hipótese legal (200/200048), sem NBS vinculado.',
    quandoSeAplica: [
      'Hotel, pousada e resort',
      'Parque de diversões e parque temático',
    ],
    quandoNaoSeAplica: [
      'Aluguel residencial por temporada comum (avaliar locação)',
      'Restaurante avulso sem hospedagem',
    ],
    condicoes: ['Atividade hoteleira ou de parque (não aluguel residencial)'],
    consultasTipicas: ['hotel', 'resort', 'parque de diversões', 'pousada'],
    termosPopulares: ['hotelaria', 'hotel', 'resort', 'parque', 'parques', 'diversao', 'tematico', 'tematicos', 'pousada', 'hospedagem', 'motel'],
    perguntasRefino: [
      'É hotel/pousada/parque (não aluguel residencial)?',
    ],
    cnaeDivisoes: ['55'],
    documentosNota: 'Emitido por NFSE.',
  },
  'TURISMO': {
    grupo: 'TURISMO',
    cct: '200051',
    cst: '200',
    tituloCurto: 'Agências de turismo — art. 289 (−40%)',
    rotuloHipotese: 'Agências de turismo — redução de 40% (art. 289)',
    anexo: '',
    artigo: 'Art. 289 da LC 214/2025',
    reducaoIBS: 40,
    reducaoCBS: 40,
    documentos: ['NFSE'],
    resumo: 'Agências de turismo com redução de 40% de IBS e CBS (art. 289 da LC 214/2025). Hipótese legal (200/200051), sem NBS vinculado.',
    quandoSeAplica: [
      'Agência de viagens e pacotes turísticos',
      'Operação turística por agência',
    ],
    quandoNaoSeAplica: [
      'Transporte avulso sem agência',
      'Hotel avulso sem agência',
      'Guia autônomo sem agência (verificar)',
    ],
    condicoes: ['AGÊNCIA de turismo (não só transporte ou hotel)'],
    consultasTipicas: ['agência de viagens', 'pacote turístico', 'agência de turismo'],
    termosPopulares: ['turismo', 'agencia', 'pacote', 'viagem', 'viagens', 'turistico', 'receptivo'],
    perguntasRefino: [
      'É agência de turismo (não só transporte ou hotel)?',
    ],
    cnaeDivisoes: ['79'],
    documentosNota: 'Emitido por NFSE.',
  },
  'DIFER-INSUMO': {
    grupo: 'DIFER-INSUMO',
    cct: '515001',
    cst: '515',
    tituloCurto: 'Diferimento em insumos agropecuários — art. 138/Anexo IX',
    rotuloHipotese: 'Insumos agropecuários — diferimento (art. 138)',
    anexo: 'IX',
    artigo: 'Art. 138 da LC 214/2025 (Anexo IX)',
    reducaoIBS: 60,
    reducaoCBS: 60,
    documentos: ['NFE', 'NFSE'],
    resumo: 'Operações com insumos agropecuários e aquícolas sujeitas a DIFERIMENTO (art. 138, Anexo IX): o pagamento é adiado nos termos legais — não é redução definitiva. Hipótese (515/515001), sem NBS vinculado na base de serviços.',
    quandoSeAplica: [
      'Venda de insumos agropecuários do Anexo IX com diferimento',
      'Ração, adubo e sementes enquadrados com diferimento',
    ],
    quandoNaoSeAplica: [
      'Bem fora do Anexo IX',
      'Consumo final urbano sem diferimento',
    ],
    condicoes: [
      'DIFERIMENTO (adiamento, não isenção) — verificar o momento do pagamento',
      'Insumo do Anexo IX',
    ],
    consultasTipicas: ['insumo agropecuário', 'diferimento de insumo'],
    termosPopulares: ['diferimento', 'insumo', 'insumos', 'agropecuario', 'agropecuarios', 'aquicola', 'aquicolas'],
    perguntasRefino: [
      'O insumo está no Anexo IX?',
      'A operação é com diferimento (quando se paga)?',
    ],
    cnaeDivisoes: [],
    documentosNota: 'NFe ou NFSE, conforme a operação.',
  },
}

/** Índice compacto dos 107 NBS: código → grupo/cluster/vínculos reais. */
export const ITENS_CONTEXTO_NBS: ItemContextoNbs[] = [
  { nbs: '101057000', grupo: 'ART-X', cluster: '10105', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111031000', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: true, multiEnquadramento: false },
  { nbs: '111032100', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111032200', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111032300', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111032900', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033100', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033200', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033300', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033400', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033500', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033610', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033620', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033690', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111033900', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111034100', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111034200', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111034300', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111035000', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111039000', grupo: 'ART-X', cluster: '11103', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111061000', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111062000', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063100', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063200', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063300', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063400', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063500', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063610', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063620', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063690', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111063900', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111064100', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111064200', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111064300', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111065000', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111069000', grupo: 'ART-X', cluster: '11106', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111071000', grupo: 'ART-X', cluster: '11107', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111073100', grupo: 'ART-X', cluster: '11107', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111073200', grupo: 'ART-X', cluster: '11107', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '111074000', grupo: 'ART-X', cluster: '11107', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '115012000', grupo: 'ADM-XI', cluster: '11501', ccts: ['200043', '200044'], documentos: ['NFCE', 'NFE', 'NFSE'], representante: true, multiEnquadramento: true },
  { nbs: '115029000', grupo: 'ADM-XI', cluster: '11502', ccts: ['200043', '200044'], documentos: ['NFCE', 'NFE', 'NFSE'], representante: false, multiEnquadramento: true },
  { nbs: '115100000', grupo: 'ADM-XI', cluster: '11510', ccts: ['200043', '200044'], documentos: ['NFCE', 'NFE', 'NFSE'], representante: false, multiEnquadramento: true },
  { nbs: '117041000', grupo: 'ART-X', cluster: '11704', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '117042000', grupo: 'ART-X', cluster: '11704', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '118053200', grupo: 'ART-X', cluster: '11805', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '118066100', grupo: 'ART-X', cluster: '11806', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '118066200', grupo: 'ART-X', cluster: '11806', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '118066300', grupo: 'ART-X', cluster: '11806', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '120013500', grupo: 'CIBER-XI', cluster: '12001', ccts: ['200043', '200044'], documentos: ['NFCE', 'NFE', 'NFSE'], representante: true, multiEnquadramento: true },
  { nbs: '120018300', grupo: 'CIBER-XI', cluster: '12001', ccts: ['200043', '200044'], documentos: ['NFCE', 'NFE', 'NFSE'], representante: false, multiEnquadramento: true },
  { nbs: '122011100', grupo: 'EDU', cluster: '12201', ccts: ['200028'], documentos: ['NFSE'], representante: true, multiEnquadramento: false },
  { nbs: '122011200', grupo: 'EDU', cluster: '12201', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122011900', grupo: 'EDU', cluster: '12201', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122012000', grupo: 'EDU', cluster: '12201', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122013000', grupo: 'EDU', cluster: '12201', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122020000', grupo: 'EDU', cluster: '12202', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122031000', grupo: 'EDU', cluster: '12203', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122032000', grupo: 'EDU', cluster: '12203', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122041000', grupo: 'EDU', cluster: '12204', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122042000', grupo: 'EDU', cluster: '12204', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122043000', grupo: 'EDU', cluster: '12204', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122044000', grupo: 'EDU', cluster: '12204', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '122051300', grupo: 'EDU', cluster: '12205', ccts: ['200028'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123011100', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: true, multiEnquadramento: false },
  { nbs: '123011200', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123011300', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123011400', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123011500', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123011900', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123012100', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123012200', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123012300', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019100', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019200', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019300', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019400', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019500', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019600', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019700', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019800', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123019900', grupo: 'SAUDE', cluster: '12301', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123021000', grupo: 'SAUDE', cluster: '12302', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123022100', grupo: 'SAUDE', cluster: '12302', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123022200', grupo: 'SAUDE', cluster: '12302', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '123022300', grupo: 'SAUDE', cluster: '12302', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125011100', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125011200', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125012100', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125012200', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125013100', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125013200', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125013300', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125013400', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125013500', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125013600', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125013700', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125015000', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125019000', grupo: 'ART-X', cluster: '12501', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125021000', grupo: 'ART-X', cluster: '12502', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125022000', grupo: 'ART-X', cluster: '12502', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125023000', grupo: 'ART-X', cluster: '12502', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125029000', grupo: 'ART-X', cluster: '12502', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125031000', grupo: 'ART-X', cluster: '12503', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125032000', grupo: 'ART-X', cluster: '12503', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '125041100', grupo: 'ART-X', cluster: '12504', ccts: ['200039'], documentos: ['NFE', 'NFSE'], representante: false, multiEnquadramento: false },
  { nbs: '126030000', grupo: 'SAUDE', cluster: '12603', ccts: ['200029'], documentos: ['NFSE'], representante: false, multiEnquadramento: false },
]

/** Visão pronta para a descrição preditiva (grupo + item fundidos). */
export interface ContextoNbsView {
  nbs: string
  grupo: GrupoNbsId
  tituloCurto: string
  cluster: string
  anexo: string
  artigo: string
  reducaoIBS: number
  reducaoCBS: number
  resumo: string
  quandoSeAplica: string[]
  quandoNaoSeAplica: string[]
  condicoes: string[]
  perguntasRefino: string[]
  documentos: string[]
  ccts: string[]
  multiEnquadramento: boolean
  nota: string | null
  representante: boolean
}

const _porNbs = new Map<string, ItemContextoNbs>(
  ITENS_CONTEXTO_NBS.map((i) => [i.nbs, i]),
)

/** Contexto personalizado do NBS, ou `null` se fora dos 107 da LC 214. */
export function obterContextoNbs(codigo: unknown): ContextoNbsView | null {
  const dig = String(codigo ?? '').replace(/\D+/g, '')
  if (!/^\d{9}$/.test(dig)) return null
  const item = _porNbs.get(dig)
  if (!item) return null
  const g = GRUPOS_CONTEXTO_NBS[item.grupo]
  return {
    nbs: item.nbs,
    grupo: item.grupo,
    tituloCurto: g.tituloCurto,
    cluster: item.cluster,
    anexo: g.anexo,
    artigo: g.artigo,
    reducaoIBS: g.reducaoIBS,
    reducaoCBS: g.reducaoCBS,
    resumo: g.resumo,
    quandoSeAplica: g.quandoSeAplica,
    quandoNaoSeAplica: g.quandoNaoSeAplica,
    condicoes: g.condicoes,
    perguntasRefino: g.perguntasRefino,
    documentos: item.documentos,
    ccts: item.ccts,
    multiEnquadramento: item.multiEnquadramento,
    nota: item.multiEnquadramento ? NOTA_DUAL_XI : null,
    representante: item.representante,
  }
}

/** Todos os NBS de um grupo (para auditoria/cobertura). */
export function nbsDoGrupo(grupo: GrupoNbsId): string[] {
  return ITENS_CONTEXTO_NBS.filter((i) => i.grupo === grupo).map((i) => i.nbs)
}

/** Tokens do contexto para a camada de match (`origem: 'contexto-personalizado'`). */
export function tokensDoContexto(grupo: GrupoNbsId): string[] {
  const g = GRUPOS_CONTEXTO_NBS[grupo]
  return [...g.termosPopulares]
}

/** Grupo pelo cct (inclui 200052 → PROF-30, sem NBS vinculado). */
export function grupoDoCct(cct: unknown): GrupoNbsId | null {
  const dig = String(cct ?? '').replace(/\D+/g, '')
  if (!dig) return null
  const achado = (Object.values(GRUPOS_CONTEXTO_NBS) as GrupoContextoNbs[]).find((g) => g.cct === dig)
  if (achado) return achado.grupo
  // ccts aparentados sem grupo próprio (mesmo benefício/condições do grupo).
  return CCT_GRUPO_RELACIONADO[dig] ?? null
}

/** cct → grupo do benefício correspondente (gestão desportiva = ESPORTE). */
const CCT_GRUPO_RELACIONADO: Record<string, GrupoNbsId> = {
  '200042': 'ESPORTE',
}

/**
 * Visão de grupo sem NBS direto (para hipóteses como 200/200052).
 * `nbs` vazio: a UI exibe o contexto sem código — nunca como decisão.
 */
export function viewDoGrupo(grupo: GrupoNbsId, cct?: string | null): ContextoNbsView | null {
  const g = GRUPOS_CONTEXTO_NBS[grupo]
  if (!g) return null
  return {
    nbs: '',
    grupo,
    tituloCurto: g.tituloCurto,
    cluster: '',
    anexo: g.anexo,
    artigo: g.artigo,
    reducaoIBS: g.reducaoIBS,
    reducaoCBS: g.reducaoCBS,
    resumo: g.resumo,
    quandoSeAplica: g.quandoSeAplica,
    quandoNaoSeAplica: g.quandoNaoSeAplica,
    condicoes: g.condicoes,
    perguntasRefino: g.perguntasRefino,
    documentos: g.documentos,
    ccts: cct ? [cct] : [g.cct],
    multiEnquadramento: false,
    nota: null,
    representante: false,
  }
}

/**
 * Anexo para exibição ("II", "X", "XI" ou `null`).
 * Códigos internos de regime (ex.: `91271` do 200/200052) NÃO são anexos da
 * LC 214 — exibi-los como "Anexo LC 214 91271" seria falso.
 */
export function anexoLc214ParaExibicao(anexo: unknown): string | null {
  const cru = String(anexo ?? '').trim().toUpperCase()
  if (!cru) return null
  if (/^(1[0-5]|[1-9])$/.test(cru)) {
    const romano: Record<string, string> = {
      '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI',
      '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X', '11': 'XI', '12': 'XII',
      '13': 'XIII', '14': 'XIV', '15': 'XV',
    }
    return romano[cru] ?? cru
  }
  if (/^[IVX]+$/.test(cru)) return cru
  return null
}
