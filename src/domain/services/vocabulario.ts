/**
 * Vocabulário fiscal da Aurum AI — sinônimos, radicais e sinais por capítulo.
 *
 * Papel: dar "contexto de entendimento maior" ao RAG. O usuário digita com
 * palavras do dia a dia ("boi", "celular", "camiseta"); a nomenclatura oficial
 * usa vocabulário técnico ("bovino", "telefone", "camisa"). Sem esta ponte, o
 * RAG lexical nunca matcha e a IA responde NÃO SEI para tudo.
 *
 * Regras:
 * - Chave e valor já normalizados (sem acento, minúsculas).
 * - O valor deve existir LITERALMENTE no texto oficial (ou ser radical comum
 *   às flexões: `bovin` casa com bovino/bovina/bovinos via substring).
 * - A expansão só ADICIONA consultas — a prova continua sendo o match na base
 *   oficial + validação pelo resolvedor (nenhum NCM é inventado).
 */

/** Dia a dia → vocabulário da nomenclatura (radical oficial). */
export const SINONIMOS_FISCAIS: Record<string, string> = {
  // --- pecuária / agro (legado, preservado) ---
  boi: 'bovin',
  vaca: 'bovin',
  novilho: 'bovin',
  novilha: 'bovin',
  bezerro: 'bovin',
  gado: 'bovin',
  nelore: 'bovin',
  zebu: 'bovin',
  touro: 'bovin',
  bezerra: 'bovin',
  holandesa: 'bovin',
  holandes: 'bovin',
  brahman: 'bovin',
  gir: 'bovin',
  girolando: 'bovin',
  jersey: 'bovin',
  bufalo: 'bufalo',
  porco: 'suin',
  porca: 'suin',
  leitao: 'suin',
  suino: 'suin',
  frango: 'ave',
  galinha: 'galinha',
  galo: 'ave',
  franga: 'galinha',
  pintinho: 'ave',
  ave: 'ave',
  carcaca: 'carcaca',
  milho: 'milho',
  semente: 'semente',
  sementes: 'semente',
  plantio: 'semeadura',
  plantar: 'semeadura',
  semeadura: 'semeadura',
  sementeira: 'semente',
  grao: 'grao',
  graos: 'grao',
  racao: 'alimentacao',
  pet: 'alimentacao',
  food: 'alimentacao',
  petfood: 'alimentacao',
  cao: 'caes',
  caes: 'caes',
  cachorro: 'caes',
  gato: 'gatos',
  gatos: 'gatos',
  sal: 'sal',
  arroz: 'arroz',
  feijao: 'feijao',
  trigo: 'trigo',
  soja: 'soja',
  cafe: 'cafe',
  acucar: 'acucar',
  queijo: 'queijo',
  // --- nomes populares de queijo (ausentes na TEC — pool p/ o RAG; o pin
  // exato vive no dicionário comercial). `coalho`/`prato`/`minas` sozinhos
  // NÃO entram: também são enzima, louça e estado.
  parmesao: 'queijo',
  parmeggiano: 'queijo',
  provolone: 'queijo',
  gorgonzola: 'queijo',
  brie: 'queijo',
  camembert: 'queijo',
  cottage: 'queijo',
  ricota: 'queijo',
  polenguinho: 'queijo',
  minas: 'queijo',
  // --- carnes e embutidos (nomes populares ∉ TEC; valor = palavra oficial) ---
  presunto: 'suina',
  bacon: 'suina',
  charque: 'bovina',
  mortadela: 'enchidos',
  linguica: 'enchidos',
  salsicha: 'enchidos',
  paio: 'enchidos',
  salame: 'enchidos',
  galeto: 'ave',
  mussarela: 'mozarela',
  mucarela: 'mozarela',
  musarela: 'mozarela',
  mozarela: 'mozarela',
  leite: 'leite',
  remedio: 'medicamento',
  antibiotico: 'medicamento',
  seringa: 'seringa',
  protese: 'protese',
  // --- carnes / aves / peixes ---
  carne: 'carne',
  picanha: 'carne',
  costela: 'carne',
  lombo: 'lombo',
  peito: 'peito',
  coxa: 'coxa',
  asa: 'asa',
  peixe: 'peixe',
  salmao: 'salmao',
  tilapia: 'tilapia',
  camarao: 'camarao',
  bacalhau: 'bacalhau',
  atum: 'atum',
  sardinha: 'sardinha',
  ovo: 'ovo',
  ovos: 'ovo',
  // --- hortifrúti / alimentos ---
  tomate: 'tomate',
  batata: 'batata',
  cebola: 'cebola',
  alho: 'alho',
  cenoura: 'cenoura',
  alface: 'alface',
  banana: 'banana',
  maca: 'maca',
  laranja: 'laranja',
  uva: 'uva',
  manga: 'manga',
  melao: 'melao',
  melancia: 'melancia',
  morango: 'morango',
  abacaxi: 'abacaxi',
  limao: 'limao',
  mamao: 'mamao',
  farinha: 'farinha',
  macarrao: 'massa',
  miojo: 'massa',
  pao: 'pao',
  bolo: 'pastelaria',
  biscoito: 'bolacha',
  bolacha: 'bolacha',
  chocolate: 'chocolate',
  sorvete: 'sorvete',
  iogurte: 'iogurte',
  manteiga: 'manteiga',
  margarina: 'margarina',
  oleo: 'oleo',
  azeite: 'azeite',
  vinagre: 'vinagre',
  mel: 'mel',
  geleia: 'geleia',
  suco: 'suco',
  refrigerante: 'bebida',
  cerveja: 'cerveja',
  vinho: 'vinho',
  cachaça: 'cachaca',
  cachaca: 'cachaca',
  whisky: 'whisky',
  vodka: 'vodka',
  // --- vestuário / calçados / têxtil ---
  camiseta: 'camisa',
  camisa: 'camisa',
  camisete: 'camisa',
  blusa: 'blusa',
  calca: 'calca',
  calça: 'calca',
  jeans: 'jeans',
  bermuda: 'bermuda',
  short: 'short',
  vestido: 'vestido',
  saia: 'saia',
  terno: 'terno',
  paleto: 'paleto',
  gravata: 'gravata',
  cueca: 'cueca',
  calcinha: 'calcinha',
  sutia: 'sutia',
  meia: 'meia',
  meias: 'meia',
  sapato: 'calcado',
  tenis: 'calcado',
  chinelo: 'chinelo',
  sandalia: 'sandalia',
  bota: 'bota',
  bolsa: 'bolsa',
  mochila: 'mochila',
  mala: 'mala',
  cinto: 'cinto',
  bone: 'bone',
  chapeu: 'chapeu',
  algodao: 'algodao',
  seda: 'seda',
  la: 'la',
  poliester: 'poliester',
  nylon: 'nailon',
  // --- eletrônicos / informática / telefonia ---
  celular: 'telefone',
  smartphone: 'telefone',
  iphone: 'telefone',
  telefone: 'telefone',
  tablet: 'tablet',
  notebook: 'computador',
  laptop: 'computador',
  computador: 'computador',
  pc: 'computador',
  monitor: 'monitor',
  teclado: 'teclado',
  mouse: 'mouse',
  impressora: 'impressora',
  tv: 'televisao',
  televisao: 'televisao',
  smartv: 'televisao',
  radio: 'radio',
  caixa: 'caixa',
  som: 'audio',
  fone: 'fone',
  headphone: 'fone',
  headset: 'fone',
  carregador: 'carregador',
  bateria: 'acumuladores',
  pilha: 'pilha',
  lampada: 'lampada',
  led: 'led',
  geladeira: 'refrigerador',
  refrigerador: 'refrigerador',
  freezer: 'congelador',
  fogao: 'fogao',
  forno: 'forno',
  microondas: 'microondas',
  ar: 'condicionador',
  ventilador: 'ventilador',
  chuveiro: 'chuveiro',
  maquina: 'maquina',
  motor: 'motor',
  bomba: 'bomba',
  trator: 'trator',
  colheitadeira: 'colheitadeira',
  // --- farmácia / cosméticos / higiene ---
  perfume: 'perfumaria',
  colonia: 'perfumaria',
  shampoo: 'xampus',
  condicionador: 'condicionador',
  sabonete: 'saboes',
  sabao: 'saboes',
  detergente: 'detergente',
  pasta: 'pasta',
  escova: 'escova',
  fralda: 'fralda',
  absorvente: 'absorvente',
  creme: 'creme',
  protetor: 'protetor',
  maquiagem: 'maquilhagem',
  batom: 'batom',
  esmalte: 'esmalte',
  // --- móveis / casa / construção ---
  sofa: 'assento',
  cadeira: 'assento',
  mesa: 'mesa',
  cama: 'cama',
  guarda: 'guardaroupa',
  armario: 'armario',
  estante: 'estante',
  colchao: 'colchao',
  travesseiro: 'travesseiro',
  panela: 'panela',
  frigideira: 'frigideira',
  talher: 'talher',
  copo: 'copo',
  prato: 'prato',
  tijolo: 'tijolo',
  cimento: 'cimento',
  tinta: 'tinta',
  verniz: 'verniz',
  martelo: 'ferramenta',
  chave: 'ferramenta',
  parafuso: 'parafuso',
  prego: 'prego',
  // --- veículos / autopeças ---
  carro: 'veiculo',
  moto: 'motocicleta',
  caminhao: 'caminhao',
  onibus: 'onibus',
  bicicleta: 'bicicleta',
  pneu: 'pneumatico',
  motorcarro: 'motor',
  retrovisor: 'retrovisor',
  farol: 'farois',
  // --- papelaria / diversos ---
  caneta: 'caneta',
  lapis: 'lapis',
  caderno: 'caderno',
  livro: 'livro',
  brinquedo: 'brinquedo',
  boneca: 'boneca',
  bola: 'bola',
  raquete: 'raquete',
  // --- base de conhecimento expandida (comum + incomum) ---
  // Dia a dia → radical oficial TEC (valor existe LITERALMENTE no oficial
  // após normalizarBusca; a prova continua sendo o match + resolvedor).
  airfryer: 'grelha',
  fritadeira: 'grelha',
  sanduicheira: 'grelha',
  torradeira: 'torrada',
  alexa: 'altifalante',
  echo: 'altifalante',
  soundbar: 'altifalante',
  jbl: 'altifalante',
  kindle: 'leitor',
  ereader: 'leitor',
  smartwatch: 'relogio',
  relogio: 'relogio',
  drone: 'aeronave',
  roteador: 'transmissao',
  router: 'transmissao',
  webcam: 'camera',
  camera: 'camera',
  gopro: 'camera',
  videogame: 'console',
  playstation: 'console',
  xbox: 'console',
  nintendo: 'console',
  joystick: 'console',
  // Marcas / siglas / inglês comercial → hiperônimo oficial.
  samsung: 'telefone',
  motorola: 'telefone',
  xiaomi: 'telefone',
  philips: 'televisao',
  sony: 'televisao',
  nescau: 'cacau',
  danone: 'iogurte',
  nestle: 'chocolate',
  nike: 'calcado',
  adidas: 'calcado',
  whey: 'suplemento',
  creatina: 'suplemento',
  skincare: 'creme',
  // Vestuário expandido — dia a dia → oficial.
  cropped: 'blusa',
  legging: 'calca',
  moletom: 'sueter',
  sueter: 'sueter',
  cardiga: 'cardiga',
  regata: 'camiseta',
  babylook: 'camiseta',
  jaqueta: 'casaco',
  casaco: 'casaco',
  sobretudo: 'sobretudo',
  biquini: 'banho',
  sunga: 'banho',
  lingerie: 'calcinha',
  pijama: 'pijama',
  roupao: 'roupao',
  // Alimentos / bebidas — nomes de mercado → oficial.
  tapioca: 'fecula',
  fecula: 'fecula',
  polvilho: 'fecula',
  granola: 'cereal',
  doce: 'confeitaria',
  bala: 'confeitaria',
  chiclete: 'goma',
  energetico: 'bebida',
  isotonico: 'bebida',
  gin: 'aguardente',
  rum: 'aguardente',
  tequila: 'aguardente',
  licor: 'licor',
  espumante: 'vinho',
  // Casa / ferramentas / autopeças.
  aspirador: 'aspirador',
  liquidificador: 'liquidificador',
  batedeira: 'batedeira',
  cafeteira: 'cafeteira',
  furadeira: 'furar',
  parafusadeira: 'parafuso',
  lixadeira: 'ferramenta',
  alicate: 'alicate',
  pastilha: 'pastilha',
  freio: 'freio',
  amortecedor: 'amortecedor',
  embreagem: 'embreagem',
  correia: 'correia',
  filtro: 'filtrar',
  // Erros comuns de digitação (sem acento, já normalizados).
  parmezao: 'queijo',
  muzzarela: 'mozarela',
  notbook: 'computador',
  notebbok: 'computador',
  celula: 'telefone',
  smartfone: 'telefone',
  television: 'televisao',
  teve: 'televisao',
  xocolate: 'chocolate',
  cerjeva: 'cerveja',
  serueja: 'cerveja',
  linguissa: 'enchidos',
  salsixa: 'enchidos',
  presuntoo: 'suina',
  camizeta: 'camisa',
  tennis: 'calcado',
  fraldaa: 'fralda',
  // --- 33+ novos segmentos: autopeças / metal / têxtil / construção ---
  // Valores existem LITERALMENTE no oficial (ou radical comum às flexões).
  // (`farol/bateria/filtro/shampoo/sabao/sabonete/pneu` atualizados in-place
  // acima para o radical oficial — sem duplicar chaves.)
  dentada: 'sincrona',
  vergalhao: 'nervura',
  fio: 'fios',
  denim: 'indigo',
  tricoline: 'tecido',
  toalha: 'atoalhado',
  lencol: 'cama',
  serrote: 'serra',
}

/** Expande um token para o vocabulário oficial (ou `null`). */
export function expandirSinonimoFiscal(token: string): string | null {
  return SINONIMOS_FISCAIS[token] ?? null
}

/**
 * Radicalização simples pt-BR para o RAG (sem dependências).
 * Remove plurais e sufixos comuns para aproximar "camisetas"→"camiseta",
 * "bovinos"→"bovin", "queijos"→"queij".
 */
export function radicalizar(token: string): string {
  let t = String(token || '').toLowerCase()
  if (!t || t.length <= 3) return t
  // plurais
  if (t.endsWith('oes')) t = t.slice(0, -3) + 'ao'
  else if (t.endsWith('aes')) t = t.slice(0, -3) + 'ao'
  else if (t.endsWith('ais')) t = t.slice(0, -3) + 'al'
  else if (t.endsWith('eis')) t = t.slice(0, -3) + 'el'
  else if (t.endsWith('is')) t = t.slice(0, -2) + 'il'
  else if (t.endsWith('ns')) t = t.slice(0, -2) + 'm'
  else if (t.endsWith('es') && t.length > 4) t = t.slice(0, -2)
  else if (t.endsWith('s') && t.length > 3) t = t.slice(0, -1)
  // diminutivos / aumentativos comuns
  for (const suf of ['zinho', 'zinha', 'inhos', 'inhas', 'eiras', 'eira', 'eiro']) {
    if (t.endsWith(suf) && t.length - suf.length >= 3) {
      t = t.slice(0, -suf.length)
      break
    }
  }
  return t
}

/** Distância de Levenshtein com teto (para fuzzy barato no RAG). */
export function distanciaLevenshtein(a: string, b: string, teto = 2): number {
  const s = String(a || '')
  const t = String(b || '')
  if (s === t) return 0
  const la = s.length
  const lb = t.length
  if (!la) return lb
  if (!lb) return la
  if (Math.abs(la - lb) > teto) return teto + 1
  let prev = new Array<number>(lb + 1)
  for (let j = 0; j <= lb; j++) prev[j] = j
  for (let i = 1; i <= la; i++) {
    const cur = new Array<number>(lb + 1)
    cur[0] = i
    let minLinha = cur[0]
    for (let j = 1; j <= lb; j++) {
      const custo = s[i - 1] === t[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + custo)
      if (cur[j] < minLinha) minLinha = cur[j]
    }
    if (minLinha > teto) return teto + 1
    prev = cur
  }
  return prev[lb]
}

/**
 * `true` quando o token da consulta casa com o token oficial por alguma via
 * tolerante: substring, radical ou fuzzy (typo).
 *
 * Guarda anti-ruído: substring/radical exigem ≥4 chars nos DOIS lados
 * ("nave" NÃO casa com "ave"; "queijo" casa com "queijos"). Exato (`===`)
 * vale sempre ("sal" casa com "sal"). Fuzzy só para termos ≥5 chars.
 */
export function casaToken(consulta: string, oficial: string): boolean {
  const q = String(consulta || '')
  const o = String(oficial || '')
  if (!q || !o) return false
  if (q === o) return true
  const minLen = Math.min(q.length, o.length)
  // substring só com lastro (evita "de" casar com tudo e "nave" com "ave")
  if (minLen >= 4 && (o.includes(q) || q.includes(o))) return true
  if (q.length < 4 || o.length < 4) return false
  if (radicalizar(q) === radicalizar(o)) return true
  const rQ = radicalizar(q)
  const rO = radicalizar(o)
  if (rQ.length >= 4 && rO.length >= 4 && (rO.includes(rQ) || rQ.includes(rO))) return true
  // typo: 1 edição para termos médios, 2 para longos
  if (q.length >= 5 && o.length >= 5) {
    const teto = q.length >= 8 && o.length >= 8 ? 2 : 1
    if (distanciaLevenshtein(q, o, teto) <= teto) return true
  }
  return false
}
