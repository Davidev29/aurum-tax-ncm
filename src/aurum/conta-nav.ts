/**
 * Deep-link para a seção Conta do Configurações.
 *
 * O financeiro mora em Configurações → Conta (nunca na tela inicial nem no
 * topo do app). Quem precisa levar o usuário até lá — banner de graça,
 * botões de renovação — chama `abrirContaEmConfig()`; o `ModalConfig`
 * consome a intenção ao abrir (`consumirAbaContaInicial()`).
 */
import { useUi } from '@/store/ui';

let abaContaPendente = false;

/** Abre Configurações já na aba Conta (licença + pagamentos). */
export function abrirContaEmConfig(): void {
  abaContaPendente = true;
  useUi.getState().abrirModal('config');
}

/** Consome a intenção de deep-link (uso único por abertura). */
export function consumirAbaContaInicial(): boolean {
  const v = abaContaPendente;
  abaContaPendente = false;
  return v;
}
