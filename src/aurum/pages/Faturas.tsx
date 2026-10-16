/**
 * Tela de faturas — lista/baixa + checkout Asaas + renovação (item 5).
 *
 *   - `GET {BFF}/invoices` lista com download (PDF/boleto);
 *   - renovação: `productCode` vem do build; `planId` é o UUID do plano —
 *     fixo via build (`VITE_AURUM_PLAN_ID`) ou escolhido em
 *     `GET {Nest}/products/:code/plans` (só ACTIVE);
 *   - `POST {BFF}/checkout { items:[{productCode,planId}] }` gera a cobrança;
 *     com `asaasUrl`, abre o navegador e faz poll de `GET {BFF}/checkout?id=`
 *     até `PAID` → re-ativa (`renovar()`);
 *   - `PENDING` nunca libera: o gate só muda após `PAID` + re-activate.
 * Sem sessão (deslogado), orienta entrar primeiro — não toca no core.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErroAurum, aguardarPagamento, criarCheckout, listarFaturas, listarPlanos } from '../api';
import { codigoProduto, planoPadrao } from '../config';
import { notificarErro } from '../erros';
import { useLicenca } from '../store';
import { abrirUrlExterna, lerSessao } from '../storage';
import { Btn, Campo, Painel, Pill, Selecao, Spinner, Vazio } from '@/ui/kit';
import { useUi } from '@/store/ui';
import type { Fatura, Plano } from '../types';

function fmtValor(f: Fatura): string {
  if (typeof f.valor !== 'number') return '—';
  try {
    return f.valor.toLocaleString('pt-BR', { style: 'currency', currency: f.moeda ?? 'BRL' });
  } catch {
    return String(f.valor);
  }
}

function fmtData(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

function corStatus(status: string): 'emerald' | 'amber' | 'red' | 'slate' {
  const s = status.toUpperCase();
  if (s.includes('PAID') || s.includes('PAGA') || s.includes('ATIVA')) return 'emerald';
  if (s.includes('PEND') || s.includes('ABERTA') || s.includes('AGUARD')) return 'amber';
  if (s.includes('VENC') || s.includes('OVERDUE') || s.includes('CANC') || s.includes('EXPIR')) return 'red';
  return 'slate';
}

export function Faturas() {
  const email = useLicenca((s) => s.email);
  const renovar = useLicenca((s) => s.renovar);
  const toast = useUi((s) => s.toast);

  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semSessao, setSemSessao] = useState(false);

  // Produto/plano vêm do build ou da lista oficial — nunca digitados à mão.
  const planoFixo = planoPadrao();

  const productCode = codigoProduto();
  const [planId, setPlanId] = useState(planoFixo);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [carregandoPlanos, setCarregandoPlanos] = useState(false);
  const [erroPlanos, setErroPlanos] = useState<string | null>(null);
  const [pagando, setPagando] = useState(false);
  const [aguardando, setAguardando] = useState<string | null>(null);
  const canceladoRef = useRef(false);

  const carregar = useCallback(async (silencioso = false) => {
    setCarregando(true);
    setErro(null);
    try {
      const sessao = await lerSessao();
      if (!sessao) {
        setSemSessao(true);
        setFaturas([]);
        if (!silencioso) toast('Entre na aba Entrar para ver suas faturas.', 'warn', 4500);
        return;
      }
      setSemSessao(false);
      setFaturas(await listarFaturas(sessao.token));
    } catch (e) {
      const m = silencioso ? null : notificarErro(e, 'faturas');
      setErro(m ? m.mensagem : e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(true);
    return () => {
      canceladoRef.current = true;
    };
  }, [carregar, email]);

  // Sem plano fixo no build: lista os ACTIVE em `GET /v1/products/:code/plans`.
  useEffect(() => {
    if (planoFixo) return;
    let vivo = true;
    setCarregandoPlanos(true);
    setErroPlanos(null);
    void (async () => {
      try {
        const sessao = await lerSessao().catch(() => null);
        const lista = await listarPlanos(productCode, sessao?.token ?? null);
        if (!vivo) return;
        setPlanos(lista);
        // Pré-seleciona o primeiro para renovar em 1 toque.
        if (lista.length > 0) setPlanId((atual) => atual || lista[0].id);
        if (lista.length === 0) {
          const msg = 'Nenhum plano ativo para este produto — fale com o suporte.';
          setErroPlanos(msg);
          toast(msg, 'warn', 4500);
        }
      } catch (e) {
        if (vivo) {
          const m = notificarErro(e, 'faturas');
          setErroPlanos(m.mensagem);
        }
      } finally {
        if (vivo) setCarregandoPlanos(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [planoFixo, productCode]);

  const abrirCobranca = (f: Fatura) => {
    const url = f.boletoUrl ?? f.pdfUrl;
    if (!url) {
      toast('Esta fatura não tem link de cobrança.', 'warn', 4500);
      return;
    }
    void abrirUrlExterna(url).catch(() => toast('Não foi possível abrir o navegador.', 'err', 6000));
  };

  /** Checkout → navegador → poll até PAID → re-activate. */
  const pagarRenovar = async () => {
    if (!planId.trim()) {
      toast('Escolha um plano para gerar a cobrança.', 'warn', 4500);
      return;
    }
    setPagando(true);
    setErro(null);
    canceladoRef.current = false;
    try {
      const sessao = await lerSessao();
      if (!sessao) {
        setSemSessao(true);
        throw new ErroAurum('AUTH', 'Entre novamente para gerar a cobrança.');
      }
      const criado = await criarCheckout(
        sessao.token,
        [{ productCode, planId: planId.trim() }],
      );
      if (criado.asaasUrl) {
        await abrirUrlExterna(criado.asaasUrl);
        toast('Checkout aberto no navegador — conclua o pagamento.', 'ok', 4500);
      } else {
        toast('Cobrança gerada — conclua o pagamento.', 'ok', 4500);
      }
      setAguardando(criado.checkoutId);
      const pago = await aguardarPagamento(sessao.token, criado.checkoutId);
      if (canceladoRef.current) return;
      setAguardando(null);
      if (!pago) {
        toast('Pagamento ainda pendente — o acesso libera após a confirmação (PAID).', 'warn', 6000);
        return;
      }
      // PAID → re-activate (único caminho que libera o gate).
      try {
        await renovar();
      } catch (eRen) {
        const m = notificarErro(eRen, 'renovar');
        setErro(`Pagamento confirmado, mas a reativação falhou: ${m.mensagem}`);
        return;
      }
      toast('Pagamento confirmado — licença reativada!', 'ok', 4500);
      await carregar(true);
    } catch (e) {
      setAguardando(null);
      const m = notificarErro(e, 'faturas');
      setErro(m.mensagem);
    } finally {
      setPagando(false);
    }
  };

  return (
    <div className="space-y-4">
      <Painel className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">🧾 Faturas da conta{email ? ` · ${email}` : ''}</h3>
          <Btn tam="sm" carregando={carregando} onClick={() => void carregar()}>↻ Atualizar</Btn>
        </div>
        {semSessao ? (
          <p className="text-xs text-slate-500">Entre na aba <strong>Entrar / Reativar</strong> para ver suas faturas.</p>
        ) : erro ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{erro}</p>
        ) : faturas.length === 0 && !carregando ? (
          <Vazio icone="🧾" titulo="Nenhuma fatura" texto="Quando houver cobranças (renovação, upgrade), elas aparecem aqui." />
        ) : (
          <div className="space-y-2">
            {faturas.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{f.descricao ?? f.numero ?? f.id}</div>
                  <div className="text-[11px] text-slate-400">
                    {fmtValor(f)} · vence {fmtData(f.vencimento)}
                    {f.linhaDigitavel ? ` · ${f.linhaDigitavel}` : ''}
                  </div>
                </div>
                <Pill cor={corStatus(f.status)}>{f.status}</Pill>
                <Btn tam="sm" onClick={() => abrirCobranca(f)}>Abrir cobrança</Btn>
              </div>
            ))}
          </div>
        )}
      </Painel>

      <Painel className="p-4">
        <h3 className="mb-1 text-sm font-bold">💳 Renovar assinatura</h3>
        {planoFixo ? (
          <p className="mb-3 text-xs text-slate-500">
            Plano <strong className="font-mono">{planoFixo}</strong> · {productCode} — geramos a cobrança, abrimos o pagamento e confirmamos sozinhos. Ao compensar, a licença reativa sem tocar nos seus dados.
          </p>
        ) : (
          <div className="mb-3 max-w-sm">
            <Campo label="Plano" obrigatorio dica={`Planos ativos de ${productCode} (via API).`}>
              {carregandoPlanos ? (
                <p className="flex items-center gap-2 py-2 text-xs text-slate-400">
                  <Spinner tamanho="sm" rotulo="Carregando planos…" />
                  Carregando planos…
                </p>
              ) : erroPlanos ? (
                <p className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {erroPlanos}
                </p>
              ) : (
                <Selecao value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">Escolher plano…</option>
                  {planos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome ?? p.id}{typeof p.preco === 'number' ? ` — ${p.preco.toLocaleString('pt-BR', { style: 'currency', currency: p.moeda ?? 'BRL' })}` : ''}{p.intervalo ? ` / ${p.intervalo}` : ''}
                    </option>
                  ))}
                </Selecao>
              )}
            </Campo>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn variante="primary" carregando={pagando} onClick={() => void pagarRenovar()}>
            {aguardando ? 'Aguardando pagamento…' : pagando ? 'Gerando…' : 'Gerar cobrança'}
          </Btn>
          {aguardando ? (
            <span className="text-xs text-slate-500">Checkout {aguardando} — conclua no navegador; confirmamos em segundos.</span>
          ) : null}
        </div>
      </Painel>
    </div>
  );
}
