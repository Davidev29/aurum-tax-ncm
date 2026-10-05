/**
 * Direção IA → Aurinha — script de interação direta entre a Aurum AI e as
 * animações da pet.
 *
 * Problema que resolve: antes a IA (classificador fiscal) e a pet (humores e
 * ambientes) viviam em mundos separados — a pet reagia a eventos genéricos
 * (toast ok/err, loading on/off) sem saber O QUE a IA decidiu. Este módulo é
 * a ponte: todo output relevante da IA vira uma `DirecaoPet` (humor + frase +
 * ambiente de braços + eureka), com constância (cada resultado distinto
 * dispara exatamente uma direção) e sem spam (cooldown por regra + guarda de
 * humor ocupado).
 *
 * Desenho (leve e testável):
 * - `dirigirPetPorIA` é pura (sinal + `rand` → direção ou `null`) — cobre os
 *   15 humores e os 81 ambientes, incluindo o Pacote 4 de braços com física.
 * - `notificarIAPet` é a casca com estado (cooldown + palco livre + aplica).
 * - `useDirecaoIADaAurinha` é o script vivo: assina os stores da Consulta
 *   (NCM), Serviços (NBS), Calculadora, Lote e NF-e e traduz cada transição
 *   em sinal. Montado no `PetAurum` DEPOIS de `useReacoesDaAurinha`, então em
 *   transições sobrepostas a direção rica da IA vence (last-writer-wins com
 *   batch do React — sem glitch visual).
 */

import { useEffect, useRef } from 'react'
import type { SituacaoAurumAI } from '@/application/aurum-ai-contexto'
import { useConsulta } from './consulta'
import { usePet, type PetMood } from './pet'

/* --------------------------------- sinais --------------------------------- */

/** Todo output da IA que merece reação visível da Aurinha. */
export type SinalIAPet =
  | { tipo: 'veredito-ncm'; situacao: SituacaoAurumAI; codigo: string; confianca: number; termo?: string }
  | { tipo: 'veredito-nbs'; exigeVerificacao: boolean; codigo: string; confianca: number; termo?: string }
  | { tipo: 'ia-pensando'; origem: 'consulta' | 'servicos' | 'lote' | 'calculadora' | 'xml'; termo?: string }
  | { tipo: 'lote-progresso'; feitos: number; total: number }
  | { tipo: 'lote-concluido'; total: number; comClassificacao: number }
  | { tipo: 'ncm-invalido'; termo: string }
  | { tipo: 'busca-zerada'; termo: string }
  | { tipo: 'calculo-item'; totalItens: number }
  | { tipo: 'xml-resumo'; novas: number; erros: number }
  | { tipo: 'sequencia-boa'; sucessos: number }
  | { tipo: 'apoio-erro' }
  | { tipo: 'boas-vindas'; view: string }

/** Para onde a IA manda a pet: humor + fala + corpo (ambiente de braços). */
export interface DirecaoPet {
  regra: string
  mood: PetMood
  frase: string
  /** `data-ambient` forçado (Pacote 4 de braços ou clássicos). */
  ambient?: string
  /** Duração do ambiente forçado (ms) — espelha `AMBIENTES`. */
  ambientMs?: number
  /** Acende a lâmpada de ideia junto (descobertas). */
  eureka?: boolean
  /** Duração do humor (ms) — padrão do `mood` quando omitido. */
  duracaoMs?: number
}

function escolher<T>(lista: readonly T[], rand: () => number): T {
  return lista[Math.floor(rand() * lista.length) % lista.length]!
}

function pct(confianca: number): string {
  const v = Math.max(0, Math.min(1, Number(confianca) || 0))
  return `${Math.round(v * 100)}%`
}

function codigoCurto(codigo: string): string {
  const d = (codigo ?? '').replace(/\D+/g, '')
  if (d.length === 8) return `${d.slice(0, 4)}.${d.slice(4)}`
  if (d.length === 9) return `${d.slice(0, 4)}.${d.slice(4, 7)}.${d.slice(7)}`
  return (codigo ?? '').trim() || '…'
}

/* ------------------------------- diretor puro ------------------------------ */

/**
 * Núcleo puro: traduz um sinal da IA em direção de palco.
 * Retorna `null` quando o melhor comportamento é não interromper.
 */
export function dirigirPetPorIA(sinal: SinalIAPet, rand: () => number = Math.random): DirecaoPet | null {
  switch (sinal.tipo) {
    case 'veredito-ncm': {
      const cod = codigoCurto(sinal.codigo)
      const conf = pct(sinal.confianca)
      if (sinal.situacao === 'beneficio-confirmado') {
        return {
          regra: `veredito:${sinal.codigo}`,
          mood: 'celebrating',
          frase: escolher([
            `Benefício confirmado no ${cod}! Confiança ${conf}!`,
            `Achei redução vigente pro ${cod}! (${conf})`,
          ], rand),
          ambient: 'aplaudir',
          ambientMs: 2200,
          eureka: sinal.confianca >= 0.75,
        }
      }
      if (sinal.situacao === 'hipotese-condicional') {
        return {
          regra: `veredito:${sinal.codigo}`,
          mood: 'curious',
          frase: escolher([
            `Hmm, ${cod} tem hipótese a verificar… confere comigo?`,
            `Farejei condição no ${cod} — abre o veredito!`,
          ], rand),
          ambient: 'focar-binoculo',
          ambientMs: 3000,
        }
      }
      if (sinal.situacao === 'indefinido') {
        return {
          regra: `veredito:${sinal.codigo}`,
          mood: 'thinking',
          frase: `Sem margem pro ${cod}… vou escavar mais!`,
          ambient: 'escavar',
          ambientMs: 2600,
        }
      }
      // tributacao-integral (vigente, sem hipótese)
      return {
        regra: `veredito:${sinal.codigo}`,
        mood: 'happy',
        frase: escolher([
          `${cod}: alíquota cheia, sem mistério! (${conf})`,
          `Regra geral pro ${cod} — apontado e conferido!`,
        ], rand),
        ambient: 'apontar-achado',
        ambientMs: 2600,
      }
    }

    case 'veredito-nbs': {
      const cod = codigoCurto(sinal.codigo)
      if (sinal.exigeVerificacao) {
        return {
          regra: `veredito-nbs:${sinal.codigo}`,
          mood: 'curious',
          frase: `NBS ${cod} pede conferência… lupa nas mãos!`,
          ambient: 'focar-binoculo',
          ambientMs: 3000,
        }
      }
      return {
        regra: `veredito-nbs:${sinal.codigo}`,
        mood: 'happy',
        frase: `NBS ${cod} validado! (${pct(sinal.confianca)})`,
        ambient: 'apontar-achado',
        ambientMs: 2600,
      }
    }

    case 'ia-pensando': {
      const frases: Record<string, string[]> = {
        consulta: ['Confrontando a base oficial…', 'Lendo NCM × tributação…'],
        servicos: ['Conferindo o NBS na base…', 'Lupa nos serviços…'],
        lote: ['Lendo a planilha pra você…', 'Resolvendo NCMs em lote…'],
        calculadora: ['Somando tim-tim por tim-tim…', 'IBS mais CBS… farejando o total…'],
        xml: ['Farejando XMLs…', 'Desenrolando as notas…'],
      }
      return {
        regra: `pensando:${sinal.origem}`,
        mood: sinal.origem === 'consulta' || sinal.origem === 'servicos' ? 'searching' : 'thinking',
        frase: escolher(frases[sinal.origem] ?? ['Pensando…'], rand),
        ambient: sinal.origem === 'lote' ? 'carregar-caixa' : undefined,
        ambientMs: 3400,
      }
    }

    case 'lote-progresso': {
      return {
        regra: 'lote:progresso',
        mood: 'reading',
        frase: `Carregando ${sinal.feitos} de ${sinal.total}… segura a caixa!`,
        ambient: 'carregar-caixa',
        ambientMs: 3400,
      }
    }

    case 'lote-concluido': {
      return {
        regra: 'lote:concluido',
        mood: 'celebrating',
        frase: `Prontinho! ${sinal.comClassificacao} de ${sinal.total} classificados!`,
        ambient: 'aplaudir',
        ambientMs: 2200,
        eureka: true,
      }
    }

    case 'ncm-invalido': {
      const termo = (sinal.termo ?? '').trim().slice(0, 18) || 'esse código'
      return {
        regra: 'ncm-invalido',
        mood: 'angry',
        frase: `Hmm, '${termo}' não é um NCM válido…`,
      }
    }

    case 'busca-zerada': {
      const termo = (sinal.termo ?? '').trim().slice(0, 20) || 'isso'
      return {
        regra: 'busca-zerada',
        mood: 'curious',
        frase: `Nada pra '${termo}'… escavo de outro jeito?`,
        ambient: 'escavar',
        ambientMs: 2600,
      }
    }

    case 'calculo-item': {
      return {
        regra: 'calculo:item',
        mood: 'calculating',
        frase: escolher([
          `Mais um na conta! (${sinal.totalItens} itens)`,
          `Anotado! Confere o total comigo?`,
        ], rand),
        ambient: sinal.totalItens >= 3 ? 'apontar-achado' : undefined,
        ambientMs: 2600,
      }
    }

    case 'xml-resumo': {
      if (sinal.erros > 0) {
        return {
          regra: 'xml:resumo',
          mood: 'curious',
          frase: `${sinal.novas} notas lidas, ${sinal.erros} com erro… vejo uma a uma?`,
          ambient: 'focar-binoculo',
          ambientMs: 3000,
        }
      }
      return {
        regra: 'xml:resumo',
        mood: 'celebrating',
        frase: `${sinal.novas} nota(s) farejadas e guardadas!`,
        ambient: 'acenar-duplo',
        ambientMs: 2400,
      }
    }

    case 'sequencia-boa': {
      return {
        regra: 'sequencia',
        mood: 'celebrating',
        frase: `Você tá imparável! (${sinal.sucessos} seguidas)`,
        ambient: 'malabarismo',
        ambientMs: 3400,
      }
    }

    case 'apoio-erro': {
      return {
        regra: 'apoio',
        mood: 'curious',
        frase: 'Respira… vamos tentar juntos?',
        ambient: 'abraco-quente',
        ambientMs: 2400,
      }
    }

    case 'boas-vindas': {
      const porView: Record<string, { frase: string; ambient: string; ambientMs: number }> = {
        calculadora: { frase: 'Bora simular IBS e CBS!', ambient: 'apontar-achado', ambientMs: 2600 },
        consulta: { frase: 'Vamos caçar NCMs!', ambient: 'focar-binoculo', ambientMs: 3000 },
        lote: { frase: 'Manda a planilha que eu confiro!', ambient: 'carregar-caixa', ambientMs: 3400 },
        nfe: { frase: 'XMLs? Eu adoro farejar XML!', ambient: 'acenar-duplo', ambientMs: 2400 },
        produtos: { frase: 'Vamos cuidar do seu catálogo!', ambient: 'abraco-quente', ambientMs: 2400 },
        auxiliares: { frase: 'Tabelinhas em ordem!', ambient: 'aplaudir', ambientMs: 2200 },
        legislacao: { frase: 'Hora da leitura séria!', ambient: 'focar-binoculo', ambientMs: 3000 },
      }
      const d = porView[sinal.view] ?? { frase: 'Vamos lá!', ambient: 'acenar-duplo', ambientMs: 2400 }
      return { regra: `boas-vindas:${sinal.view}`, mood: 'waving', frase: d.frase, ambient: d.ambient, ambientMs: d.ambientMs }
    }
  }
}

/* --------------------------- casca com estado ------------------------------ */

/** Cooldown por regra (ms) — constância sem spam. */
const COOLDOWN_DIRECAO: Record<string, number> = {
  veredito: 60_000,
  'veredito-nbs': 60_000,
  pensando: 15_000,
  lote: 10_000,
  'ncm-invalido': 8_000,
  'busca-zerada': 20_000,
  calculo: 12_000,
  xml: 30_000,
  sequencia: 15 * 60_000,
  apoio: 10 * 60_000,
  'boas-vindas': 30 * 60_000,
}

/** Humores que a IA pode interromper sem ser rude. */
const PALCO_LIVRE: PetMood[] = ['idle', 'reading', 'searching', 'thinking', 'happy', 'curious', 'calculating', 'waving']

const ultimoPorRegra = new Map<string, number>()

function chaveCooldown(regra: string): { base: string; chave: string } {
  const base = regra.split(':')[0] ?? regra
  return { base, chave: regra }
}

/** Limpa os cooldowns (testes / troca de sessão). */
export function limparCooldownsDirecaoIA(): void {
  ultimoPorRegra.clear()
}

/**
 * Aplica uma direção ao palco: humor + frase + ambiente de braços + eureka.
 * Retorna `true` quando a IA assumiu o palco.
 */
export function executarDirecao(d: DirecaoPet): boolean {
  if (typeof window !== 'undefined') {
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && d.ambient) {
        // Movimento reduzido: a fala continua, o corpo descansa.
        d = { ...d, ambient: undefined }
      }
    } catch { /* segue com ambiente */ }
  }
  const st = usePet.getState()
  if (!PALCO_LIVRE.includes(st.mood)) return false
  st.agir(d.mood, d.frase, d.duracaoMs)
  if (d.ambient) {
    try { st.sugerirAmbiente(d.ambient, d.ambientMs ?? 3000) } catch { /* noop */ }
  }
  if (d.eureka) {
    try { st.dispararEureka() } catch { /* noop */ }
  }
  return true
}

/**
 * Ponto de entrada do script: recebe um sinal da IA, decide e (se o palco
 * estiver livre e fora de cooldown) executa. Retorna `true` quando dirigiu.
 */
export function notificarIAPet(sinal: SinalIAPet, agora = Date.now()): boolean {
  const d = dirigirPetPorIA(sinal)
  if (!d) return false
  const { base, chave } = chaveCooldown(d.regra)
  const cooldown = COOLDOWN_DIRECAO[base] ?? 10_000
  const ultimo = ultimoPorRegra.get(chave) ?? Number.NEGATIVE_INFINITY
  if (ultimo + cooldown > agora) return false
  if (!executarDirecao(d)) return false
  ultimoPorRegra.set(chave, agora)
  return true
}

/* ------------------------------ script vivo -------------------------------- */

/**
 * Script vivo de interação IA → animações. Assina os stores do sistema e
 * traduz cada transição relevante em sinal — é o que mantém as animações
 * realmente alimentadas pela IA, com constância:
 * - todo veredito NCM/NBS distinto vira reação (humor + braços + frase);
 * - todo início de raciocínio vira modo investigativo;
 * - lote e XML narram progresso e conclusão;
 * - calculadora comenta cada item novo.
 *
 * Montar UMA vez (no `PetAurum`, depois de `useReacoesDaAurinha`).
 */
export function useDirecaoIADaAurinha(): void {
  const vistoRef = useRef({ codigo: '', codigoNbs: '', itensCalc: 0 })

  useEffect(() => {
    let vivo = true
    let pararLote: (() => void) | null = null
    let pararNfe: (() => void) | null = null

    const pararConsulta = useConsulta.subscribe((s, ant) => {
      if (!vivo) return
      const ocupadoAgora = s.carregando || s.buscandoTexto || s.classificandoDescricao
      const ocupadoAntes = ant.carregando || ant.buscandoTexto || ant.classificandoDescricao
      if (ocupadoAgora && !ocupadoAntes) {
        notificarIAPet({ tipo: 'ia-pensando', origem: 'consulta', termo: s.entrada || s.descricao })
        return
      }
      if (s.avisoInvalido && !ant.avisoInvalido) {
        notificarIAPet({ tipo: 'ncm-invalido', termo: s.codigo || s.entrada })
        return
      }
      // Veredito novo da Aurum AI (o sinal mais rico: situação + confiança).
      const veredito = s.vereditoIa
      const codigo = s.codigoIa ?? s.resultados[0]?.classificacao.codigo ?? ''
      if (veredito && codigo && (codigo !== vistoRef.current.codigo || veredito !== ant.vereditoIa)) {
        vistoRef.current.codigo = codigo
        notificarIAPet({
          tipo: 'veredito-ncm',
          situacao: veredito.situacao,
          codigo,
          confianca: s.confiancaIa,
          termo: s.entrada || s.descricao,
        })
        return
      }
      if (!ocupadoAgora && ocupadoAntes) {
        const oficiais = s.resultados.length
        const textos = s.resultadosTexto.length
        const temSugestao = Boolean(s.sugestao || s.codigoIa)
        const termo = s.entrada || s.buscaTexto || s.codigo || s.descricao
        if (oficiais + textos === 0 && !temSugestao && termo.trim() && !s.avisoInvalido) {
          notificarIAPet({ tipo: 'busca-zerada', termo })
        }
      }
    })

    let pararServicos: (() => void) | null = null
    void import('./consulta-servicos').then((mod) => {
      if (!vivo) return
      pararServicos = mod.useServicos.subscribe((s, ant) => {
        if (!vivo) return
        const ocupadoAgora = s.carregando || s.buscandoTexto || s.classificandoDescricao
        const ocupadoAntes = ant.carregando || ant.buscandoTexto || ant.classificandoDescricao
        if (ocupadoAgora && !ocupadoAntes) {
          notificarIAPet({ tipo: 'ia-pensando', origem: 'servicos', termo: s.entrada || s.codigo })
          return
        }
        if (s.avisoInvalido && !ant.avisoInvalido) {
          notificarIAPet({ tipo: 'ncm-invalido', termo: s.codigo || s.entrada })
          return
        }
        const codigo = s.codigoIa ?? ''
        if (s.vereditoIa && codigo && (codigo !== vistoRef.current.codigoNbs || s.vereditoIa !== ant.vereditoIa)) {
          vistoRef.current.codigoNbs = codigo
          notificarIAPet({
            tipo: 'veredito-nbs',
            exigeVerificacao: Boolean(s.vereditoIa.exigeVerificacao),
            codigo,
            confianca: s.confiancaIa,
            termo: s.entrada || s.codigo,
          })
        }
      })
    })

    let pararCalc: (() => void) | null = null
    void import('./calculadora').then((mod) => {
      if (!vivo) return
      vistoRef.current.itensCalc = mod.useCalculadora.getState().itens.length
      pararCalc = mod.useCalculadora.subscribe((s, ant) => {
        if (!vivo) return
        if (s.itens.length > ant.itens.length) {
          vistoRef.current.itensCalc = s.itens.length
          notificarIAPet({ tipo: 'calculo-item', totalItens: s.itens.length })
        }
      })
    })

    // Lote e NF-e: narram progresso e conclusão com a voz da IA.
    void import('./lote').then((mod) => {
      if (!vivo) return
      let marcoProgresso = 0
      pararLote = mod.useLote.subscribe((s, ant) => {
        if (!vivo) return
        if (s.processando && !ant.processando) {
          marcoProgresso = 0
          notificarIAPet({ tipo: 'ia-pensando', origem: 'lote' })
          return
        }
        if (s.processando && s.progresso >= marcoProgresso + 50) {
          marcoProgresso = s.progresso
          notificarIAPet({ tipo: 'lote-progresso', feitos: Math.round(s.progresso), total: 100 })
          return
        }
        if (!s.processando && ant.processando && s.resumo) {
          notificarIAPet({
            tipo: 'lote-concluido',
            total: s.resumo.itens.length,
            comClassificacao: s.resumo.itens.filter((i) => i.ncm.length === 8).length,
          })
        }
      })
    })
    void import('./nfe').then((mod) => {
      if (!vivo) return
      pararNfe = mod.useNfe.subscribe((s, ant) => {
        if (!vivo) return
        if (s.processando && !ant.processando) {
          notificarIAPet({ tipo: 'ia-pensando', origem: 'xml' })
          return
        }
        const r = s.ultimoResumo
        if (!s.processando && ant.processando && r && r !== ant.ultimoResumo) {
          notificarIAPet({ tipo: 'xml-resumo', novas: r.novas ?? 0, erros: r.erros?.length ?? 0 })
        }
      })
    })

    return () => {
      vivo = false
      pararConsulta()
      pararServicos?.()
      pararCalc?.()
      pararLote?.()
      pararNfe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Sucesso encadeado: 3+ acertos viram festa com malabarismo. */
export function notificarSequenciaBOA(sucessos: number): boolean {
  return notificarIAPet({ tipo: 'sequencia-boa', sucessos })
}

/** Apoio após erros: abraço quentinho da IA. */
export function notificarApoioErro(): boolean {
  return notificarIAPet({ tipo: 'apoio-erro' })
}

/** Atalho para as boas-vindas por tela (tchau + braços). */
export function notificarBoasVindas(view: string): boolean {
  return notificarIAPet({ tipo: 'boas-vindas', view })
}
