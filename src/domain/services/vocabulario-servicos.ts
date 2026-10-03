/**
 * Vocabulário de SERVIÇOS (Phase 7) — dia a dia → texto oficial dos NBS.
 *
 * Espelho de `./vocabulario` para bens: a inferência só EXPANDE a consulta —
 * a prova continua sendo o match no vínculo NBS + resolvedor.
 * Termos únicos presentes literalmente na Base Legal dos NBS.
 */
export const SINONIMOS_SERVICOS: Record<string, string> = {
  // Educação (Anexo LC214 II / 200028)
  escola: 'educacao',
  colegio: 'educacao',
  faculdade: 'educacao',
  universidade: 'educacao',
  curso: 'educacao',
  aula: 'educacao',
  ensino: 'educacao',
  treinamento: 'educacao',
  idioma: 'educacao',
  ingles: 'educacao',
  // Saúde (Anexo LC214 III / 200029)
  medico: 'saude',
  hospital: 'saude',
  clinica: 'saude',
  consulta: 'saude',
  exame: 'saude',
  dentista: 'saude',
  odontologia: 'saude',
  fisioterapia: 'saude',
  enfermagem: 'saude',
  terapia: 'saude',
  psicologo: 'saude',
  // Cultura/eventos (Anexo LC214 X / 200039)
  show: 'espetaculo',
  teatro: 'teatral',
  cinema: 'filme',
  filme: 'filme',
  serie: 'serie',
  novela: 'novela',
  evento: 'evento',
  feira: 'feira',
  congresso: 'congresso',
  palestra: 'evento',
  musica: 'musical',
  banda: 'musical',
  jornalismo: 'jornalistico',
  programa: 'programa',
  // Soberania/segurança (Anexo LC214 XI / 200043-44)
  ciberseguranca: 'cibernetica',
  hacker: 'cibernetica',
  antivirus: 'informacao',
  software: 'informacao',
  // Genéricos de serviço
  servico: 'servico',
  prestacao: 'fornecimento',
  fornecimento: 'fornecimento',
  consultoria: 'servico',
  assessoria: 'servico',
  // Morfologia formal dos CNAEs (feminino/plural → termo da base)
  medica: 'saude',
  aulas: 'educacao',
  cursos: 'educacao',
  escolas: 'educacao',
  shows: 'espetaculo',
  teatros: 'teatral',
  filmes: 'filme',
  series: 'serie',
  viagem: 'turismo',
  viagens: 'turismo',
  hoteis: 'hotelaria',
  hotel: 'hotelaria',
  contabilidade: 'contabilistas',
  contabil: 'contabilistas',
  advocacia: 'advogados',
  juridica: 'advogados',
  juridicas: 'advogados',
}

/** Expande um token para o vocabulário dos NBS (ou `null`). */
export function expandirSinonimoServico(token: string): string | null {
  return SINONIMOS_SERVICOS[token] ?? null
}
