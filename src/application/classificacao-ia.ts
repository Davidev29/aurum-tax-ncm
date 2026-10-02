/**
 * Gate determinístico → fallback Aurum AI — Phase 6 / IA-05 (tracer 06-05).
 *
 * A Aurum AI é camada SUPERIOR, nunca substituta:
 * 1. `classificarPorDescricao()` roda primeiro (tokenização + RGI +
 *    `buscarNomenclaturaPorTexto`). Se devolve `ncm_provavel` com confiança
 *    `alta`, retorna direto com `via: 'deterministico'` — o worker IA nem é
 *    chamado (bypass provado em 06-09).
 * 2. Senão (`null` ou confiança `baixa`/`media`), monta o Top-15 RAG,
 *    enriquece cada candidato com a **ficha absoluta** (nomenclatura +
 *    hierarquia + vínculos + capítulo in natura/art.135 + vigência), pede ao
 *    worker (`window.aurum.ia.classificar` no Electron; seletor Aurum AI local
 *    fora do Electron) e valida a escolha com `resolverClassificacoes`
 *    — nenhuma saída IA chega à UI sem o resolvedor (princípio 2).
 * 3. Falha segura: escolha `NÃO SEI` → `codigoEscolhido: null`, sem código
 *    fictício (princípio 3). Empate no topo também é NÃO SEI (sem chute).
 */
import {
  classificarPorDescricao,
  type EntradaDescricao,
  type SugestaoNcmJson,
} from './classificacao-inteligente'
import {
  buscarNomenclatura,
  buscarNomenclaturaPorTexto,
  resolverClassificacoes,
} from '@/infrastructure/base/classificacao-repo'
import { buscarNoDicionarioComercial } from '@/domain/constants/dicionario-comercial'
import { bridge, type CandidatoIa } from '@/infrastructure/bridge'
import { LIMIAR_NAO_SEI } from '@/domain/aurum-ai'
import {
  ehVerboProvavel,
  MOTIVO_PALAVRA_UNICA_EMPATE,
  MOTIVO_PALAVRA_UNICA_QUALIFICADOR,
  MOTIVO_PALAVRA_UNICA_VERBO,
  qualificadoresNaoComprovados,
} from '@/domain/services/palavra-unica'
import {
  analisarFichaAbsoluta,
  montarFichaAbsoluta,
  pontuarFichaAbsoluta,
  type FichaAbsoluta,
  type VereditoAurumAI,
} from './aurum-ai-contexto'
import type { ViaClassificacao } from '@/store/ia'

export type { ViaClassificacao }

export interface ResultadoGateIa {
  via: ViaClassificacao
  /** Sugestão ancorada do caminho determinístico (contexto/auditoria). */
  sugestao: SugestaoNcmJson
  candidatos: CandidatoIa[]
  codigoEscolhido: string | null
  confiancaIa: number
  motivo: string
  mock: boolean
  /** Validação pelo resolvedor (única fonte de verdade). */
  ncmValidado: string | null
  regraGeral: boolean
  ms: number
  /** Ficha absoluta do NCM escolhido (conjunto de dados lido pela Aurum AI). */
  ficha: FichaAbsoluta | null
  /** Veredito unificado vigente vs hipótese (sem divergência). */
  veredito: VereditoAurumAI | null
  /** Bases lidas nesta predição (auditoria + UI). */
  fontes: string[]
}

function combinarContextoIa(entrada: EntradaDescricao): string {
  return [entrada.descricao, entrada.destinacao ?? '', entrada.composicao ?? '', entrada.uso ?? '']
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Seletor Aurum AI local (fora do Electron ou worker ausente).
 *
 * Lê o conjunto absoluto: descrição + caminho hierárquico + ficha (vínculo,
 * capítulo, vigência) + sinônimos/fuzzy. Regras:
 * - empate no topo → NÃO SEI (não chuta entre iguais), MAS com ficha/veredito
 *   do topo para a UI explicar e dar opções (proativo sem chutar);
 * - confiança < 0.2 → NÃO SEI (idem, enriquecido);
 * - regra geral com hipótese condicional tem o teto em 0.60 (média): a IA
 *   sugere, mas nunca afirma "alta" sem vínculo oficial.
 */
async function selecionarAurumAILocal(
  descricao: string,
  candidatos: CandidatoIa[],
): Promise<{ codigo: string; confianca: number; motivo: string; ficha: FichaAbsoluta | null; veredito: VereditoAurumAI | null }> {
  const { tokensRelevantes } = await import('@/domain/services/busca-texto')
  const { expandirSinonimoFiscal, casaToken } = await import('@/domain/services/vocabulario')
  // Contexto LIMPO: só tokens relevantes (sem "de", "para", "com") + sinônimos.
  // Stopwords no conjunto inflavam todos os candidatos por igual e apagavam a
  // diferença entre o certo e o errado.
  const relevantes = tokensRelevantes(descricao)
  const expandidos = relevantes.map((t) => expandirSinonimoFiscal(t) ?? t)
  const conjunto = new Set([...relevantes, ...expandidos])
  const teto = Math.max(1, relevantes.length)

  // Fichas absolutas em lote (best-effort: sem ficha, avalia só pelo texto).
  const fichas = new Map<string, FichaAbsoluta>()
  for (const c of candidatos.slice(0, 10)) {
    try {
      fichas.set(c.codigo, await montarFichaAbsoluta(c.codigo))
    } catch {
      /* sem ficha: segue pelo texto */
    }
  }

  const pontuados: { c: CandidatoIa; pontosTexto: number; pontosProprios: number; scoreAbsoluto: number; ficha: FichaAbsoluta | null; dict: boolean }[] = []
  // Dicionário comercial: crédito de conhecimento curado. "Parmesão" nunca
  // matcha o texto oficial por similaridade (a palavra ∉ TEC) — o pin vale
  // como 1 termo casado no item próprio, com a mesma força de um sinônimo
  // exato. O resolvedor valida o código ao final (sem alucinação).
  const dictPorCodigo = new Map(
    buscarNoDicionarioComercial(descricao).map((a) => [a.ncm, a.termo]),
  )
  // Aprendizado com feedback: NCMs que o usuário já rejeitou ("Não é esse")
  // para a MESMA descrição perdem força — a IA não repete o erro.
  // Best-effort: sem Dexie, segue sem demote.
  const rejeitados = new Set<string>()
  try {
    const { db } = await import('@/infrastructure/db/schema')
    const fb = await db.table('ia_feedback').orderBy('quando').reverse().limit(30).toArray().catch(() => [])
    const { normalizarBusca } = await import('@/domain/services/busca-texto')
    const alvoNorm = normalizarBusca(descricao)
    for (const r of fb as { descricao?: unknown; decisao?: unknown }[]) {
      if (r?.decisao && normalizarBusca(r.descricao) === alvoNorm) {
        rejeitados.add(String(r.decisao).replace(/\D+/g, ''))
      }
    }
  } catch {
    /* sem feedback: segue sem demote */
  }
  for (const c of candidatos) {
    const ficha = fichas.get(c.codigo) ?? null
    // Texto rico = descrição do item + hierarquia + capítulo (a IA lê tudo),
    // mas o match no item próprio vale mais que o do caminho (precisão).
    // `c.descricao` aqui é a descrição pura do item (sem caminho — o caminho
    // vem da ficha). Assim, "milho"/"bovina" (só no caminho) não viram decisão.
    const descricaoPura = String(c.descricao || '').split(' (')[0]
    const textoRico = [c.descricao, ficha?.caminhoTexto ?? '', ficha?.capitulo.nome ?? ''].join(' ')
    const ctNorm = (await import('@/domain/services/busca-texto')).normalizarBusca(textoRico)
    const toksRico = new Set(ctNorm.split(' ').filter(Boolean))
    const toksProprios = new Set((await import('@/domain/services/busca-texto')).normalizarBusca(descricaoPura).split(' ').filter(Boolean))
    let pontos = 0
    for (const q of conjunto) {
      if (toksRico.has(q)) pontos += 1
      else {
        for (const o of toksRico) {
          if (casaToken(q, o)) {
            pontos += 0.8
            break
          }
        }
      }
    }
    let pontosProprios = 0
    for (const q of conjunto) {
      if (toksProprios.has(q)) pontosProprios += 1
      else {
        for (const o of toksProprios) {
          if (casaToken(q, o)) {
            pontosProprios += 0.8
            break
          }
        }
      }
    }
    const temPinDict = dictPorCodigo.has(c.codigo)
    if (temPinDict) {
      pontos += 1
      pontosProprios += 1
    }
    const pontosTexto = pontosProprios > 0 ? pontosProprios + pontos * 0.5 : pontos * 0.5
    let scoreAbsoluto = ficha ? pontuarFichaAbsoluta(ficha, pontosTexto) : pontosTexto
    // Feedback negativo exato: já rejeitado para esta descrição → perde força
    // (mas continua como pista auditável no Top, nunca some da lista).
    if (rejeitados.has(String(c.codigo).replace(/\D+/g, ''))) scoreAbsoluto -= 500
    pontuados.push({ c, pontosTexto, pontosProprios, scoreAbsoluto, ficha, dict: temPinDict })
  }
  pontuados.sort((a, b) => b.scoreAbsoluto - a.scoreAbsoluto || a.c.codigo.localeCompare(b.c.codigo))
  let topo = pontuados[0]
  let segundo: (typeof pontuados)[number] | undefined = pontuados[1]
  let vereditoTopo = topo?.ficha ? analisarFichaAbsoluta(topo.ficha) : null
  /** Sufixo de auditoria quando a trava de palavra única preferiu o genérico. */
  let sufixoMotivo = ''
  if (!topo || topo.pontosTexto <= 0) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente', ficha: topo?.ficha ?? null, veredito: vereditoTopo }
  }
  // Precisão máxima para termo único genérico: match SÓ no caminho/capítulo
  // (ex.: "milho" só em "Milho.", "bovina" só em "espécie bovina") não decide
  // entre semente/grão ou reprodução/abate — falta contexto. Exige o termo no
  // item próprio (ex.: "gatos" em "Alimentos para cães ou gatos…").
  // Pin do dicionário conta como presença no item (conhecimento curado).
  if (relevantes.length <= 1 && topo.pontosProprios <= 0 && !topo.dict) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente', ficha: topo.ficha, veredito: vereditoTopo }
  }
  // Trava de especificidade sem lastro — palavra única sem contexto (ex.:
  // "chocolate" não pode virar "Chocolate branco"; verbo isolado como
  // "plantar" não vira produto). Com 2+ tokens ou refino preenchido, o
  // contexto comprova a especificidade e a trava não se aplica. Pin do
  // dicionário é conhecimento curado (inequívoco sozinho), nunca bloqueado.
  if (relevantes.length <= 1 && topo && !topo.dict) {
    const unico = relevantes[0] ?? ''
    const puraDe = (cand: CandidatoIa): string => String(cand.descricao || '').split(' (')[0]
    const conjuntoLista = [...conjunto]
    // Verbo provável sem lastro literal na base: a ação não comprova o
    // produto — pede contexto em vez de inferir o substantivo.
    if (unico && ehVerboProvavel(unico)) {
      const { normalizarBusca: normalizar } = await import('@/domain/services/busca-texto')
      let temLiteral = false
      for (const p of pontuados) {
        const toks = normalizar(puraDe(p.c)).split(' ').filter(Boolean)
        if (toks.some((o) => casaToken(unico, o))) {
          temLiteral = true
          break
        }
      }
      if (!temLiteral) {
        return { codigo: 'NÃO SEI', confianca: 0, motivo: MOTIVO_PALAVRA_UNICA_VERBO, ficha: topo.ficha, veredito: vereditoTopo }
      }
    }
    // Específico com qualificador não comprovado + genérico concorrente com
    // lastro: prefere o genérico ("retorna só ele"). Sem desempate entre
    // genéricos (ex.: recheado × não recheado), NÃO SEI — sem contexto não
    // há como escolher a qualidade.
    const extrasTopo = qualificadoresNaoComprovados(puraDe(topo.c), conjuntoLista)
    if (extrasTopo.length > 0) {
      const genericos = pontuados.filter(
        (p) => p.pontosTexto > 0 && qualificadoresNaoComprovados(puraDe(p.c), conjuntoLista).length === 0,
      )
      if (genericos.length > 1) {
        const [g1, g2] = genericos
        if (g1 && g2 && Math.abs(g1.pontosTexto - g2.pontosTexto) < 0.01) {
          return { codigo: 'NÃO SEI', confianca: 0, motivo: MOTIVO_PALAVRA_UNICA_QUALIFICADOR, ficha: g1.ficha, veredito: g1.ficha ? analisarFichaAbsoluta(g1.ficha) : vereditoTopo }
        }
        if (g1) {
          topo = g1
          segundo = genericos[1]
          vereditoTopo = topo.ficha ? analisarFichaAbsoluta(topo.ficha) : vereditoTopo
          sufixoMotivo = '/palavra-unica-generico'
        }
      } else if (genericos.length === 1 && genericos[0] && genericos[0] !== topo) {
        topo = genericos[0]
        // Específicos descartados da disputa (eram chute): sem segundo, sem
        // empate — o genérico decide sozinho.
        segundo = undefined
        vereditoTopo = topo.ficha ? analisarFichaAbsoluta(topo.ficha) : vereditoTopo
        sufixoMotivo = '/palavra-unica-generico'
      }
      // Sem genérico concorrente: mantém o topo (único lastro — ex.: "gatos",
      // "semeadura"). A especificidade aparente é o próprio nome oficial.
    }
  }
  // Empate textual puro no topo (ignorando bônus de vínculo): sem margem
  // textual, sem decisão — o bônus oficial desempataria um chute (precisão >
  // cobertura). Ex.: "milho" empata entre 10051000/10059010 no texto.
  // Dois pins distintos empatados também recusam (ex.: "provolone parmesão").
  const empateDict = Boolean(segundo && topo.dict && segundo.dict && Math.abs(topo.pontosTexto - segundo.pontosTexto) < 0.01)
  if (empateDict) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente', ficha: topo.ficha, veredito: vereditoTopo }
  }
  if (segundo && Math.abs(topo.pontosTexto - segundo.pontosTexto) < 0.01 && topo.pontosTexto <= 1) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente', ficha: topo.ficha, veredito: vereditoTopo }
  }
  // Palavra única sem contexto: qualquer empate textual no topo é NÃO SEI —
  // sem a 2ª palavra não há como desempatar nem entre genéricos (ex.:
  // "Chocolate" recheado × não recheado). Pin curado é exceção (curadoria).
  if (relevantes.length <= 1 && topo && segundo && !topo.dict) {
    if (Math.abs(topo.pontosTexto - segundo.pontosTexto) < 0.01) {
      return { codigo: 'NÃO SEI', confianca: 0, motivo: MOTIVO_PALAVRA_UNICA_EMPATE, ficha: topo.ficha, veredito: vereditoTopo }
    }
  }
  let confianca = Math.round((topo.pontosTexto / teto) * 100) / 100
  confianca = Math.max(0, Math.min(1, confianca))
  if (confianca < LIMIAR_NAO_SEI) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente', ficha: topo.ficha, veredito: vereditoTopo }
  }
  const veredito = vereditoTopo
  // Teto de precisão: regra geral com hipótese nunca é "alta" — é sugestão
  // a verificar, não fato. Cap em 0.60 (média alta).
  if (veredito?.exigeVerificacao && confianca > 0.6) confianca = 0.6
  // NCM extinto nunca é decisão válida do fallback (vira NÃO SEI aqui; o
  // resolvedor confirmaria regra geral histórica — sem valor vigente).
  if (topo.ficha?.extinto) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'ncm-extinto', ficha: topo.ficha, veredito }
  }
  return {
    codigo: topo.c.codigo,
    confianca: Math.round(confianca * 100) / 100,
    motivo: topo.dict ? 'dicionario-comercial' : topo.ficha ? `aurum-ai-ficha-absoluta${sufixoMotivo}` : `mock-overlap${sufixoMotivo}`,
    ficha: topo.ficha,
    veredito,
  }
}

/**
 * Classifica com gate: determinístico primeiro, IA só no fallback.
 * `chamouWorker` (saída) indica se o worker foi acionado — usado pelo teste
 * de bypass determinístico (06-09) e pela métrica `taxa_uso_ia`.
 */
export async function classificarComIa(
  entrada: EntradaDescricao,
  opts?: { aoWorker?: (usou: boolean) => void },
): Promise<ResultadoGateIa> {
  const t0 = Date.now()
  const sugestao = await classificarPorDescricao(entrada)

  // Caminho primário venceu: sem IA.
  if (sugestao.ncm_provavel && sugestao.confianca === 'alta') {
    opts?.aoWorker?.(false)
    return {
      via: 'deterministico',
      sugestao,
      candidatos: [],
      codigoEscolhido: sugestao.ncm_provavel,
      confiancaIa: 0,
      motivo: 'deterministico-alta-confianca',
      mock: false,
      ncmValidado: sugestao.ncm_provavel,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: null,
      veredito: null,
      fontes: [],
    }
  }

  // Barreira anti-alucinação: fora de escopo NÃO acorda o worker.
  // A sugestão já carrega a mensagem fixa (`foraDeEscopo: true`); aqui só
  // garantimos `via` + motivo auditáveis, sem candidatos e sem cálculo.
  if (sugestao.foraDeEscopo) {
    opts?.aoWorker?.(false)
    return {
      via: 'deterministico',
      sugestao,
      candidatos: [],
      codigoEscolhido: null,
      confiancaIa: 0,
      motivo: 'fora-de-escopo',
      mock: false,
      ncmValidado: null,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: null,
      veredito: null,
      fontes: [],
    }
  }

  // Fallback Aurum AI: Top-20 RAG → ficha absoluta → seletor → resolvedor.
  // Contexto MAIOR: combina descrição + destinação + composição + uso (o usuário
  // preenche no "Refinar predição" — antes o RAG lia só a descrição e perdia
  // o contexto). `descricao` do candidato é a descrição pura do item (o
  // caminho/hierarquia a Aurum AI lê via ficha absoluta).
  opts?.aoWorker?.(true)
  const contextoRico = combinarContextoIa(entrada)
  const achados = await buscarNomenclaturaPorTexto(contextoRico || entrada.descricao, 20)
  const candidatos: CandidatoIa[] = achados.map((a) => ({
    codigo: a.codigo,
    descricao: a.descricao,
    score: a.score,
  }))
  // Dicionário comercial: pins curados entram no Top mesmo quando o RAG
  // lexical não os encontra ("parmesão" ∉ TEC). O resolvedor valida abaixo.
  for (const acerto of buscarNoDicionarioComercial(contextoRico || entrada.descricao).slice(0, 6)) {
    if (candidatos.some((c) => c.codigo === acerto.ncm)) continue
    let descricaoPin = `Dicionário comercial (“${acerto.termo}”)`
    try {
      descricaoPin = (await buscarNomenclatura(acerto.ncm))?.descricao ?? descricaoPin
    } catch {
      /* sem nomenclatura: o resolvedor barra o pin abaixo */
    }
    candidatos.push({ codigo: acerto.ncm, descricao: descricaoPin, score: 999 })
  }

  let escolha: { codigo: string; confianca: number; motivo: string; ficha: FichaAbsoluta | null; veredito: VereditoAurumAI | null } = {
    codigo: 'NÃO SEI',
    confianca: 0,
    motivo: 'sem-candidatos',
    ficha: null,
    veredito: null,
  }
  let mock = true
  if (candidatos.length) {
    if (bridge?.ia) {
      try {
        const r = await bridge.ia.classificar(contextoRico || entrada.descricao, candidatos)
        mock = r.mock
        if (r.codigo === 'NÃO SEI') {
          const fichaTopo = await montarFichaAbsoluta(candidatos[0].codigo).catch(() => null)
          escolha = { codigo: 'NÃO SEI', confianca: 0, motivo: r.motivo, ficha: fichaTopo, veredito: fichaTopo ? analisarFichaAbsoluta(fichaTopo) : null }
        } else {
          // Mesmo com worker real, a ficha absoluta é lida aqui (precisão
          // máxima): o worker escolhe entre candidatos, a Aurum AI valida e
          // calibra com o conjunto absoluto antes do resolvedor.
          const ficha = await montarFichaAbsoluta(r.codigo).catch(() => null)
          const veredito = ficha ? analisarFichaAbsoluta(ficha) : null
          let confianca = Math.max(0, Math.min(1, Number(r.confianca) || 0))
          if (veredito?.exigeVerificacao && confianca > 0.6) confianca = 0.6
          escolha = { codigo: r.codigo, confianca: Math.round(confianca * 100) / 100, motivo: r.motivo, ficha, veredito }
        }
      } catch {
        escolha = await selecionarAurumAILocal(contextoRico || entrada.descricao, candidatos)
        mock = true
      }
    } else {
      escolha = await selecionarAurumAILocal(contextoRico || entrada.descricao, candidatos)
    }
  }

  // Segunda chance ortográfica: se a primeira tentativa deu NÃO SEI e o
  // texto tem typos conhecidos, tenta de novo com o texto corrigido.
  // Só a CONSULTA é reescrita — a validação pelo resolvedor continua igual.
  if (escolha.codigo === 'NÃO SEI' && candidatos.length) {
    try {
      const { corrigirTextoConsulta } = await import('@/domain/services/correcao-consulta')
      const { textoCorrigido, correcoes, alterado } = corrigirTextoConsulta(contextoRico || entrada.descricao)
      if (alterado) {
        const achados2 = await buscarNomenclaturaPorTexto(textoCorrigido, 20)
        const candidatos2: CandidatoIa[] = achados2.map((a) => ({
          codigo: a.codigo,
          descricao: a.descricao,
          score: a.score,
        }))
        for (const acerto of buscarNoDicionarioComercial(textoCorrigido).slice(0, 6)) {
          if (candidatos2.some((c) => c.codigo === acerto.ncm)) continue
          let descricaoPin = `Dicionário comercial (“${acerto.termo}”)`
          try {
            descricaoPin = (await buscarNomenclatura(acerto.ncm))?.descricao ?? descricaoPin
          } catch {
            /* sem nomenclatura: o resolvedor barra o pin abaixo */
          }
          candidatos2.push({ codigo: acerto.ncm, descricao: descricaoPin, score: 999 })
        }
        if (candidatos2.length) {
          const escolha2 = await selecionarAurumAILocal(textoCorrigido, candidatos2)
          if (escolha2.codigo !== 'NÃO SEI') {
            escolha = {
              ...escolha2,
              motivo: `${escolha2.motivo}/correcao-ortografica(${correcoes.join(',')})`,
            }
            candidatos.push(...candidatos2.filter((c) => !candidatos.some((x) => x.codigo === c.codigo)))
          }
        }
      }
    } catch {
      /* segunda chance é best-effort */
    }
  }

  const fontes = [
    'Nomenclatura vigente (TEC)',
    'Vínculos oficiais da Reforma (CST × cClassTrib)',
    'Capítulos NCM + flags in natura (Art. 137) e alimentos (Art. 135)',
    'Vigência (NCM extinto · cClassTrib · revogação CFF)',
    ...(escolha.motivo === 'dicionario-comercial' ? ['Dicionário comercial (nomes populares → NCM)'] : []),
    ...(escolha.motivo.includes('correcao-ortografica') ? ['Correção ortográfica (segunda chance)'] : []),
  ]

  if (escolha.codigo === 'NÃO SEI') {
    return {
      via: 'ia',
      sugestao,
      candidatos,
      codigoEscolhido: null,
      confiancaIa: 0,
      motivo: escolha.motivo,
      mock,
      ncmValidado: null,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: escolha.ficha,
      veredito: escolha.veredito,
      fontes,
    }
  }

  // Gate absoluto: só o resolvedor valida (bloqueia alucinação).
  // Exige código HOMOLOGADO na nomenclatura vigente: um worker alucinando
  // `99999999` resolve para regra geral com `nomenclatura: null` — sem
  // nomenclatura não há decisão válida (prova em 06-09 / IA-09).
  // Blindagem total: código não homologado NÃO deixa rastro (ficha/veredito
  // nulos) — o JSON do repositório nunca contém o alucinado.
  const validacao = await resolverClassificacoes(escolha.codigo)
  const valido = validacao.lista.length > 0 && !validacao.extinto && validacao.nomenclatura != null
  if (!valido) {
    return {
      via: 'ia',
      sugestao,
      candidatos,
      codigoEscolhido: escolha.codigo,
      confiancaIa: 0,
      motivo: escolha.motivo,
      mock,
      ncmValidado: null,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: null,
      veredito: null,
      fontes,
    }
  }
  const fichaFinal = escolha.ficha ?? (await montarFichaAbsoluta(escolha.codigo).catch(() => null))
  const vereditoFinal = escolha.veredito ?? (fichaFinal ? analisarFichaAbsoluta(fichaFinal) : null)
  return {
    via: 'ia',
    sugestao,
    candidatos,
    codigoEscolhido: escolha.codigo,
    confiancaIa: escolha.confianca,
    motivo: escolha.motivo,
    mock,
    ncmValidado: escolha.codigo,
    regraGeral: validacao.regraGeral,
    ms: Date.now() - t0,
    ficha: fichaFinal,
    veredito: vereditoFinal,
    fontes,
  }
}
