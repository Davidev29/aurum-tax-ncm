/**
 * Simples Nacional — Projeção multi-empresa (camada ADITIVA).
 *
 * REGRA DE OURO: este diretório NUNCA importa internals de `@/simples/*`
 * além dos exports públicos de `calculo.ts` e `tabelas.ts`.
 * Não reimplementa alíquota, DAS, faixa ou Fator R — apenas orquestra.
 *
 * Etapa 2 — esqueleto tipado (sem implementação).
 * Etapas 3/4/5 preenchem cada módulo.
 */

export * from './types';
export * from './janela-rbt12';
export * from './cenario-dividido';
export * from './entrada';
export * from './relatorio';
export * from './ferramentas';
