/**
 * Tipos para `scripts/build-base.mjs` (JS sem tipos), importado por
 * `tests/cnae-nbs-base.test.ts` para testar a lógica real de
 * conferência/consolidação da Phase 9. Tipos frouxos de propósito: o contrato
 * preciso é verificado pelos testes em runtime, não pelo `tsc`.
 */
export declare function fixLatin1(v: unknown): string
export declare function normalizarCnaeNbsLink(raw: unknown): any
export declare function normalizarLcNbsRelation(raw: unknown): any
export declare function normalizarCnaeNbs(bruto: unknown): any
export declare function normalizarTextoConferencia(v: unknown): string
export declare function construirClassificacoesConsolidadas(args: any): any
