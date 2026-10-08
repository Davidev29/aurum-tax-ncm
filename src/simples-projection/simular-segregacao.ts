/**
 * Endpoint documentado da simulação de segregação.
 *
 * Payload:
 * ```json
 * {
 *   "mesInicio": "2026-10",
 *   "receitaTotalMensal": [{ "mes": "2026-10", "receita": 120000 }],
 *   "percentualNova": 0.35,
 *   "mae": { "anexoId": "III", "folha12": 400000, "historico12": [...] },
 *   "nova": { "anexoId": "III", "folha12": 0, "historico12": [], "mesesAtividade": 0 },
 *   "custoMensalNova": 2500,
 *   "custoInicialNova": 1500,
 *   "margemEmpate": 1000
 * }
 * ```
 *
 * Response: `RelatorioProjecao` — `serieMensal[]` (RBT12/faixa/alíquota/DAS
 * por empresa + economia bruta/líquida/acumulada), `payback` (mesVirada,
 * mes de payback, veredito compensa/nao-compensa/empate-tecnico),
 * `economiaTotal`, `alertas`, `analiseFatorR`, `analiseRetorno`, `metadados`.
 *
 * Wrapper fino sobre o motor puro (sem I/O): valida, simula e retorna o
 * envelope `{ ok, dados } | { ok: false, erro }` para uso via IA/HTTP.
 */
import { simularCenarioDividido } from './cenario-dividido';
import type { ParamsCenarioDividido, RelatorioProjecao } from './types';

export interface RespostaSimularSegregacao {
  ok: boolean;
  dados?: RelatorioProjecao;
  erro?: string;
}

/**
 * `POST /projecoes/simular-segregacao` (lógica do handler — o roteamento
 * HTTP/Electron fica na camada de infraestrutura).
 */
export function simularSegregacao(params: ParamsCenarioDividido): RespostaSimularSegregacao {
  try {
    const dados = simularCenarioDividido(params);
    return { ok: true, dados };
  } catch (e) {
    return { ok: false, erro: String((e as Error)?.message ?? e) };
  }
}
