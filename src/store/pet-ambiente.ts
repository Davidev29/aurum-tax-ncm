/**
 * Ambientes da Aurinha — os 81 comportamentos autônomos que rodam de forma
 * natural e aleatória quando ela está livre (`idle` na doca).
 *
 * Desenho:
 * - 100% puro e testável: `sortearAmbiente` não toca em DOM/store — recebe
 *   o id anterior (para não repetir) e uma função `rand` injetável.
 * - Sorteio PONDERADO por `peso` (raridade): comportamentos comuns (peso 3)
 *   saem ~3x mais que raros (peso 1). `rand` uniform em [0,1) vira faixa
 *   proporcional ao peso acumulado — determinístico nos testes.
 * - O CSS (`pet-aurum.css`, seção AMBIENTES + PACOTE 3) interpreta
 *   `data-ambient` como overlay de UMA apresentação (`animation … 1`); o
 *   hook em `PetAurum.tsx` (`useAmbienteDaAurinha`) liga/desliga o atributo
 *   e respeita `prefers-reduced-motion`, aba oculta e humor ocupado.
 * - Durações curtas (2–4 s) + intervalo longo e irregular (9–17 s) = ela
 *   parece viva, nunca mecânica. Sem frase no store (não briga com o balão).
 * - Locomoção de fundo (ir de um lado ao outro da sidebar) NÃO mora aqui:
 *   é o `useLocomocaoDaAurinha` (JS, contínuo, sem snap). Os ambientes de
 *   locomoção abaixo são *estilos* (trote, furtiva, marcha…) que compõem
 *   com o deslocamento — todos começam e terminam neutros.
 * - Pacote 3 (43–69): 27 novos em 3 levas — EMOÇÃO (social), LOCOMOÇÃO
 *   (base) e OCIOSO natural (vida/brincadeira/trabalho). Tudo funciona SEM
 *   input: sorteio idle + variações de ausência/retorno quando a janela
 *   minimiza ou a aba oculta.
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

/** Os 81 comportamentos autônomos — ordem = catálogo, não prioridade. */
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
  /* --- Pacote 3 — EMOÇÃO (43–51: roda sozinha no idle, sem input) --- */
  { id: 'rir-alto', duracaoMs: 2600, descricao: 'gargalha sacudindo a barriga com corações', peso: 2, categoria: 'social' },
  { id: 'choramingar', duracaoMs: 3200, descricao: 'murcha com soluços e olhos brilhando', peso: 1, categoria: 'social' },
  { id: 'orgulho', duracaoMs: 2800, descricao: 'estufa o peito com o selo dourado brilhando', peso: 2, categoria: 'social' },
  { id: 'timidez', duracaoMs: 3000, descricao: 'esconde o focinho e balança o rabo tímida', peso: 2, categoria: 'social' },
  { id: 'surpresa', duracaoMs: 2200, descricao: 'espanta com pulo curto e olhos arregalados', peso: 2, categoria: 'social' },
  { id: 'meditar', duracaoMs: 3600, descricao: 'flutua serena em pose de meditação', peso: 1, categoria: 'social' },
  { id: 'apaixonar', duracaoMs: 2800, descricao: 'suspira apaixonada com corações subindo', peso: 2, categoria: 'social' },
  { id: 'emburrar', duracaoMs: 2600, descricao: 'cruza os bracinhos e vira o focinho', peso: 1, categoria: 'social' },
  { id: 'alivio', duracaoMs: 2400, descricao: 'suspira aliviada enxugando a testa', peso: 2, categoria: 'social' },
  /* --- Pacote 3 — LOCOMOÇÃO (52–60: gaits que compõem com o passeio JS) --- */
  { id: 'galopar', duracaoMs: 2400, descricao: 'galope largo com stretch horizontal', peso: 2, categoria: 'base' },
  { id: 'saltitar', duracaoMs: 2600, descricao: 'saltita lateral alternando as patinhas', peso: 2, categoria: 'base' },
  { id: 'correr-leve', duracaoMs: 2200, descricao: 'corridinha leve com inclinação de arrancada', peso: 2, categoria: 'base' },
  { id: 'sonambular', duracaoMs: 3600, descricao: 'anda dormindo com passinhos flutuantes', peso: 1, categoria: 'base' },
  { id: 'escorregar', duracaoMs: 2400, descricao: 'escorrega e recupera o equilíbrio', peso: 2, categoria: 'base' },
  { id: 'tropecar', duracaoMs: 2200, descricao: 'tropeça, rodopia e finge que foi de propósito', peso: 1, categoria: 'base' },
  { id: 'rodopiar', duracaoMs: 2600, descricao: 'rodopia andando em espiral curta', peso: 2, categoria: 'base' },
  { id: 'patrulha-lenta', duracaoMs: 3400, descricao: 'patrulha lenta de sentinela com pausas de olhar', peso: 2, categoria: 'base' },
  { id: 'zigue-zague', duracaoMs: 3200, descricao: 'costura em zigue-zague farejando o caminho', peso: 2, categoria: 'base' },
  /* --- Pacote 3 — OCIOSO NATURAL (61–69: vida sozinha, mesmo sem mouse) --- */
  { id: 'olhar-relogio', duracaoMs: 2800, descricao: 'ergue a lupa como relógio e confere a hora', peso: 2, categoria: 'vida' },
  { id: 'contar-estrelas', duracaoMs: 3400, descricao: 'conta estrelinhas que piscam ao redor', peso: 1, categoria: 'vida' },
  { id: 'assobiar', duracaoMs: 3200, descricao: 'assobia com notinhas subindo distraída', peso: 2, categoria: 'brincadeira' },
  { id: 'ajeitar-oculos', duracaoMs: 2600, descricao: 'ajeita os óculos com a patinha 2x', peso: 2, categoria: 'trabalho' },
  { id: 'farejar-ar', duracaoMs: 3000, descricao: 'fareja o ar alto em tercinas com brisa', peso: 2, categoria: 'vida' },
  { id: 'lustrar-selo', duracaoMs: 3000, descricao: 'lustra o selo Aurum até brilhar', peso: 2, categoria: 'trabalho' },
  { id: 'anotar', duracaoMs: 3200, descricao: 'anota com a lupa virando lápis', peso: 2, categoria: 'trabalho' },
  { id: 'dobrar-mapa', duracaoMs: 3400, descricao: 'abre e dobra um mapinha com a lupa', peso: 1, categoria: 'trabalho' },
  { id: 'fazer-sombra', duracaoMs: 2800, descricao: 'brinca com a própria sombra projetada', peso: 2, categoria: 'brincadeira' },
  /* --- Gaveta de documentos (móvel do eco — abre sozinha ao consultar) --- */
  { id: 'consultar-gaveta', duracaoMs: 4000, descricao: 'abre a gaveta, pega o livro e lê com a lupa', peso: 2, categoria: 'trabalho' },
  { id: 'ler-livrinho', duracaoMs: 3600, descricao: 'abre o livrinho e lê balançando a cabeça', peso: 2, categoria: 'trabalho' },
  /* --- Pacote 4 — BRAÇOS COM FÍSICA (72–81: rig de ombro, rotate suave) --- */
  { id: 'acenar-duplo', duracaoMs: 2400, descricao: 'tchau com as duas patas em contrafase', peso: 2, categoria: 'social' },
  { id: 'nadar-lontra', duracaoMs: 3200, descricao: 'remada circular defasada de lontra nadando', peso: 1, categoria: 'brincadeira' },
  { id: 'escavar', duracaoMs: 2600, descricao: 'cava com patadas alternadas e poeira', peso: 2, categoria: 'brincadeira' },
  { id: 'malabarismo', duracaoMs: 3400, descricao: 'joga a moedinha entre as patas', peso: 1, categoria: 'brincadeira' },
  { id: 'aplaudir', duracaoMs: 2200, descricao: 'bate palmas com squash no impacto', peso: 2, categoria: 'social' },
  { id: 'focar-binoculo', duracaoMs: 3000, descricao: 'leva a lupa ao rosto com as duas mãos', peso: 2, categoria: 'trabalho' },
  { id: 'carregar-caixa', duracaoMs: 3400, descricao: 'segura peso à frente com tremor de esforço', peso: 2, categoria: 'trabalho' },
  { id: 'apontar-achado', duracaoMs: 2600, descricao: 'aponta o achado com overshoot elástico', peso: 2, categoria: 'trabalho' },
  { id: 'espreguicar-bracos', duracaoMs: 2800, descricao: 'esticão em Y com os bracinhos pro alto', peso: 2, categoria: 'vida' },
  { id: 'abraco-quente', duracaoMs: 2400, descricao: 'fecha as patinhas num abraço com corações', peso: 2, categoria: 'social' },
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

/* ----------------- AUSÊNCIA / RETORNO (janela minimizada, aba oculta) ------
   A pet percebe quando o humano some e quando volta. Tudo puro e testável:
   - `fraseAusencia` = sorteio simples sem repetir a anterior;
   - `fraseRetorno(awayMs)` = varia por tempo fora: curta (<30s) ela nem
     estranha, média (<5min) ela sente saudade, longa ela faz festa.
   O hook em `PetAurum.tsx` (`useVidaPropriaDaAurinha`) grava `awayDesde`
   no `visibilitychange` e escolhe a fala na volta — só fala se a pet
   estiver livre (`idle`/`sleeping`) e sem `prefers-reduced-motion`. */

export const LIMITE_RETORNO_CURTO_MS = 30_000
export const LIMITE_RETORNO_MEDIO_MS = 5 * 60_000

export const FRASES_AUSENCIA: readonly string[] = [
  'Tô te esperando…',
  'Vou vigiar as tabelinhas!',
  'Não demora, hein?',
  'Vou cochilar de um olho só…',
  'Guardo seu lugar quentinho!',
  'Farejo você já já…',
] as const

export const FRASES_RETORNO_CURTO: readonly string[] = [
  'Oi de novo!',
  'Nem senti falta… mentira, senti!',
  'Voltou rapidinho!',
  'Bora continuar?',
] as const

export const FRASES_RETORNO_MEDIO: readonly string[] = [
  'Voltei! Sentiu saudade?',
  'Que bom te ver de novo!',
  'Tava farejando sua volta!',
  'Senti sua falta, sabia?',
] as const

export const FRASES_RETORNO_LONGO: readonly string[] = [
  'VOLTOU! Fiz festa sozinha!',
  'Quanto tempo! Conta tudo!',
  'Achei que tinha me abandonado…',
  'Saudade gigante! Bora classificar?',
] as const

function sortearDe(
  lista: readonly string[],
  anterior: string | null,
  rand: () => number,
): string {
  if (lista.length === 0) throw new Error('sem frases cadastradas')
  if (lista.length === 1) return lista[0]!
  let indice = Math.floor(rand() * lista.length) % lista.length
  let tentativas = 0
  while (lista[indice] === anterior && tentativas < 4) {
    indice = (indice + 1) % lista.length
    tentativas += 1
  }
  return lista[indice]!
}

export function fraseAusencia(
  anterior: string | null = null,
  rand: () => number = Math.random,
): string {
  return sortearDe(FRASES_AUSENCIA, anterior, rand)
}

export function fraseRetorno(
  awayMs: number,
  anterior: string | null = null,
  rand: () => number = Math.random,
): string {
  if (awayMs >= LIMITE_RETORNO_MEDIO_MS) return sortearDe(FRASES_RETORNO_LONGO, anterior, rand)
  if (awayMs >= LIMITE_RETORNO_CURTO_MS) return sortearDe(FRASES_RETORNO_MEDIO, anterior, rand)
  return sortearDe(FRASES_RETORNO_CURTO, anterior, rand)
}
