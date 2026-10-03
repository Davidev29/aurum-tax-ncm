/**
 * Dicionário comercial da Aurum AI — nomes populares → NCM exato.
 *
 * Problema: a TEC usa vocabulário técnico e omite nomes de mercado.
 * "Parmesão" não existe em nenhuma descrição oficial (o item 0406.90.10
 * chama-se "Com um teor de umidade inferior a 36,0%, em peso (massa dura)");
 * o mesmo vale para provolone, gorgonzola, mortadela, presunto etc. Sem esta
 * ponte, o RAG lexical nunca matcha e a IA responde NÃO SEI até para o
 * trivial — enquanto o ambíguo real ("coalho" = queijo ou enzima?) deve
 * continuar pedindo contexto.
 *
 * Papel: FONTE DE CANDIDATOS, nunca decisão. Cada pin passa pelo resolvedor
 * (`resolverClassificacoes`) como qualquer outro candidato: pin errado ou
 * extinto morre na validação, nunca vira resposta.
 *
 * Regras de curadoria (leia antes de adicionar):
 * - `ncm`: 8 dígitos vigentes na TEC (conferir em
 *   `Tabela_NCM_Vigente_20260922.json`); nunca genérico ("Outros") por
 *   preguiça — o pin deve ser o enquadramento padrão do produto;
 * - `termos`: já normalizados (minúsculas, sem acento — ver `normalizarBusca`);
 *   termo de 1 palavra só quando INEQUÍVOCO sozinho (`parmesao` ✓,
 *   `prato` ✗ — prato também é louça; `minas` ✗ — também é estado;
 *   `ralado` ✗ — coco ralado não é queijo; `coalho` ✗ — também é enzima
 *   3507.10.00). Ambíguo só em frase (`queijo prato`, `queijo ralado`);
 * - match: frase casa por substring; palavra única casa por token inteiro;
 *   em conflito vence o termo MAIS LONGO (`parmesão ralado` → 0406.20.00,
 *   não 0406.90.10);
 * - quando o oficial JÁ contém a palavra (`requeijão`, `mozaréla`), o pin
 *   serve para EXATIDÃO (tira o empate entre vizinhos), não para cobertura.
 */

import { normalizarBusca } from '@/domain/services/busca-texto'

export interface EntradaDicionarioComercial {
  /** NCM de 8 dígitos (só dígitos), vigente na TEC. */
  ncm: string
  /** Termos normalizados que disparam este pin (frase ou palavra inequívoca). */
  termos: string[]
  /** Prateleira para auditoria/organização. */
  categoria: 'queijos' | 'carnes-embutidos' | 'eletronicos' | 'alimentos-bebidas' | 'vestuario-calcados' | 'casa-ferramentas' | 'higiene-farmacia' | 'papelaria-brinquedos' | 'autopecas' | 'metalurgia' | 'textil' | 'construcao' | 'moveis' | 'quimicos-farma' | 'plasticos-borracha' | 'madeira-papel' | 'maquinas-equipamentos' | 'instrumentos-otica' | 'esporte-lazer'
}

export const DICIONARIO_COMERCIAL: EntradaDicionarioComercial[] = [
  // --- queijos (posição 04.06; "parmesão" ∉ TEC) ---
  { ncm: '04061010', categoria: 'queijos', termos: ['mussarela', 'mozarrela', 'mozzarella', 'mucarela', 'musarela', 'mozarela', 'queijo mussarela'] },
  { ncm: '04061090', categoria: 'queijos', termos: ['requeijao', 'ricota', 'cottage', 'queijo cottage', 'minas frescal', 'queijo minas frescal'] },
  { ncm: '04062000', categoria: 'queijos', termos: ['queijo ralado', 'parmesao ralado', 'queijo parmesao ralado'] },
  { ncm: '04063000', categoria: 'queijos', termos: ['queijo fundido', 'polenguinho', 'queijo polenguinho'] },
  { ncm: '04064000', categoria: 'queijos', termos: ['gorgonzola', 'roquefort', 'queijo azul', 'queijo gorgonzola', 'queijo roquefort'] },
  { ncm: '04069010', categoria: 'queijos', termos: ['parmesao', 'parmeggiano', 'grana padano', 'queijo parmesao'] },
  { ncm: '04069020', categoria: 'queijos', termos: ['provolone', 'queijo provolone', 'queijo prato', 'minas padrao', 'queijo minas padrao', 'meia cura', 'queijo meia cura'] },
  // --- carnes e embutidos (02.10 / 16.01; nenhum nome popular ∈ TEC) ---
  { ncm: '02101100', categoria: 'carnes-embutidos', termos: ['presunto', 'presunto cozido', 'presunto cru', 'presunto parma'] },
  { ncm: '02101200', categoria: 'carnes-embutidos', termos: ['bacon', 'bacon defumado', 'toucinho'] },
  { ncm: '02102000', categoria: 'carnes-embutidos', termos: ['charque', 'carne seca', 'carne de sol'] },
  { ncm: '16010000', categoria: 'carnes-embutidos', termos: ['mortadela', 'linguica', 'linguica calabresa', 'salsicha', 'salsichao', 'paio', 'salame'] },
  // --- eletrônicos (cap. 85/95; marcas e nomes populares ∉ TEC) ---
  // `celular` sozinho fica no vocabulário (telefone); aqui só o inequívoco.
  { ncm: '85171300', categoria: 'eletronicos', termos: ['smartphone', 'iphone', 'celular smartphone', 'telefone inteligente'] },
  { ncm: '85182100', categoria: 'eletronicos', termos: ['alexa', 'echo dot', 'echo show', 'soundbar', 'caixa jbl', 'alto falante inteligente'] },
  { ncm: '85183000', categoria: 'eletronicos', termos: ['headset', 'headphone', 'airpods', 'fone bluetooth', 'fone de ouvido bluetooth'] },
  { ncm: '95045000', categoria: 'eletronicos', termos: ['playstation', 'xbox', 'nintendo switch', 'videogame'] },
  // --- alimentos e bebidas (nome de mercado ∉ TEC) ---
  { ncm: '21069030', categoria: 'alimentos-bebidas', termos: ['whey', 'whey protein', 'creatina', 'suplemento whey'] },
  { ncm: '22030000', categoria: 'alimentos-bebidas', termos: ['cerveja', 'cerveja pilsen', 'cerveja latao', 'cerveja garrafa'] },
  // --- vestuário e calçados (só frase com material/tipo; marca sozinha é ambígua) ---
  { ncm: '61091000', categoria: 'vestuario-calcados', termos: ['camiseta de algodao', 'babylook de algodao', 'regata de algodao', 'cropped de algodao'] },
  { ncm: '64041100', categoria: 'vestuario-calcados', termos: ['tenis de corrida', 'tenis esportivo', 'tenis nike', 'tenis adidas'] },
  // --- casa, higiene e papelaria (enquadramento padrão do produto) ---
  { ncm: '96190000', categoria: 'higiene-farmacia', termos: ['fralda', 'fralda descartavel', 'fralda infantil'] },
  { ncm: '40111000', categoria: 'casa-ferramentas', termos: ['pneu de carro', 'pneu aro 13', 'pneu aro 14', 'pneu aro 15'] },
  { ncm: '96081000', categoria: 'papelaria-brinquedos', termos: ['caneta esferografica', 'caneta bic', 'caneta azul'] },
  { ncm: '95030060', categoria: 'papelaria-brinquedos', termos: ['lego', 'blocos de montar', 'brinquedo de montar'] },
  { ncm: '95030022', categoria: 'papelaria-brinquedos', termos: ['barbie', 'boneca barbie', 'boneca'] },
  // --- autopeças (padrão do produto; `pneu`/`bateria` sozinhos são ambíguos) ---
  { ncm: '40112010', categoria: 'autopecas', termos: ['pneu de caminhao', 'pneu de onibus', 'pneu aro 22'] },
  { ncm: '68138110', categoria: 'autopecas', termos: ['pastilha de freio', 'pastilha freio'] },
  { ncm: '87088000', categoria: 'autopecas', termos: ['amortecedor', 'amortecedor dianteiro', 'kit amortecedor'] },
  { ncm: '70091000', categoria: 'autopecas', termos: ['retrovisor', 'retrovisor externo', 'espelho retrovisor'] },
  { ncm: '85122011', categoria: 'autopecas', termos: ['farol', 'farol dianteiro', 'farol de milha'] },
  { ncm: '85071090', categoria: 'autopecas', termos: ['bateria automotiva', 'bateria de carro', 'bateria 60 amperes'] },
  { ncm: '84212300', categoria: 'autopecas', termos: ['filtro de oleo', 'filtro de combustivel', 'filtro de ar'] },
  { ncm: '40103500', categoria: 'autopecas', termos: ['correia dentada', 'correia sincronizadora', 'correia do alternador'] },
  // --- metalurgia / fixação / siderurgia ---
  { ncm: '73181500', categoria: 'metalurgia', termos: ['parafuso', 'parafuso sextavado', 'parafuso para madeira'] },
  { ncm: '73181600', categoria: 'metalurgia', termos: ['porca sextavada', 'porca de pressao', 'porca borboleta'] },
  { ncm: '73182100', categoria: 'metalurgia', termos: ['arruela de pressao'] },
  { ncm: '73182200', categoria: 'metalurgia', termos: ['arruela', 'arruela lisa'] },
  { ncm: '72142000', categoria: 'metalurgia', termos: ['vergalhao', 'vergalhao de aco', 'barra de aco nervurada'] },
  { ncm: '73041900', categoria: 'metalurgia', termos: ['tubo de aco', 'tubo de ferro', 'cano de aco'] },
  { ncm: '73130000', categoria: 'metalurgia', termos: ['arame farpado'] },
  { ncm: '72171090', categoria: 'metalurgia', termos: ['arame', 'arame galvanizado', 'arame recozido'] },
  { ncm: '76041010', categoria: 'metalurgia', termos: ['barra de aluminio'] },
  { ncm: '76042100', categoria: 'metalurgia', termos: ['perfil de aluminio', 'cantoneira de aluminio'] },
  // --- têxtil / algodão (`jeans` sozinho é ambíguo: tecido × calça) ---
  { ncm: '52085200', categoria: 'textil', termos: ['tecido de algodao', 'tricoline', 'tecido plano de algodao'] },
  { ncm: '60062100', categoria: 'textil', termos: ['malha de algodao', 'tecido de malha'] },
  { ncm: '52051200', categoria: 'textil', termos: ['fio de algodao', 'linha de algodao'] },
  { ncm: '52094210', categoria: 'textil', termos: ['tecido jeans', 'denim', 'tecido denim'] },
  { ncm: '62034200', categoria: 'textil', termos: ['calca jeans', 'calca de brim'] },
  { ncm: '62044200', categoria: 'textil', termos: ['vestido de algodao'] },
  { ncm: '63026000', categoria: 'textil', termos: ['toalha de banho', 'toalha de algodao'] },
  { ncm: '63023100', categoria: 'textil', termos: ['lencol de algodao', 'jogo de cama algodao'] },
  // --- construção ---
  { ncm: '69041000', categoria: 'construcao', termos: ['tijolo', 'tijolo de barro', 'bloco ceramico'] },
  { ncm: '25232910', categoria: 'construcao', termos: ['cimento', 'cimento portland', 'saco de cimento'] },
  { ncm: '32081010', categoria: 'construcao', termos: ['tinta de parede', 'tinta acrilica', 'tinta latex', 'lata de tinta'] },
  // --- ferramentas / cozinha ---
  { ncm: '82052000', categoria: 'casa-ferramentas', termos: ['martelo', 'marreta', 'martelo de unha'] },
  { ncm: '82054000', categoria: 'casa-ferramentas', termos: ['chave de fenda', 'chave philips'] },
  { ncm: '82032010', categoria: 'casa-ferramentas', termos: ['alicate', 'alicate universal', 'alicate de corte'] },
  { ncm: '82021000', categoria: 'casa-ferramentas', termos: ['serra', 'serra manual', 'serrote'] },
  { ncm: '73239100', categoria: 'casa-ferramentas', termos: ['panela de ferro', 'panela de ferro fundido'] },
  { ncm: '76151000', categoria: 'casa-ferramentas', termos: ['panela de pressao', 'panela de aluminio'] },
  // --- móveis ---
  { ncm: '94031000', categoria: 'moveis', termos: ['mesa de escritorio', 'estante de aco', 'arquivo de escritorio'] },
  { ncm: '94013900', categoria: 'moveis', termos: ['cadeira de escritorio', 'cadeira gamer', 'cadeira giratoria'] },
  { ncm: '94042100', categoria: 'moveis', termos: ['colchao', 'colchao de espuma', 'colchao casal'] },
  // --- papelaria / higiene ---
  { ncm: '96091000', categoria: 'papelaria-brinquedos', termos: ['lapis', 'lapis de cor', 'lapis preto'] },
  { ncm: '48202000', categoria: 'papelaria-brinquedos', termos: ['caderno', 'caderno espiral', 'caderno universitario'] },
  { ncm: '42021220', categoria: 'papelaria-brinquedos', termos: ['mochila', 'mochila escolar', 'mochila infantil'] },
  { ncm: '64039990', categoria: 'vestuario-calcados', termos: ['sapato social', 'sapato de couro'] },
  { ncm: '33051000', categoria: 'higiene-farmacia', termos: ['shampoo', 'shampoo anticaspa'] },
  { ncm: '34011190', categoria: 'higiene-farmacia', termos: ['sabonete', 'sabonete em barra'] },
  { ncm: '34013000', categoria: 'higiene-farmacia', termos: ['sabonete liquido', 'sabao liquido'] },
  // --- farmácia / químicos (nome comercial → NCM vigente; curadoria 2026-10) ---
  { ncm: '30041011', categoria: 'quimicos-farma', termos: ['amoxicilina', 'amoxilina'] },
  { ncm: '30045090', categoria: 'quimicos-farma', termos: ['vitamina', 'polivitaminico', 'suplemento vitaminico'] },
  { ncm: '30049099', categoria: 'quimicos-farma', termos: ['paracetamol', 'tylenol', 'medicamento generico'] },
  { ncm: '29331111', categoria: 'quimicos-farma', termos: ['dipirona', 'novalgina'] },
  { ncm: '29242912', categoria: 'quimicos-farma', termos: ['paracetamol insumo', 'acetaminofeno'] },
  { ncm: '29051100', categoria: 'quimicos-farma', termos: ['metanol', 'alcool metilico'] },
  { ncm: '33049910', categoria: 'quimicos-farma', termos: ['protetor solar', 'filtro solar', 'creme hidratante'] },
  { ncm: '34029039', categoria: 'quimicos-farma', termos: ['detergente concentrado', 'sabao em po'] },
  { ncm: '31052000', categoria: 'quimicos-farma', termos: ['adubo npk', 'fertilizante npk'] },
  { ncm: '32061110', categoria: 'quimicos-farma', termos: ['pigmento titanio', 'dioxido de titanio'] },
  // --- plásticos / borracha ---
  { ncm: '39011020', categoria: 'plasticos-borracha', termos: ['polietileno com carga', 'granulado de polietileno'] },
  { ncm: '40011000', categoria: 'plasticos-borracha', termos: ['latex natural', 'borracha natural'] },
  // --- madeira / papel ---
  { ncm: '44071100', categoria: 'madeira-papel', termos: ['tabua de pinus', 'madeira de pinus serrada'] },
  { ncm: '48025510', categoria: 'madeira-papel', termos: ['papel sulfite', 'papel para impressao'] },
  // --- máquinas / equipamentos ---
  { ncm: '84151011', categoria: 'maquinas-equipamentos', termos: ['ar condicionado split', 'arcondicionado split'] },
  { ncm: '85044010', categoria: 'maquinas-equipamentos', termos: ['carregador de celular', 'fonte chaveada'] },
  { ncm: '85176241', categoria: 'maquinas-equipamentos', termos: ['roteador wifi', 'roteador wireless'] },
  { ncm: '84713011', categoria: 'maquinas-equipamentos', termos: ['notebook ultrafino', 'laptop ultrafino'] },
  { ncm: '85171431', categoria: 'maquinas-equipamentos', termos: ['celular basico', 'telefone celular portatil'] },
  { ncm: '87089990', categoria: 'maquinas-equipamentos', termos: ['peca de carro', 'autopeca original'] },
  // --- instrumentos / ótica / médico ---
  { ncm: '90211010', categoria: 'instrumentos-otica', termos: ['aparelho ortopedico', 'ortese'] },
  { ncm: '90181100', categoria: 'instrumentos-otica', termos: ['eletrocardiografo', 'aparelho de ecg'] },
  { ncm: '90049090', categoria: 'instrumentos-otica', termos: ['oculos de sol', 'oculos de grau'] },
  // --- móveis / esporte / lazer ---
  { ncm: '94036000', categoria: 'moveis', termos: ['guarda roupa', 'roupeiro', 'armario de quarto'] },
  { ncm: '95069900', categoria: 'esporte-lazer', termos: ['bola de futebol', 'bola esportiva'] },
  { ncm: '96032100', categoria: 'esporte-lazer', termos: ['escova de dentes', 'escova dental'] },
  // --- metalurgia complementar ---
  { ncm: '73041100', categoria: 'metalurgia', termos: ['tubo inox', 'tubo de aco inoxidavel'] },
  { ncm: '73181100', categoria: 'metalurgia', termos: ['tirafundo', 'parafuso tirafundo'] },
  { ncm: '76041010', categoria: 'metalurgia', termos: ['barra chata de aluminio'] },
  { ncm: '52081100', categoria: 'textil', termos: ['tecido tafeta de algodao', 'tecido tafeta'] },
]

export interface AcertoDicionario {
  ncm: string
  /** Termo que casou (para trilha/auditoria). */
  termo: string
  categoria: EntradaDicionarioComercial['categoria']
}

/**
 * Busca nomes populares no texto (case/acentuação-insensíveis).
 * Frase (com espaço) casa por substring; palavra única, por token inteiro.
 * Retorna ordenado pelo termo mais longo primeiro (conflito resolve no
 * específico) e sem NCM repetido.
 */
export function buscarNoDicionarioComercial(texto: unknown): AcertoDicionario[] {
  const cru = normalizarBusca(texto)
  if (!cru) return []
  const tokens = new Set(cru.split(' ').filter(Boolean))
  const acertos: AcertoDicionario[] = []
  for (const entrada of DICIONARIO_COMERCIAL) {
    let melhor: string | null = null
    for (const termo of entrada.termos) {
      const ehFrase = termo.includes(' ')
      const casa = ehFrase ? cru.includes(termo) : tokens.has(termo)
      if (casa && (!melhor || termo.length > melhor.length)) melhor = termo
    }
    if (melhor) acertos.push({ ncm: entrada.ncm, termo: melhor, categoria: entrada.categoria })
  }
  acertos.sort((a, b) => b.termo.length - a.termo.length || a.ncm.localeCompare(b.ncm))
  const vistos = new Set<string>()
  return acertos.filter((a) => (vistos.has(a.ncm) ? false : (vistos.add(a.ncm), true)))
}
