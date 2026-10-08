/**
 * Gate determinístico → seletor automático local — classificação 100%
 * determinística (sem modelo de linguagem).
 *
 * A decisão do fallback VEM do seletor local ancorado
 * (`selecionarAurumAILocal`, com `mock:true`): RAG lexical + ficha absoluta
 * + resolvedor oficial. O worker LLM foi removido — sem IPC, sem modelo.
 *
 * O seletor automático é camada SUPERIOR, nunca substituta:
 * 1. `classificarPorDescricao()` roda primeiro (tokenização + RGI +
 *    `buscarNomenclaturaPorTexto`). Se devolve `ncm_provavel` com confiança
 *    `alta`, retorna direto com `via: 'deterministico'` — o seletor nem é
 *    chamado (bypass provado em 06-09).
 * 2. Senão (`null` ou confiança `baixa`/`media`), monta o Top-20 RAG,
 *    enriquece cada candidato com a **ficha absoluta** (nomenclatura +
 *    hierarquia + vínculos + capítulo in natura/art.135 + vigência), decide
 *    pelo seletor local e valida a escolha com `resolverClassificacoes`
 *    — nenhuma saída chega à UI sem o resolvedor (princípio 2).
 * 3. Falha segura: `NÃO SEI` → `codigoEscolhido: null`, sem código
 *    fictício (princípio 3). NÃO SEI vale SÓ sem lastro oficial (zero
 *    candidatos ou overlap zero); com correspondência na base oficial, o
 *    seletor sugere hipótese provisória baixa ancorada (a verificar), nunca 0% seco.
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
import type { CandidatoIa } from '@/infrastructure/bridge'
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
  montarFichasAbsolutas,
  pontuarFichaAbsoluta,
  type FichaAbsoluta,
  type VereditoAurumAI,
} from './aurum-ai-contexto'
import type { ViaClassificacao } from '@/store/ia'
import {
  consultarGrafoPrimeiro,
  fundirCandidatosGrafoLexical,
  trilhaVazia,
  type TrilhaGrafo,
} from './grafo-consumo'
import {
  normalizarBusca,
  tokensRelevantes,
} from '@/domain/services/busca-texto'
import {
  casaToken,
  expandirSinonimoFiscal,
} from '@/domain/services/vocabulario'
import { calibrarConfiancaFinal } from '@/domain/aurum-ai'

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
  /**
   * Trilha do grafo (Phase 10-05 / GRAFO-05): cypher executado + caminhos
   * multi-hop + proveniência. `null` quando o grafo não respondeu
   * (fallback lexical bit-idêntico).
   */
  grafoCypher?: string | null
  graphPaths?: string[][]
  caminhoGrafo?: string[] | null
  provenienciaGrafo?: Array<{
    de: string
    para: string
    tipo: string
    origem: string
    confianca: number
    anoReferencia?: number | null
  }> | null
  boostGrafo?: 'uso_local' | null
  boostValorGrafo?: number
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
 * capítulo, vigência) + sinônimos/fuzzy. Política de cobertura ancorada:
 * - NÃO SEI **só** quando não há nenhuma referência interna (zero candidatos
 *   ou overlap textual zero) — sem lastro, sem chute;
 * - quando a base oficial TEM correspondências (overlap > 0), a IA SEMPRE
 *   decide por uma hipótese provisória ancorada (confiança baixa, a verificar),
 *   nunca 0% seco — mesmo com palavra única, empate ou caminho-hierárquico.
 *   O resolvedor valida o código ao final (sem alucinação) e a UI pede refino.
 * - regra geral com hipótese condicional tem o teto em 0.60 (média): a IA
 *   sugere, mas nunca afirma "alta" sem vínculo oficial;
 * - hipótese provisória por ambiguidade tem o teto em 0.35 (baixa): sugere o
 *   melhor lastro oficial, mas sinaliza que precisa de 1–2 detalhes.
 */
async function selecionarAurumAILocal(
  descricao: string,
  candidatos: CandidatoIa[],
  _trilhaGrafo?: TrilhaGrafo,
): Promise<{ codigo: string; confianca: number; motivo: string; ficha: FichaAbsoluta | null; veredito: VereditoAurumAI | null }> {
  void _trilhaGrafo
  // Contexto LIMPO: só tokens relevantes (sem "de", "para", "com") + sinônimos.
  // Stopwords no conjunto inflavam todos os candidatos por igual e apagavam a
  // diferença entre o certo e o errado.
  // v2: imports estáticos (sem `await import` por chamada) + expansão em lote.
  const relevantes = tokensRelevantes(descricao)
  const expandidos = relevantes.map((t) => expandirSinonimoFiscal(t) ?? t)
  const conjunto = new Set([...relevantes, ...expandidos])
  const teto = Math.max(1, relevantes.length)

  // Fichas absolutas em lote e em paralelo (1 toArray partilhado, não 10
  // sequenciais). Best-effort: sem ficha, avalia só pelo texto.
  const fichas = new Map<string, FichaAbsoluta>()
  try {
    const lote = await montarFichasAbsolutas(candidatos.slice(0, 10).map((c) => c.codigo))
    for (const f of lote) fichas.set(String(f.codigo).replace(/\D+/g, ''), f)
    for (const c of candidatos.slice(0, 10)) {
      if (!fichas.has(c.codigo) && !fichas.has(String(c.codigo).replace(/\D+/g, ''))) {
        try {
          fichas.set(c.codigo, await montarFichaAbsoluta(c.codigo))
        } catch {
          /* sem ficha: segue pelo texto */
        }
      }
    }
  } catch {
    /* sem fichas: segue pelo texto */
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
  // Best-effort: sem SQLite, segue sem demote. v2: import estático do schema.
  const rejeitados = new Set<string>()
  try {
    const { db } = await import('@/infrastructure/db/schema')
    const fb = await db.table('ia_feedback').orderBy('quando').reverse().limit(30).toArray().catch(() => [])
    const alvoNorm = normalizarBusca(descricao)
    for (const r of fb as { descricao?: unknown; decisao?: unknown }[]) {
      if (r?.decisao && normalizarBusca(r.descricao) === alvoNorm) {
        rejeitados.add(String(r.decisao).replace(/\D+/g, ''))
      }
    }
  } catch {
    /* sem feedback: segue sem demote */
  }
  // Normalização ÚNICA por candidato (antes: 2 normalizarBusca + 4 splits por
  // candidato por consulta). Conjuntos pré-computados fora do loop de `q`.
  const normPorCodigo = new Map<string, { toksRico: Set<string>; toksProprios: Set<string> }>()
  for (const c of candidatos) {
    const ficha = fichas.get(c.codigo) ?? fichas.get(String(c.codigo).replace(/\D+/g, '')) ?? null
    const descricaoPura = String(c.descricao || '').split(' (')[0]
    const textoRico = [c.descricao, ficha?.caminhoTexto ?? '', ficha?.capitulo.nome ?? ''].join(' ')
    normPorCodigo.set(c.codigo, {
      toksRico: new Set(normalizarBusca(textoRico).split(' ').filter(Boolean)),
      toksProprios: new Set(normalizarBusca(descricaoPura).split(' ').filter(Boolean)),
    })
  }
  for (const c of candidatos) {
    const ficha = fichas.get(c.codigo) ?? fichas.get(String(c.codigo).replace(/\D+/g, '')) ?? null
    const { toksRico, toksProprios } = normPorCodigo.get(c.codigo) ?? { toksRico: new Set<string>(), toksProprios: new Set<string>() }
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
    // Pensamento v2: bônus de capítulo coerente + pin entram no score absoluto
    // (antes só o vínculo contava) — evidências convergentes se somam.
    let scoreAbsoluto = ficha
      ? pontuarFichaAbsoluta(ficha, pontosTexto, { bonusPin: temPinDict ? 10 : 0 })
      : pontosTexto
    // Blindagem contextual "vivo × vírus vivo" (correção Frango Vivo):
    // "vivo" como ESTADO do animal (cap. 01) nunca pode puxar vacina/medicamento
    // (cap. 30, "a vírus vivo"). Se a query fala de animal + vivo sem citar
    // vacina/vírus/doença/medicamento, o candidato 3002/3004 perde força total.
    // Mesma lógica: fruta sem citar suco/processado não puxa cap. 20; ferro
    // bruto sem citar obra não puxa cap. 73/84.
    try {
      const qNorm = normalizarBusca(descricao)
      const falaAnimal = /(frango|franga|galinha|galo|pintinho|ave|aves|chester|peru|pato|ganso|codorna|avestruz|ema|boi|bovin|vaca|suin|porco|cavalo|egua|potro|ovelha|carneiro|cordeiro|cabra|bode|cabrito|coelho|lebre|jacare|repteis|serpente|cobra|tartaruga|papagaio|arara|periquito|gaviao|falcao|macaco|sagui|primata|abelha|ovo|ovos|gema|figado|lingua|moela|peixe|camarao)/.test(qNorm)
      const falaVivo = /(^| )vivo( |$)|viva|vivos|vivas/.test(qNorm) || /(^| )vivo( |$)/.test(normalizarBusca(descricao))
      const falaVacina = /(vacina|virus|doenca|medicamento|farmaco|soro|antinfeccioso)/.test(qNorm)
      const codLimpo = String(c.codigo).replace(/\D+/g, '')
      const cap2 = codLimpo.slice(0, 2)
      if (falaAnimal && falaVivo && !falaVacina && (cap2 === '30' || codLimpo.startsWith('3002'))) {
        scoreAbsoluto -= 500
      }
      // "vivo" isolado sem contexto de doença nunca decide por 3002: exige a
      // palavra vacina/vírus na query, senão o 3002 nem entra no topo.
      if (!falaVacina && codLimpo.startsWith('30024270')) {
        const soVivo = !/(vacina|virus|newcastle|gumboro|bronquite|difteroviruela|salmonelose|colera)/.test(qNorm)
        if (soVivo) scoreAbsoluto -= 300
      }
    } catch {
      /* blindagem best-effort */
    }
    // Feedback negativo exato: já rejeitado para esta descrição → perde força
    // (mas continua como pista auditável no Top, nunca some da lista).
    if (rejeitados.has(String(c.codigo).replace(/\D+/g, ''))) scoreAbsoluto -= 500
    // Grafo primeiro (10-05): candidato vindo do grafo ganha bônus de desempate
    // (+2) + boost de uso local já com teto. Só reordena — o resolvedor decide.
    // Sem grafo (fallback), `viaGrafo` é undefined e o score é bit-idêntico.
    const ehGrafo = Boolean((c as CandidatoIa).viaGrafo)
    if (ehGrafo) scoreAbsoluto += 2
    const boostLocal = Number((c as CandidatoIa).boostValorGrafo) || 0
    if (boostLocal > 0) scoreAbsoluto += Math.min(boostLocal, 0.3)
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
  // Cobertura ancorada: match SÓ no caminho/capítulo (ex.: "cavalo" em
  // "Cavalos, asininos e muares, vivos.") É lastro oficial real — a IA decide
  // por hipótese provisória (baixa, a verificar) em vez de 0% seco. Prefere o
  // genérico ("Outros") ao específico sem lastro quando houver; senão, o topo.
  // Pin do dicionário conta como presença no item (conhecimento curado).
  // NÃO SEI aqui só quando não há overlap algum (caso acima).
  if (relevantes.length <= 1 && topo.pontosProprios <= 0 && !topo.dict) {
    const puraDeCaminho = (cand: CandidatoIa): string => String(cand.descricao || '').split(' (')[0]
    const conjuntoListaCaminho = [...conjunto]
    const genericosCaminho = pontuados.filter(
      (p) => p.pontosTexto > 0 && qualificadoresNaoComprovados(puraDeCaminho(p.c), conjuntoListaCaminho).length === 0,
    )
    const escolhidoCaminho = genericosCaminho[0] ?? topo
    const vereditoCaminho = escolhidoCaminho.ficha ? analisarFichaAbsoluta(escolhidoCaminho.ficha) : vereditoTopo
    if (escolhidoCaminho.ficha?.extinto) {
      return { codigo: 'NÃO SEI', confianca: 0, motivo: 'ncm-extinto', ficha: escolhidoCaminho.ficha, veredito: vereditoCaminho }
    }
    return {
      codigo: escolhidoCaminho.c.codigo,
      confianca: escolhidoCaminho.ficha && !escolhidoCaminho.ficha.regraGeral ? 0.35 : 0.3,
      motivo: `pista-ancorada-base-oficial/caminho-hierarquico${genericosCaminho.length ? '/palavra-unica-generico' : ''}`,
      ficha: escolhidoCaminho.ficha,
      veredito: vereditoCaminho,
    }
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
      let temLiteral = false
      for (const p of pontuados) {
        const toks = normalizarBusca(puraDe(p.c)).split(' ').filter(Boolean)
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
    // lastro: prefere o genérico ("retorna só ele"). Entre genéricos empatados
    // (ex.: recheado × não recheado, "Outros" × "Outros"), sem contexto não há
    // como escolher a qualidade — mas há lastro oficial, então a IA sugere o
    // primeiro genérico como hipótese provisória (baixa, a verificar) em vez
    // de NÃO SEI seco. NÃO SEI fica só para o sem-lastro (caso acima).
    const extrasTopo = qualificadoresNaoComprovados(puraDe(topo.c), conjuntoLista)
    if (extrasTopo.length > 0) {
      const genericos = pontuados.filter(
        (p) => p.pontosTexto > 0 && qualificadoresNaoComprovados(puraDe(p.c), conjuntoLista).length === 0,
      )
      if (genericos.length > 1) {
        const [g1, g2] = genericos
        if (g1 && g2 && Math.abs(g1.pontosTexto - g2.pontosTexto) < 0.01) {
          const vereditoEmpate = g1.ficha ? analisarFichaAbsoluta(g1.ficha) : vereditoTopo
          if (g1.ficha?.extinto) {
            return { codigo: 'NÃO SEI', confianca: 0, motivo: 'ncm-extinto', ficha: g1.ficha, veredito: vereditoEmpate }
          }
          return {
            codigo: g1.c.codigo,
            confianca: 0.3,
            motivo: `${MOTIVO_PALAVRA_UNICA_QUALIFICADOR}/pista-ancorada-base-oficial/empate-genericos`,
            ficha: g1.ficha,
            veredito: vereditoEmpate,
          }
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
  // Empate no topo: há lastro oficial empatado (ex.: "milho" entre 10051000/
  // 10059010, "cavalo" entre os 4 do cap. 01). Em vez de NÃO SEI seco, a IA
  // pensa com os dados do sistema (ficha/vínculo/capítulo já ranquearam no
  // score absoluto) e sugere o topo como hipótese provisória baixa, a
  // verificar com 1–2 detalhes. Dois pins distintos empatados também sugerem
  // (ex.: "provolone parmesão" → primeiro pin, a verificar).
  const empateDict = Boolean(segundo && topo.dict && segundo.dict && Math.abs(topo.pontosTexto - segundo.pontosTexto) < 0.01)
  if (empateDict) {
    if (topo.ficha?.extinto) {
      return { codigo: 'NÃO SEI', confianca: 0, motivo: 'ncm-extinto', ficha: topo.ficha, veredito: vereditoTopo }
    }
    return {
      codigo: topo.c.codigo,
      confianca: 0.3,
      motivo: 'empate-pins-ancorado/pista-ancorada-base-oficial',
      ficha: topo.ficha,
      veredito: vereditoTopo,
    }
  }
  if (segundo && Math.abs(topo.pontosTexto - segundo.pontosTexto) < 0.01 && topo.pontosTexto <= 1) {
    if (topo.ficha?.extinto) {
      return { codigo: 'NÃO SEI', confianca: 0, motivo: 'ncm-extinto', ficha: topo.ficha, veredito: vereditoTopo }
    }
    return {
      codigo: topo.c.codigo,
      confianca: 0.3,
      motivo: 'empate-textual-ancorado/pista-ancorada-base-oficial',
      ficha: topo.ficha,
      veredito: vereditoTopo,
    }
  }
  // Palavra única sem contexto empatada (ex.: "Chocolate" recheado × não
  // recheado): sugere o topo como provisória baixa em vez de NÃO SEI — o
  // lastro oficial existe, a UI lista as alternativas e pede o detalhe.
  // Pin curado continua exceção (curadoria decide sozinho, sem teto extra).
  if (relevantes.length <= 1 && topo && segundo && !topo.dict) {
    if (Math.abs(topo.pontosTexto - segundo.pontosTexto) < 0.01) {
      if (topo.ficha?.extinto) {
        return { codigo: 'NÃO SEI', confianca: 0, motivo: 'ncm-extinto', ficha: topo.ficha, veredito: vereditoTopo }
      }
      return {
        codigo: topo.c.codigo,
        confianca: 0.3,
        motivo: `${MOTIVO_PALAVRA_UNICA_EMPATE}/pista-ancorada-base-oficial`,
        ficha: topo.ficha,
        veredito: vereditoTopo,
      }
    }
  }
  // Confiança calibrada multi-fator (meta ≥0.85 nos casos claros, sem contar
  // exceções/hipóteses). Antes: overlap puro `pontosTexto/teto` — um único
  // sinal, sem convergir vínculo/pin/margem. Agora: base textual (55%) +
  // margem de desempate + vínculo oficial + pin curado + contexto rico.
  const baseTexto = topo.pontosTexto / teto
  const margemTopo = segundo ? Math.max(0, topo.pontosTexto - segundo.pontosTexto) : 999
  let confianca = calibrarConfiancaFinal({
    baseTexto,
    margem: margemTopo >= 999 ? 30 : margemTopo * 10,
    temVinculo: Boolean(topo.ficha && !topo.ficha.regraGeral),
    temPin: topo.dict,
    tokens: relevantes.length,
  })
  if (confianca < LIMIAR_NAO_SEI) {
    // Cobertura ancorada: overlap existe (lastro oficial), mas a calibragem
    // ficou abaixo do corte. Em vez de NÃO SEI seco, sugere o topo com o piso
    // (0,20) como hipótese fraca a verificar — NÃO SEI fica só para o
    // sem-overlap (caso lá de cima).
    if (topo.ficha?.extinto) {
      return { codigo: 'NÃO SEI', confianca: 0, motivo: 'ncm-extinto', ficha: topo.ficha, veredito: vereditoTopo }
    }
    return {
      codigo: topo.c.codigo,
      confianca: LIMIAR_NAO_SEI,
      motivo: `similaridade-fraca-ancorada/pista-ancorada-base-oficial${sufixoMotivo}`,
      ficha: topo.ficha,
      veredito: vereditoTopo,
    }
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
 * Classifica com gate: determinístico primeiro, seletor automático no fallback.
 * `aoWorker` (saída) indica se o fallback foi acionado — usado pelo teste
 * de bypass determinístico (06-09) e pela métrica `taxa_uso_ia`.
 * (Nome histórico: hoje não há worker; `true` = usou o seletor automático.)
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
  // Phase 10-05 (GRAFO-05): grafo PRIMEIRO — antes do Top-20 lexical. Sem
  // `.lbug`/sem canal (`ok:false`), segue bit-idêntico ao pré-grafo.
  opts?.aoWorker?.(true)
  const contextoRico = combinarContextoIa(entrada)
  // Modelo multilíngue nativo: o contexto vai puro ao RAG (sem camada de
  // tradução — anexar o EN quebrava o AND estrito na TEC).
  const textoBusca = contextoRico || entrada.descricao
  let trilhaGrafo: TrilhaGrafo = trilhaVazia()
  let respostaGrafo: import('@/infrastructure/bridge').ResultadoGrafoBridge | null = null
  try {
    const g = await consultarGrafoPrimeiro(textoBusca, 5)
    trilhaGrafo = g.trilha
    respostaGrafo = g.resposta
  } catch {
    trilhaGrafo = trilhaVazia()
    respostaGrafo = null
  }
  const achados = await buscarNomenclaturaPorTexto(textoBusca, 20)
  let lexicais: CandidatoIa[] = achados.map((a) => ({
    codigo: a.codigo,
    descricao: a.descricao,
    score: a.score,
  }))
  // Destinação/uso/composição são CONTEXTO para desempate, não termo de busca:
  // "frango vivo para abate" com AND estrito em "abate" zerava o lexical (TEC
  // do 0105 não contém "abate"). Se o contexto rico zerou, tenta a descrição
  // pura do produto antes de desistir.
  if (!lexicais.length && textoBusca !== entrada.descricao) {
    try {
      const achadosPuros = await buscarNomenclaturaPorTexto(entrada.descricao, 20)
      lexicais = achadosPuros.map((a) => ({
        codigo: a.codigo,
        descricao: a.descricao,
        score: a.score,
      }))
    } catch {
      /* mantém vazio — vira sem-lastro honesto abaixo */
    }
  }
  // Última bala: produto puro sem destinação ("frango vivo para abate" →
  // "frango vivo"). A destinação decide o desempate (01 vivo × 02 carne), mas
  // nunca pode zerar a busca — a TEC do vivo não cita "abate".
  if (!lexicais.length) {
    try {
      let puro = String(entrada.descricao ?? '')
      for (const ctx of [entrada.destinacao, entrada.composicao, entrada.uso]) {
        if (ctx) {
          puro = puro.split(ctx)[0]
          puro = puro.replace(new RegExp(`\\b${String(ctx).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ')
        }
      }
      puro = puro.replace(/\s+para\s+.*$/i, '').replace(/\s+/g, ' ').trim()
      if (puro && puro !== textoBusca && puro !== entrada.descricao) {
        const achadosNucleo = await buscarNomenclaturaPorTexto(puro, 20)
        lexicais = achadosNucleo.map((a) => ({
          codigo: a.codigo,
          descricao: a.descricao,
          score: a.score,
        }))
      }
    } catch {
      /* mantém vazio */
    }
  }
  // Dicionário comercial: pins curados entram no Top mesmo quando o RAG
  // lexical não os encontra ("parmesão" ∉ TEC). O resolvedor valida abaixo.
  for (const acerto of buscarNoDicionarioComercial(textoBusca).slice(0, 6)) {
    if (lexicais.some((c) => c.codigo === acerto.ncm)) continue
    let descricaoPin = `Dicionário comercial (“${acerto.termo}”)`
    try {
      descricaoPin = (await buscarNomenclatura(acerto.ncm))?.descricao ?? descricaoPin
    } catch {
      /* sem nomenclatura: o resolvedor barra o pin abaixo */
    }
    lexicais.push({ codigo: acerto.ncm, descricao: descricaoPin, score: 999 })
  }
  // Fusão: grafo primeiro, dedupe por código. Sem grafo → lexical intacto.
  const candidatos: CandidatoIa[] = fundirCandidatosGrafoLexical(respostaGrafo, lexicais, trilhaGrafo)
  const usouGrafo = trilhaGrafo.usouGrafo
  const viaBase: ViaClassificacao = usouGrafo ? 'grafo' : 'ia'

  let escolha: { codigo: string; confianca: number; motivo: string; ficha: FichaAbsoluta | null; veredito: VereditoAurumAI | null } = {
    codigo: 'NÃO SEI',
    confianca: 0,
    motivo: 'sem-candidatos',
    ficha: null,
    veredito: null,
  }
  const mock = true
  if (candidatos.length) {
    // Seletor automático local (determinístico): RAG lexical + ficha absoluta
    // + vínculo + capítulo + vigência. Sem modelo, sem IPC.
    escolha = await selecionarAurumAILocal(contextoRico || entrada.descricao, candidatos, trilhaGrafo)
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
          // Segunda chance sempre pelo seletor local (determinístico).
          const escolha2 = await selecionarAurumAILocal(textoCorrigido, candidatos2, trilhaGrafo)
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
    'Base oficial · correspondências por nome (NCMs avaliados no Top)',
    ...(usouGrafo ? ['Grafo fiscal local (FTS + vetor + 2-hops, caminho auditável)'] : []),
    ...(escolha.motivo === 'dicionario-comercial' ? ['Dicionário comercial (nomes populares → NCM)'] : []),
    ...(escolha.motivo.includes('pista-ancorada-base-oficial') || escolha.motivo.includes('ancorado')
      ? ['Hipótese provisória ancorada — lastro oficial com confiança baixa, a verificar com 1–2 detalhes']
      : []),
    ...(escolha.motivo.includes('correcao-ortografica') ? ['Correção ortográfica (segunda chance)'] : []),
    ...(escolha.motivo.includes('segunda-opiniao') ? ['Segunda opinião ancorada (worker recusou, seletor reavaliou o Top oficial)'] : []),
  ]
  // Motivo carrega a trilha auditável quando o grafo participou (cypher vai
  // para `audit_log` + `.jsonl` + DebugIA via `grafoCypher`).
  const motivoComGrafo = usouGrafo && trilhaGrafo.cypher
    ? `${escolha.motivo}/via-grafo`
    : escolha.motivo
  const grafoTrilha = usouGrafo
    ? {
        grafoCypher: trilhaGrafo.cypher,
        graphPaths: trilhaGrafo.caminhos,
        caminhoGrafo: escolha.codigo !== 'NÃO SEI'
          ? (trilhaGrafo.caminhoPorCodigo.get(String(escolha.codigo).replace(/\D+/g, '')) ?? null)
          : null,
        provenienciaGrafo: escolha.codigo !== 'NÃO SEI'
          ? (trilhaGrafo.provenienciaPorCodigo.get(String(escolha.codigo).replace(/\D+/g, '')) ?? null)
          : null,
        boostGrafo: escolha.codigo !== 'NÃO SEI'
          ? (trilhaGrafo.boostPorCodigo.get(String(escolha.codigo).replace(/\D+/g, ''))?.boost ?? null)
          : null,
        boostValorGrafo: escolha.codigo !== 'NÃO SEI'
          ? (trilhaGrafo.boostPorCodigo.get(String(escolha.codigo).replace(/\D+/g, ''))?.valor ?? 0)
          : 0,
      }
    : {
        grafoCypher: null,
        graphPaths: [],
        caminhoGrafo: null,
        provenienciaGrafo: null,
        boostGrafo: null,
        boostValorGrafo: 0,
      }

  if (escolha.codigo === 'NÃO SEI') {
    return {
      via: viaBase,
      sugestao,
      candidatos,
      codigoEscolhido: null,
      confiancaIa: 0,
      motivo: motivoComGrafo,
      mock,
      ncmValidado: null,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: escolha.ficha,
      veredito: escolha.veredito,
      fontes,
      ...grafoTrilha,
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
      via: viaBase,
      sugestao,
      candidatos,
      codigoEscolhido: escolha.codigo,
      confiancaIa: 0,
      motivo: motivoComGrafo,
      mock,
      ncmValidado: null,
      regraGeral: false,
      ms: Date.now() - t0,
      ficha: null,
      veredito: null,
      fontes,
      ...grafoTrilha,
    }
  }
  const fichaBase = escolha.ficha ?? (await montarFichaAbsoluta(escolha.codigo).catch(() => null))
  // Enriquecimento da ficha com o caminho do grafo (só com proveniência).
  const fichaFinal = fichaBase
    ? {
        ...fichaBase,
        ...(grafoTrilha.caminhoGrafo ? { grafoCaminho: grafoTrilha.caminhoGrafo } : {}),
        ...(grafoTrilha.grafoCypher ? { grafoCypher: grafoTrilha.grafoCypher } : {}),
        ...(grafoTrilha.provenienciaGrafo ? { grafoProveniencia: grafoTrilha.provenienciaGrafo } : {}),
        ...(grafoTrilha.boostGrafo ? { grafoBoost: grafoTrilha.boostGrafo, grafoBoostValor: grafoTrilha.boostValorGrafo } : {}),
      }
    : null
  const vereditoFinal = escolha.veredito ?? (fichaFinal ? analisarFichaAbsoluta(fichaFinal) : null)
  return {
    via: viaBase,
    sugestao,
    candidatos,
    codigoEscolhido: escolha.codigo,
    confiancaIa: escolha.confianca,
    motivo: motivoComGrafo,
    mock,
    ncmValidado: escolha.codigo,
    regraGeral: validacao.regraGeral,
    ms: Date.now() - t0,
    ficha: fichaFinal,
    veredito: vereditoFinal,
    fontes,
    ...grafoTrilha,
  }
}
