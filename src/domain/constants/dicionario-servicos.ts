/**
 * Dicionário comercial de SERVIÇOS — nomes populares → NBS exato.
 *
 * Espelho de `@/domain/constants/dicionario-comercial` (bens) para o domínio
 * NBS. Problema: a base NBS usa juridiquês ("Fornecimento dos serviços de
 * educação (Anexo II)") e omite o nome que o usuário digita ("autoescola",
 * "dentista", "show"). Sem esta ponte, o RAG lexical nunca matcha e a IA
 * responde vazio até para o trivial.
 *
 * Papel: FONTE DE CANDIDATOS, nunca decisão. Cada pin passa pelo resolvedor
 * (`resolverClassificacoesNbs`): pin sem vínculo na base atual é descartado,
 * nunca vira resposta. Só setores COM benefício mapeado têm pins — fora de
 * benefício (beleza, frete, limpeza...) o caminho honesto é regra geral +
 * orientação setorial, nunca pin forçado.
 *
 * Regras de curadoria (leia antes de adicionar):
 * - `nbs`: 9 dígitos com vínculo de benefício na base viva
 *   (`bases-fonte/NBS SERVIÇOS.json`); códigos verificados em 2026-10:
 *   122011100 (educação), 123011100 (saúde), 111031000 (Anexo X),
 *   115012000 (soberania XI), 120013500 (cibernética XI);
 * - `termos`: já normalizados (minúsculas, sem acento — ver `normalizarBusca`);
 *   termo de 1 palavra só quando INEQUÍVOCO sozinho (`dentista` ✓,
 *   `show` ✓, `consulta` ✗ — consulta fiscal não é saúde;
 *   `curso` ✗ sozinho? curso é sempre ensino ✓ — mantido;
 *   `festa` ✗ — festa junina de rua ≠ produção nacional? mantido SÓ em frase);
 * - match: frase casa por substring; palavra única, por token inteiro;
 *   em conflito vence o termo MAIS LONGO.
 */

import { normalizarBusca } from '@/domain/services/busca-texto'

export interface EntradaDicionarioServicos {
  /** NBS de 9 dígitos (só dígitos), com benefício na base viva. */
  nbs: string
  /** Termos normalizados que disparam este pin (frase ou palavra inequívoca). */
  termos: string[]
  /** Setor para auditoria/organização. */
  categoria: 'educacao' | 'saude' | 'cultura-eventos' | 'seguranca' | 'ciber'
}

export const DICIONARIO_SERVICOS: EntradaDicionarioServicos[] = [
  // --- educação (Anexo II / 200028; "autoescola" ∉ juridiquês) ---
  {
    nbs: '122011100',
    categoria: 'educacao',
    termos: [
      'autoescola',
      'cursinho',
      'vestibular',
      'enem',
      'faculdade',
      'universidade',
      'colegio',
      'escola',
      'creche',
      'escolinha',
      'curso',
      'aula',
      'aula de ingles',
      'aula particular',
      'curso de idioma',
      'curso de ingles',
      'escola de idiomas',
      'formacao de condutores',
      'reforco escolar',
      'curso preparatorio',
      'curso livre',
      'treinamento',
      'ensino',
    ],
  },
  // --- saúde (Anexo III / 200029; "dentista" ∉ juridiquês) ---
  {
    nbs: '123011100',
    categoria: 'saude',
    termos: [
      'dentista',
      'dentistas',
      'odontologia',
      'odonto',
      'ortodontia',
      'fisioterapia',
      'fisioterapeuta',
      'psicologo',
      'psicologia',
      'nutricionista',
      'vacina',
      'vacinacao',
      'ultrassom',
      'ultrassonografia',
      'raiox',
      'mamografia',
      'hemograma',
      'checkup',
      'clinica',
      'hospital',
      'pronto socorro',
      'consulta medica',
      'exame de sangue',
      'atendimento domiciliar',
      'laboratorio',
      'cirurgia',
      'emergencia',
    ],
  },
  // --- cultura/eventos/audiovisual (Anexo X / 200039) ---
  // Atenção: o benefício exige destinação nacional — o pin vira candidato
  // com ambiguidade (teto `media`), nunca decisão seca.
  {
    nbs: '111031000',
    categoria: 'cultura-eventos',
    termos: [
      'show',
      'shows',
      'teatro',
      'teatros',
      'cinema',
      'filme',
      'filmes',
      'serie',
      'series',
      'novela',
      'circo',
      'museu',
      'festival',
      'carnaval',
      'exposicao',
      'feira',
      'congresso',
      'show musical',
      'show ao vivo',
      'espetaculo teatral',
      'peca de teatro',
      'festa de casamento',
      'festa de aniversario',
      'desfile de carnaval',
      'festival de musica',
      'feira de artesanato',
      'programa',
    ],
  },
  // --- soberania/segurança patrimonial (Anexo XI / 200043) ---
  {
    nbs: '115012000',
    categoria: 'seguranca',
    termos: [
      'vigilancia',
      'vigilante',
      'monitoramento',
      'portaria',
      'escolta',
      'alarme',
      'seguranca patrimonial',
      'portaria virtual',
      'camera de seguranca',
      'ronda',
    ],
  },
  // --- cibersegurança (Anexo XI / 200044; exige sócio brasileiro ≥20%) ---
  {
    nbs: '120013500',
    categoria: 'ciber',
    termos: [
      'firewall',
      'pentest',
      'antivirus',
      'ransomware',
      'phishing',
      'malware',
      'lgpd',
      'ciberseguranca',
      'cibernetica',
      'teste de invasao',
      'seguranca da informacao',
      'criptografia',
    ],
  },
]

export interface AcertoDicionarioServicos {
  nbs: string
  /** Termo que casou (para trilha/auditoria). */
  termo: string
  categoria: EntradaDicionarioServicos['categoria']
}

/**
 * Busca nomes populares no texto (case/acentuação-insensíveis).
 * Frase (com espaço) casa por substring; palavra única, por token inteiro.
 * Retorna ordenado pelo termo mais longo primeiro (conflito resolve no
 * específico) e sem NBS repetido.
 */
export function buscarNoDicionarioServicos(texto: unknown): AcertoDicionarioServicos[] {
  const cru = normalizarBusca(texto)
  if (!cru) return []
  const tokens = new Set(cru.split(' ').filter(Boolean))
  const acertos: AcertoDicionarioServicos[] = []
  for (const entrada of DICIONARIO_SERVICOS) {
    let melhor: string | null = null
    for (const termo of entrada.termos) {
      const ehFrase = termo.includes(' ')
      const casa = ehFrase ? cru.includes(termo) : tokens.has(termo)
      if (casa && (!melhor || termo.length > melhor.length)) melhor = termo
    }
    if (melhor) acertos.push({ nbs: entrada.nbs, termo: melhor, categoria: entrada.categoria })
  }
  acertos.sort((a, b) => b.termo.length - a.termo.length || a.nbs.localeCompare(b.nbs))
  const vistos = new Set<string>()
  return acertos.filter((a) => (vistos.has(a.nbs) ? false : (vistos.add(a.nbs), true)))
}
