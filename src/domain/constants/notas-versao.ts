/**
 * Notas da versão — fonte local do modal "Novidades" (`src/ui/ModalNovidades.tsx`).
 *
 * 100% embutido no build: nenhuma rede, nenhum backend. O job de novidades
 * (`src/store/novidades.ts`) compara a versão instalada com
 * `CHAVE_VERSAO_VISTA` e abre o modal quando esta tabela tem entrada para
 * a versão nova.
 *
 * COMO PUBLICAR UMA VERSÃO NOVA:
 *   1. Suba `version` em `package.json` (ex.: 1.0.0 -> 1.0.1).
 *   2. Adicione uma entrada aqui com a MESMA chave:
 *        "1.0.1": {
 *          novidades: ["Aurinha com 3 reações novas ao exportar", "..."],
 *          comentario: "Só quando houver aviso — ex.: ação necessária após atualizar.",
 *        },
 *   3. `comentario` é opcional: omita quando não houver aviso (o bloco some).
 *   4. Rode `npm run base:completa && npm run dist:win` e publique o Release.
 */

/** Uma entrada de notas: lista curta + aviso opcional. */
export interface NotasVersao {
  /** 3–5 bullets em linguagem de usuário (nunca jargão de commit). */
  novidades: string[]
  /**
   * Aviso opcional ("quando for o caso"): mudança de cálculo, ação necessária
   * após atualizar. Omitido = bloco não renderiza.
   */
  comentario?: string
  /** Data da release (AAAA-MM-DD, só informativo). */
  data?: string
}

export const NOTAS_VERSAO: Record<string, NotasVersao> = {
  '1.0.0': {
    data: '2026-10-03',
    novidades: [
      'Calculadora IBS/CBS por NCM com alíquotas de referência editáveis',
      'Simples Nacional: DAS por Anexo I–V, Fator R e duelo Convencional × Híbrido',
      'Consulta NCM com CST, cClassTrib, redução e base legal',
      'Serviços (NBS) por código, descrição ou CNPJ',
      'Notas Fiscais (XML) com layout Polida, apuração e relatório',
      'Classificação automática 100% local, sem enviar dados para a nuvem',
    ],
  },
}

/** Devolve as notas de uma versão, ou `null` quando não há entrada. */
export function notasDaVersao(versao: string): NotasVersao | null {
  return NOTAS_VERSAO[String(versao ?? '').trim()] ?? null
}

/** Última versão cujas notas o usuário já viu (localStorage, por máquina). */
export const CHAVE_VERSAO_VISTA = 'aurum:versao-novidades-vista'

/** Última versão nova já notificada para download (evita reabrir o modal). */
export const CHAVE_VERSAO_NOTIFICADA = 'aurum:versao-update-notificada'
