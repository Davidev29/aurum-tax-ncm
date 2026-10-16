/**
 * Mapa central de erros da camada Aurumbit → Toast comportado (item 2).
 *
 * Todo fluxo de conta/chave/faturas/renovação converte o erro AQUI:
 *   - `mapearErro()` traduz `ErroAurum` (ou qualquer `Error`) em
 *     `{ codigo, mensagem, tipo }` pronto para `toast()` + texto inline;
 *   - `notificarErro()` mapeia E já dispara o toast (retorna o mapeado para
 *     a tela preencher o `erro` inline junto);
 *   - `textoGate()` / `notificarPosAtivacao()` cobrem o caso traiçoeiro do
 *     "ativou mas não liberou": HTTP 200 com gate ainda `DENY`/`GRACE`
 *     (assinatura vencida, revogada, token offline vencido…).
 *
 * Invariantes:
 *   - nenhuma mensagem expõe a chave integral `AURUM-…` (só `••••-WXYZ`
 *     via `mascararChave()` no chamador);
 *   - `REDE` é sempre `warn` (modo offline permitido, nunca pânico);
 *   - credencial errada no login vira orientação ("confira e-mail/senha"),
 *     não "sessão expirada".
 */

import { ErroAurum } from './api';
import { textoNegacao } from './gate';
import type { MotivoGate, ResultadoGate } from './types';
import { useUi, type TipoToast } from '@/store/ui';

export interface ErroMapeado {
  codigo: string | null;
  mensagem: string;
  tipo: TipoToast;
}

/** Contexto de onde o erro nasceu — ajusta o texto sem mudar o código. */
export type ContextoErro = 'login' | 'chave' | 'redefinicao' | 'faturas' | 'renovar' | 'geral';

const MAPA_BASE: Record<string, { mensagem: string; tipo: TipoToast }> = {
  AUTH: { mensagem: 'Sessão expirada — entre novamente.', tipo: 'err' },
  ACCOUNT_NO_LICENSE: {
    mensagem: 'Esta conta não tem licença ativa — cole sua chave abaixo para concluir.',
    tipo: 'warn',
  },
  DEVICE_LIMIT: {
    mensagem: 'Limite de dispositivos atingido — libere um slot no painel e tente de novo.',
    tipo: 'warn',
  },
  DEVICE_CONFLICT: {
    mensagem: 'Esta chave já está em uso em outro dispositivo.',
    tipo: 'warn',
  },
  KEY_INVALID: {
    mensagem: 'Chave inválida — confira os 3 blocos (formato AURUM-XXXX-XXXX-XXXX).',
    tipo: 'warn',
  },
  LICENSE_INACTIVE: {
    mensagem: 'Licença inativa — regularize a assinatura em Faturas.',
    tipo: 'err',
  },
  DEVICE_BLOCKED: {
    mensagem: 'Este dispositivo foi bloqueado — fale com o suporte.',
    tipo: 'err',
  },
  REDE: {
    mensagem: 'Sem conexão com o servidor — verifique a internet. O app segue no modo offline permitido.',
    tipo: 'warn',
  },
  RATE_LIMITED: {
    mensagem: 'Muitas tentativas — aguarde um pouco e tente de novo.',
    tipo: 'warn',
  },
  SERVIDOR: {
    mensagem: 'Servidor instável agora — aguarde instantes e tente de novo.',
    tipo: 'err',
  },
  RESPOSTA_INVALIDA: {
    mensagem: 'Resposta incompleta do servidor — tente de novo em instantes.',
    tipo: 'err',
  },
};

const MENSAGEM_PADRAO: ErroMapeado = {
  codigo: null,
  mensagem: 'Algo não saiu como esperado — tente de novo.',
  tipo: 'err',
};

/** Remove eventual chave integral ecoada pelo servidor antes de exibir. */
function higienizar(texto: string): string {
  return texto.replace(/AURUM-[A-Z0-9-]{4,}/gi, '••••-XXXX').trim();
}

/**
 * Traduz qualquer erro em mensagem de interface. Nunca lança.
 * `contexto='login'` troca o `AUTH` genérico por orientação de credencial.
 */
export function mapearErro(e: unknown, contexto: ContextoErro = 'geral'): ErroMapeado {
  const codigo = e instanceof ErroAurum ? e.code : null;
  if (codigo) {
    if (codigo === 'AUTH' && (contexto === 'login' || contexto === 'geral')) {
      return {
        codigo,
        mensagem: 'Não foi possível entrar — confira o e-mail e a senha e tente de novo.',
        tipo: 'err',
      };
    }
    // `429`: informa a espera do `Retry-After` quando o servidor a enviou.
    if (codigo === 'RATE_LIMITED') {
      const segs = e instanceof ErroAurum ? e.retryAfterSeg : null;
      return {
        codigo,
        mensagem: typeof segs === 'number' && segs > 0
          ? `Muitas tentativas — aguarde ~${segs}s e tente de novo.`
          : MAPA_BASE.RATE_LIMITED.mensagem,
        tipo: 'warn',
      };
    }
    const base = MAPA_BASE[codigo];
    if (base) {
      // Preserva o detalhe do servidor quando ele acrescenta contexto útil
      // (ex.: "HTTP 500 …"), higienizado — a chave nunca é exibida.
      const detalhe = e instanceof Error ? higienizar(e.message) : '';
      const usaDetalhe =
        (codigo === 'SERVIDOR' || codigo === 'RESPOSTA_INVALIDA') &&
        detalhe &&
        detalhe !== base.mensagem &&
        detalhe.length < 220;
      return {
        codigo,
        mensagem: usaDetalhe ? `${base.mensagem} (${detalhe})` : base.mensagem,
        tipo: base.tipo,
      };
    }
    return { codigo, mensagem: e instanceof Error ? higienizar(e.message) || MENSAGEM_PADRAO.mensagem : MENSAGEM_PADRAO.mensagem, tipo: 'err' };
  }
  if (e instanceof Error) {
    const msg = higienizar(e.message ?? '');
    if (msg) return { codigo: null, mensagem: msg.length < 220 ? msg : MENSAGEM_PADRAO.mensagem, tipo: 'err' };
  }
  if (typeof e === 'string' && e.trim()) {
    const s = higienizar(e);
    return { codigo: null, mensagem: s.length < 220 ? s : MENSAGEM_PADRAO.mensagem, tipo: 'err' };
  }
  return { ...MENSAGEM_PADRAO };
}

/**
 * Mapeia E dispara o toast (erros ficam 6s na tela, avisos 4,5s).
 * Retorna o mapeado para a tela espelhar no texto inline junto.
 */
export function notificarErro(e: unknown, contexto: ContextoErro = 'geral'): ErroMapeado {
  const m = mapearErro(e, contexto);
  try {
    useUi.getState().toast(m.mensagem, m.tipo, m.tipo === 'err' ? 6000 : 4500);
  } catch {
    /* store indisponível em testes: o retorno segue usável */
  }
  return m;
}

/** Texto do gate APÓS uma ativação/renovação com HTTP 200. */
export function textoGate(gate: ResultadoGate): { mensagem: string; tipo: TipoToast } {
  if (gate.decisao !== 'DENY') {
    if (gate.motivo === 'GRACE') {
      return {
        mensagem: 'Licença ativada em período de graça — renove para liberar todos os recursos.',
        tipo: 'warn',
      };
    }
    return { mensagem: 'Licença ativada. Bom trabalho!', tipo: 'ok' };
  }
  const motivo: MotivoGate = gate.motivo;
  switch (motivo) {
    case 'EXPIRED':
      return { mensagem: 'Ativação registrada, mas a assinatura está vencida — renove em Faturas para liberar.', tipo: 'err' };
    case 'OFFLINE_EXPIRED':
      return { mensagem: 'Ativação registrada, mas o token offline venceu — reconecte e ative de novo.', tipo: 'err' };
    case 'REVOKED':
      return { mensagem: 'Esta licença foi revogada — fale com o suporte ou ative outra licença.', tipo: 'err' };
    case 'SUSPENDED':
      return { mensagem: 'Licença suspensa (pagamento pendente?) — quite em Faturas ou fale com o suporte.', tipo: 'err' };
    case 'TOKEN_MISMATCH':
      return { mensagem: 'Sessão dessincronizada após ativar — entre novamente para sincronizar.', tipo: 'err' };
    case 'UNKNOWN_DEVICE':
    case 'DEVICE_BLOCKED':
    case 'CLONE_SUSPECT':
    case 'LICENSE_INACTIVE':
      return { mensagem: textoNegacao(motivo), tipo: 'err' };
    case 'NO_LICENSE':
    default:
      return { mensagem: 'Ativação concluída, mas sem licença válida — tente de novo.', tipo: 'err' };
  }
}

/**
 * Verifica o gate pós-ativação e toasta conforme o resultado.
 * Retorna `true` quando liberado (`ALLOW`, pleno ou graça).
 */
export function notificarPosAtivacao(gate: ResultadoGate, chaveMascarada?: string): boolean {
  const t = textoGate(gate);
  const liberado = gate.decisao !== 'DENY';
  const sufixo = chaveMascarada ? ` (${chaveMascarada})` : '';
  try {
    useUi.getState().toast(
      liberado && t.tipo === 'ok' ? `${t.mensagem.replace(/\.$/, '')}${sufixo}.` : t.mensagem,
      t.tipo,
      t.tipo === 'ok' ? 4500 : 6000,
    );
  } catch {
    /* ignora */
  }
  return liberado;
}
