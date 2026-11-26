/**
 * Simples Nacional — tipos da "cena" derivada de `page.tsx:415-577`.
 *
 * Este módulo é somente de tipos (sem React, sem I/O). `SimplesState` é uma
 * VIEW ESTRUTURAL do estado da store: `store.ts` não exporta a interface, e
 * todos os campos abaixo são os mesmos tipos importados de `./store`. O
 * estado completo (com as ações) é atribuível a esta view — basta passar
 * `useSimples()` / `useSimples.getState()` diretamente.
 */
import type { fatorR, Reparticao, ResultadoConvencional, ResultadoHibrido } from './calculo';
import type { ResultadoSegregado } from './segregacao-receita';
import type { AnexoSimplesId, TributoSimples } from './tabelas';
import type {
  CnaeOpcao,
  DespesaSimples,
  ModoSimples,
  ParcelaSegStore,
  PrevisaoFatorR,
} from './store';
import type { DadosDas } from './DasModal';

/** Campos do estado da store consumidos por `montarCenaSimples`. */
export interface SimplesState {
  modo: ModoSimples;
  anexoId: AnexoSimplesId;
  escolheuAnexo: boolean;
  rbt12: number;
  receitaMes: number;
  folha12: number;
  /** Flags da obrigatoriedade do Fator R (PROPOSTA §3). */
  folhaInformada: boolean;
  semFolhaConfirmado: boolean;
  sujeitaFatorR: boolean;
  rba: number;
  usarRba: boolean;
  cbsRef: number;
  aliqRefICMS: number | null;
  aliqRefISS: number | null;
  despesas: DespesaSimples[];
  compararHibrido: boolean;
  cnpj: string;
  buscandoCnpj: boolean;
  empresaNome: string;
  opcaoSimples: boolean | null;
  opcoes: CnaeOpcao[];
  cnaeEscolhido: string;
  relatorioVisivel: boolean;
  convencional: ResultadoConvencional | null;
  hibrido: ResultadoHibrido | null;
  debitosCBS: number;
  creditosCBS: number;
  segAtivo: boolean;
  segParcelas: ParcelaSegStore[];
}

/** Resumo da ST exibido na guia/exports (`null` sem ST com dedução). */
export interface StResumo {
  tributo: string;
  valorST: number;
  deducao: number;
  detalhe: string;
}

/**
 * Todas as variáveis derivadas de `s` (e da flag local `gerando`) extraídas
 * dos `useMemo`/consts de `page.tsx:415-577` + repartição (`:744-746`).
 *
 * `reparticaoVisiveis` NÃO faz parte da cena: depende da flag local
 * `reparticaoAberta` do componente e deve ser calculada nele como
 * `reparticaoAberta ? cena.reparticaoItens : cena.reparticaoItens.slice(0, 4)`.
 */
export interface CenaSimples {
  pronta1: boolean;
  valoresOk: boolean;
  estouradoPasso1: boolean;
  comFolha: boolean;
  segTemFatorR: boolean;
  precisaFolha: boolean;
  previsaoFR: PrevisaoFatorR | null;
  segSoma: number;
  segExcesso: boolean;
  segValida: boolean;
  segRestoAnexo: AnexoSimplesId;
  segResto: number;
  segResultado: ResultadoSegregado | null;
  convBase: ResultadoConvencional | null;
  convExib: ResultadoConvencional | null;
  dasExib: number;
  cargaTotalExib: number;
  repExib: Reparticao | undefined;
  dasBruto: number;
  deducaoSTPorTributo: Partial<Record<'ICMS' | 'ISS', number>>;
  infoSTPorTributo: Partial<Record<'ICMS' | 'ISS', string>>;
  repBrutaExib: Reparticao | undefined;
  stResumo: StResumo | null;
  hibExib: ResultadoHibrido | null;
  dadosDas: DadosDas | null;
  /** `fatorR(folha12, rbt12)` — objeto `{ indice, anexo }`, não um número. */
  fr: ReturnType<typeof fatorR> | null;
  anexosEfetivosRefs: AnexoSimplesId[];
  mostraRefICMS: boolean;
  mostraRefISS: boolean;
  previaConv: ResultadoConvencional | null;
  podeVisualizar: boolean;
  /** `s.relatorioVisivel && s.convencional` — mantém o tipo original. */
  mostrando: ResultadoConvencional | null | false;
  reparticao: Reparticao | undefined;
  reparticaoItens: TributoSimples[];
}
