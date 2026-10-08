/**
 * Persistência da RTB12 por CNPJ/período (localStorage, chave estável).
 *
 * PURA quanto ao formato; o acesso ao `localStorage` é isolado aqui para
 * facilitar testes (falha silenciosa fora do browser).
 */
import type { MesReceita } from './types';

function chave(cnpj: string, periodo: string): string {
  const digitos = String(cnpj ?? '').replace(/\D+/g, '') || 'sem-cnpj';
  return `aurum:rtb12:${digitos}:${periodo}`;
}

export function salvarRTB12(cnpj: string, periodo: string, historico: MesReceita[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(chave(cnpj, periodo), JSON.stringify({ salvoEm: new Date().toISOString(), historico }));
  } catch {
    /* armazenamento indisponível — segue sem persistir */
  }
}
