/**
 * Simples Nacional — validação fail-closed de entradas (RBT12/receita).
 *
 * Fonte única da guarda usada pelo motor estrito (`calcularConvencionalEstrito`)
 * e pela store da tela: Infinity/NaN/<=0 e RBT12 acima do teto NUNCA podem
 * virar DAS 0 exibível — lançam erro tipado com mensagem explícita.
 *
 * Pura: sem I/O, sem rede, sem banco.
 */

import { RBT12_MAX } from '@/simples/tabelas';

export interface RbtReceitaValidados {
  rbt12: number;
  receitaMes: number;
}

/**
 * Exige RBT12 e receita finitos e > 0, com RBT12 dentro do Simples (<= 4.8M).
 * - `!isFinite` (NaN/Infinity) ou <= 0 => erro `rbt12/receita-ausente-ou-invalido`.
 * - RBT12 > 4.8M => erro `desenquadramento-simples` (não projetar DAS).
 */
export function exigirRbtReceita(rbt12: number, receitaMes: number): RbtReceitaValidados {
  const rbt = Number(rbt12);
  const rec = Number(receitaMes);
  if (!Number.isFinite(rbt) || !(rbt > 0)) {
    throw new Error('rbt12-ausente-ou-invalido: informe RBT12 > 0');
  }
  if (!Number.isFinite(rec) || !(rec > 0)) {
    throw new Error('receita-ausente-ou-invalida: informe receitaMes > 0');
  }
  if (rbt > RBT12_MAX) {
    throw new Error('desenquadramento-simples: RBT12 acima de R$ 4.800.000 — não projetar');
  }
  return { rbt12: rbt, receitaMes: rec };
}

/* -------------------------------------------------------------------------- */
/* Fator R — coleta obrigatória, cálculo só quando sujeito (PROPOSTA §3)      */
/* -------------------------------------------------------------------------- */

export type CodigoValidacaoFatorR = 'folha12-ausente' | 'folha12-invalida' | 'rbt12-invalido';

export interface ResultadoValidacaoFatorR {
  ok: boolean;
  codigo?: CodigoValidacaoFatorR;
  /** pt-BR, pronta para toast. */
  mensagem?: string;
  /** Atividade sujeita ao Fator R (III/V ou CNAE com fatorR, e não dispensada). */
  aplicavel: boolean;
  /** Auditoria do "registrado, sem efeito" — a UI decide o que exibir. */
  origemNaoAplicavel?: 'anexo-sem-fator-r' | 'iii-puro' | 'nao-sujeito';
}

export interface ParamsValidacaoFatorR {
  folha12: number | null | undefined;
  /** Flag explícita da store/UI (zero real também conta como informado). */
  folhaInformada?: boolean;
  /** Usuário confirmou que não houve salários/pró-labore nos últimos 12 meses. */
  semFolhaConfirmado?: boolean;
  rbt12: number | null | undefined;
  /** Anexos normalizados ou formatos legados ('III / V', 'III,V'). */
  anexos: string[];
  /** op.exigeFatorR / tabela.fatorR do CNAE escolhido. */
  cnaeFatorR?: boolean;
  /** false = Anexo III puro / atividade dispensada. Default true. */
  sujeitaFatorR?: boolean;
}

const MSG_FOLHA_VAZIA = 'Informe a folha de salários dos últimos 12 meses (salários + pró-labore) para continuar.';
const MSG_FOLHA_ZERADA =
  'Folha 12m zerada. Confirme que não houve salários/pró-labore nos últimos 12 meses ou informe o valor correto.';
const MSG_FOLHA_INVALIDA = 'Folha 12m inválida. Use um número maior ou igual a zero (ex.: 150000).';
const MSG_RBT12_INVALIDO = 'RBT12 inválido. Informe o RBT12 maior que zero para validar a folha 12m.';
const MSG_III_PURO =
  'Atividade classificada como Anexo III puro: a folha fica registrada, mas não altera o enquadramento.';

/** Anexos que decidem III × V — tolerante a 'III / V', 'III,V', 'iii/v'. */
function anexosComFatorR(anexos: string[] | null | undefined): Set<string> {
  const encontrados = new Set<string>();
  for (const item of anexos ?? []) {
    for (const parte of String(item ?? '').toUpperCase().split(/[/,;|]/)) {
      const t = parte.trim();
      if (t === 'III' || t === 'V') encontrados.add(t);
    }
  }
  return encontrados;
}

/**
 * Guarda pura da folha 12m. Coleta obrigatória em TODAS as simulações
 * (I–V, manual ou CNPJ); o cálculo efetivo do Fator R é condicionado a
 * `aplicavel`, nunca à simples presença da folha.
 */
export function validarFolhaObrigatoria(entrada: ParamsValidacaoFatorR): ResultadoValidacaoFatorR {
  const comFatorR = anexosComFatorR(entrada.anexos);
  const temBaseFatorR = comFatorR.size > 0 || Boolean(entrada.cnaeFatorR);
  const sujeita = entrada.sujeitaFatorR !== false;
  const aplicavel = temBaseFatorR && sujeita;

  let origemNaoAplicavel: ResultadoValidacaoFatorR['origemNaoAplicavel'];
  if (!aplicavel) {
    if (!temBaseFatorR) origemNaoAplicavel = 'anexo-sem-fator-r';
    else if (comFatorR.has('III') && !comFatorR.has('V') && !entrada.cnaeFatorR) origemNaoAplicavel = 'iii-puro';
    else origemNaoAplicavel = 'nao-sujeito';
  }

  const falha = (codigo: CodigoValidacaoFatorR, mensagem: string): ResultadoValidacaoFatorR => ({
    ok: false,
    codigo,
    mensagem,
    aplicavel,
    origemNaoAplicavel,
  });

  // RBT12 é a base do índice: sem ele não há como validar a folha.
  const rbt = Number(entrada.rbt12);
  if (!Number.isFinite(rbt) || !(rbt > 0)) return falha('rbt12-invalido', MSG_RBT12_INVALIDO);

  const bruto = entrada.folha12;
  if (bruto === null || bruto === undefined) return falha('folha12-ausente', MSG_FOLHA_VAZIA);
  const folha = Number(bruto);
  if (!Number.isFinite(folha) || folha < 0) return falha('folha12-invalida', MSG_FOLHA_INVALIDA);

  // Compatibilidade: quem faz `setState({ folha12: X })` não precisa de flag.
  const informada = folha > 0 || entrada.semFolhaConfirmado === true || entrada.folhaInformada === true;
  if (!informada) {
    return falha('folha12-ausente', folha === 0 ? MSG_FOLHA_ZERADA : MSG_FOLHA_VAZIA);
  }

  if (!aplicavel) {
    const anexo = (entrada.anexos ?? [])[0];
    const rotulo = anexo ? String(anexo).toUpperCase().trim() : 'I';
    const mensagem =
      origemNaoAplicavel === 'iii-puro'
        ? MSG_III_PURO
        : origemNaoAplicavel === 'nao-sujeito'
          ? `Fator R registrado para conferência — sem efeito no Anexo ${rotulo}.`
          : `Folha 12m registrada. No Anexo ${rotulo} ela não altera a alíquota — o Fator R vale apenas para atividades sujeitas (III/V).`;
    return { ok: true, aplicavel, origemNaoAplicavel, mensagem };
  }

  return { ok: true, aplicavel };
}

/**
 * Versão "fail-closed" da guarda: lança Error com prefixo de código no mesmo
 * padrão de `exigirRbtReceita` (`codigo: mensagem`). A store usa a mensagem
 * para escolher o toast; a validação pura continua em `validarFolhaObrigatoria`.
 */
export function exigirFolha12(entrada: ParamsValidacaoFatorR): number {
  const r = validarFolhaObrigatoria(entrada);
  if (!r.ok) throw new Error(`${r.codigo}: ${r.mensagem}`);
  return Number(entrada.folha12) || 0;
}

