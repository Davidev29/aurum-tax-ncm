/**
 * Ambientes da Aurinha — os 42 comportamentos autônomos que rodam de forma
 * natural e aleatória quando ela está livre (`idle` na doca).
 *
 * Desenho:
 * - 100% puro e testável: `sortearAmbiente` não toca em DOM/store — recebe
 *   o id anterior (para não repetir) e uma função `rand` injetável.
 * - Sorteio PONDERADO por `peso` (raridade): comportamentos comuns (peso 3)
 *   saem ~3x mais que raros (peso 1). `rand` uniform em [0,1) vira faixa
 *   proporcional ao peso acumulado — determinístico nos testes.
 * - O CSS (`pet-aurum.css`, seção AMBIENTES) interpreta `data-ambient`
 *   como overlay de UMA apresentação (`animation … 1`); o hook em
 *   `PetAurum.tsx` (`useAmbienteDaAurinha`) liga/desliga o atributo e
 *   respeita `prefers-reduced-motion`, aba oculta e humor ocupado.
 * - Durações curtas (2–4 s) + intervalo longo e irregular (9–17 s) = ela
 *   parece viva, nunca mecânica. Sem frase no store (não briga com o balão).
 * - Locomoção de fundo (ir de um lado ao outro da sidebar) NÃO mora aqui:
 *   é o `useLocomocaoDaAurinha` (JS, contínuo, sem snap). Os ambientes de
 *   locomoção abaixo são *estilos* (trote, furtiva, marcha…) que compõem
 *   com o deslocamento — todos começam e terminam neutros.
 */

export type CategoriaAmbiente = 'vida' | 'brincadeira' | 'trabalho' | 'social' | 'base'

export interface AmbientePet {
  /** Vira `data-ambient` no `.pet-aurum` — contrato com o CSS. */
  id: string
  /** Quanto tempo o atributo fica ligado (ms) — = duração da animação CSS. */
  duracaoMs: number
  /** Descrição curta para docs/testes. */
  descricao: string
  /** Raridade no sorteio: 3 = comum, 2 = médio, 1 = raro. Padrão 2. */
  peso?: number
  /** Agrupamento temático — evita dois da mesma leva em sequência futura. */
  categoria?: CategoriaAmbiente
}

/** Os 42 comportamentos autônomos — ordem = catálogo, não prioridade. */
export const AMBIENTES: readonly AmbientePet[] = [
  { id: 'espiar', duracaoMs: 2600, descricao: 'espia de lado, curiosa com algo fora da tela', peso: 2, categoria: 'base' },
  { id: 'espreguicar', duracaoMs: 2800, descricao: 'espreguiça longa com squash & stretch', peso: 2, categoria: 'base' },
  { id: 'bocejar', duracaoMs: 3000, descricao: 'bocejo com boquinha em "o" e olhos fechados', peso: 2, categoria: 'base' },
  { id: 'cocar', duracaoMs: 2200, descricao: 'coça a orelha com tremidinha rápida', peso: 2, categoria: 'base' },
  { id: 'farejar-chao', duracaoMs: 3200, descricao: 'abaixa a cabeça e fareja o chão em tercinas', peso: 2, categoria: 'base' },
  { id: 'polir-lupa', duracaoMs: 3000, descricao: 'ergue a lupinha, gira e dá brilho na lente', peso: 2, categoria: 'base' },
  { id: 'girar', duracaoMs: 2400, descricao: 'rodopia atrás do próprio rabo', peso: 2, categoria: 'base' },
  { id: 'cochilar', duracaoMs: 3800, descricao: 'quase dorme e acorda com susto', peso: 1, categoria: 'base' },
  { id: 'dancar', duracaoMs: 2600, descricao: 'passinho feliz de dois pulinhos', peso: 2, categoria: 'base' },
  { id: 'chamar', duracaoMs: 2800, descricao: 'espicha e acena a lupinha chamando o humano', peso: 2, categoria: 'base' },
  /* --- Locomoção (estilos que compõem com o passeio JS) --- */
  { id: 'trotar', duracaoMs: 2400, descricao: 'trote rápido no lugar, patinhas ligeiras', peso: 2, categoria: 'base' },
  { id: 'ronda', duracaoMs: 3400, descricao: 'ronda até a borda, olha e volta', peso: 2, categoria: 'base' },
  { id: 'disparar', duracaoMs: 2200, descricao: 'disparada curta com stretch horizontal', peso: 2, categoria: 'base' },
  { id: 'esgueirar', duracaoMs: 3400, descricao: 'passinhos furtivos, agachada e devagar', peso: 1, categoria: 'base' },
  { id: 'marchar', duracaoMs: 2600, descricao: 'marcha alta de soldadinha fiscal', peso: 2, categoria: 'base' },
  { id: 'deslizar', duracaoMs: 2400, descricao: 'desliza como de patins, inclinada', peso: 2, categoria: 'base' },
  { id: 'meia-volta', duracaoMs: 2400, descricao: 'meia-volta com giro e retorno', peso: 2, categoria: 'base' },
  /* --- Pulinhos --- */
  { id: 'pulo-simples', duracaoMs: 2200, descricao: 'hop único alto com squash no pouso', peso: 2, categoria: 'base' },
  { id: 'pulo-duplo', duracaoMs: 2600, descricao: 'dois hops em sequência', peso: 2, categoria: 'base' },
  { id: 'pulo-girando', duracaoMs: 2600, descricao: 'hop com giro de 360° no ar', peso: 2, categoria: 'base' },
  { id: 'quicar', duracaoMs: 2800, descricao: 'quatro quiques baixos e rápidos', peso: 2, categoria: 'base' },
  { id: 'pulo-mortal', duracaoMs: 2800, descricao: 'salto alto com giro completo', peso: 1, categoria: 'base' },
  /* --- Ecossistema (brinca com os props da casinha) --- */
  { id: 'cacar-moeda', duracaoMs: 3400, descricao: 'persegue a moedinha dourada do ecossistema', peso: 2, categoria: 'base' },
  { id: 'comer', duracaoMs: 3200, descricao: 'mastiga o biscoito do potinho', peso: 3, categoria: 'vida' },
  { id: 'beber', duracaoMs: 3000, descricao: 'bebe água com glug-glug', peso: 3, categoria: 'vida' },
  { id: 'cantar', duracaoMs: 3400, descricao: 'canta balançando com notas musicais', peso: 2, categoria: 'base' },
  { id: 'espirrar', duracaoMs: 2200, descricao: 'atchim com chacoalhão', peso: 2, categoria: 'base' },
  { id: 'susto', duracaoMs: 2400, descricao: 'susto com pulo e arrepio', peso: 1, categoria: 'base' },
  { id: 'aninhar', duracaoMs: 3600, descricao: 'se aninha na caminha para cochilar', peso: 1, categoria: 'base' },
  { id: 'despertar', duracaoMs: 2600, descricao: 'desperta sacudindo a poeira', peso: 2, categoria: 'base' },
  /* --- Vida / necessidades (pacote 2 — rotina fofa, pede biscoito e água) --- */
  { id: 'lamber-beico', duracaoMs: 2400, descricao: 'lambe o focinho satisfeita pós-lanche', peso: 3, categoria: 'vida' },
  { id: 'farejar-pote', duracaoMs: 2800, descricao: 'cheira o pote vazio e bate a patinha pedindo mais', peso: 3, categoria: 'vida' },
  { id: 'tomar-cafe', duracaoMs: 3200, descricao: 'toma cafezinho com vapor subindo e tremidinha', peso: 2, categoria: 'vida' },
  { id: 'lavar-rosto', duracaoMs: 2600, descricao: 'esfrega o rostinho com a patinha (higiene)', peso: 2, categoria: 'vida' },
  { id: 'sonhar', duracaoMs: 3400, descricao: 'dorme em pé com bolha de sonho dourada', peso: 1, categoria: 'vida' },
  /* --- Brincadeiras (pacote 2 — caça e esconde) --- */
  { id: 'cacar-borboleta', duracaoMs: 3400, descricao: 'persegue a borboleta do ecossistema com pulinhos', peso: 2, categoria: 'brincadeira' },
  { id: 'perseguir-luz', duracaoMs: 3000, descricao: 'persegue o reflexo da lupinha que corre', peso: 2, categoria: 'brincadeira' },
  { id: 'jogar-moeda', duracaoMs: 2800, descricao: 'joga a moedinha pro alto e pega', peso: 1, categoria: 'brincadeira' },
  { id: 'esconder', duracaoMs: 3000, descricao: 'se agacha e espia (peek-a-boo)', peso: 2, categoria: 'brincadeira' },
  /* --- Trabalho fiscal + social (pacote 2) --- */
  { id: 'carimbar', duracaoMs: 2800, descricao: 'carimba NCM OK com a lupinha e brilho', peso: 2, categoria: 'trabalho' },
  { id: 'contar-moedas', duracaoMs: 3400, descricao: 'conta moedinhas empilhando com a patinha', peso: 2, categoria: 'trabalho' },
  { id: 'mandar-beijo', duracaoMs: 2400, descricao: 'manda beijo com coração voando', peso: 2, categoria: 'social' },
] as const

/** Intervalo entre ambientes (ms) — sorteado a cada ciclo para irregularidade. */
export const INTERVALO_AMBIENTE_MIN = 9_000
export const INTERVALO_AMBIENTE_MAX = 17_000

/** Sorteia o próximo intervalo (ms) — puro para teste. */
export function sortearIntervaloAmbiente(rand: () => number = Math.random): number {
  const r = Math.min(0.9999, Math.max(0, rand()))
  return Math.round(INTERVALO_AMBIENTE_MIN + r * (INTERVALO_AMBIENTE_MAX - INTERVALO_AMBIENTE_MIN))
}

/**
 * Sorteia o próximo ambiente por peso, evitando repetir o anterior imediato.
 * `rand` injetável mantém determinismo nos testes.
 */
export function sortearAmbiente(
  anterior: string | null,
  rand: () => number = Math.random,
): AmbientePet {
  if (AMBIENTES.length === 0) throw new Error('sem ambientes cadastrados')
  if (AMBIENTES.length === 1) return AMBIENTES[0]!
  const r = Math.min(0.999999, Math.max(0, rand()))
  const total = AMBIENTES.reduce((s, a) => s + (a.peso ?? 2), 0)
  let alvo = r * total
  let indice = 0
  for (let i = 0; i < AMBIENTES.length; i++) {
    alvo -= AMBIENTES[i]!.peso ?? 2
    if (alvo <= 0) { indice = i; break }
    indice = i
  }
  if (indice < 0) indice = 0
  if (indice >= AMBIENTES.length) indice = AMBIENTES.length - 1
  let tentativas = 0
  while (AMBIENTES[indice]!.id === anterior && tentativas < 4) {
    indice = (indice + 1) % AMBIENTES.length
    tentativas += 1
  }
  return AMBIENTES[indice]!
}

/** Frases leves da tagarelice idle — ditas sem ninguém pedir (com cooldown). */
export const FRASES_TAGARELICE: readonly string[] = [
  'Tô por aqui farejando…',
  'Lupinha limpa e pronta!',
  'Se precisar, é só chamar!',
  'Que cheirinho bom de NCM…',
  'Vigiando as tabelinhas!',
] as const

export function sortearTagarelice(rand: () => number = Math.random): string {
  return FRASES_TAGARELICE[Math.floor(rand() * FRASES_TAGARELICE.length) % FRASES_TAGARELICE.length]!
}
