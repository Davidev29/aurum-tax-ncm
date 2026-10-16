/**
 * Tela de login/ativação — conta primeiro, chave só em `ACCOUNT_NO_LICENSE`.
 *
 * Mapa de erros (item 2 da spec):
 *   - `AUTH` (401) → "entre novamente" (sessão já limpa no store);
 *   - `ACCOUNT_NO_LICENSE` (404) → revela o campo de chave;
 *   - `DEVICE_LIMIT` (409) → orienta liberar slot em `/dashboard/sistemas`;
 *   - `REDE` (502/timeout) → banner offline (o gate offline segue valendo);
 *   - chave: regex local antes do POST; `KEY_INVALID`/`LICENSE_INACTIVE`/
 *     `DEVICE_BLOCKED`/`DEVICE_CONFLICT` com mensagem própria.
 */
import { useState } from 'react';
import { ErroAurum, REGEX_CHAVE, mascararChave } from '../api';
import { lerApiBase, lerLicBase, produtoPadrao, urlPainelSistemas } from '../config';
import { useLicenca } from '../store';
import { abrirUrlExterna } from '../storage';
import { Btn, Campo, Painel, Texto } from '@/ui/kit';
import { useUi } from '@/store/ui';

export function Login() {
  const carregando = useLicenca((s) => s.carregando);
  const erroStore = useLicenca((s) => s.erro);
  const loginConta = useLicenca((s) => s.loginConta);
  const ativarComChave = useLicenca((s) => s.ativarComChave);
  const definirBases = useLicenca((s) => s.definirBases);
  const toast = useUi((s) => s.toast);

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [productId, setProductId] = useState(produtoPadrao());
  const [label, setLabel] = useState('');
  const [aba, setAba] = useState<'conta' | 'chave'>('conta');
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [avancado, setAvancado] = useState(false);
  const [apiBase, setApiBase] = useState(lerApiBase());
  const [licBase, setLicBase] = useState(lerLicBase());

  const chaveNormalizada = chave.trim().toUpperCase();
  const chaveFormatoOk = REGEX_CHAVE.test(chaveNormalizada);

  async function entrarConta(e?: React.FormEvent) {
    e?.preventDefault();
    setErro(null);
    setCodigo(null);
    try {
      const r = await loginConta(email, senha, {
        ...(productId.trim() ? { productId: productId.trim() } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      if (r.precisaChave) {
        setAba('chave');
        toast('Conta sem licença — informe uma chave para ativar.', 'warn');
        return;
      }
      toast('Licença ativada. Bom trabalho!', 'ok');
    } catch (e2) {
      const code = e2 instanceof ErroAurum ? e2.code : null;
      setCodigo(code);
      setErro(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function entrarChave(e?: React.FormEvent) {
    e?.preventDefault();
    setErro(null);
    setCodigo(null);
    if (!chaveFormatoOk) {
      setCodigo('KEY_INVALID');
      setErro('Formato inválido — use AURUM-XXXX-XXXX-XXXX (sem I, O, 0 ou 1).');
      return;
    }
    try {
      // A chave integral vai SÓ no corpo do POST — aqui só a máscara em tela.
      await ativarComChave(chaveNormalizada, { ...(label.trim() ? { label: label.trim() } : {}) });
      setChave('');
      toast(`Licença ${mascararChave(chaveNormalizada)} ativada.`, 'ok');
    } catch (e2) {
      const code = e2 instanceof ErroAurum ? e2.code : null;
      setCodigo(code);
      setErro(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  const abrirDashboard = () => {
    void abrirUrlExterna(urlPainelSistemas()).catch(() => undefined);
  };

  return (
    <Painel className="p-5">
      <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {(['conta', 'chave'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setAba(t); setErro(null); setCodigo(null); }}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              aba === t
                ? 'bg-white text-brand-700 shadow-card dark:bg-slate-900 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            {t === 'conta' ? '👤 Conta' : '🔑 Chave'}
          </button>
        ))}
      </div>

      {aba === 'conta' ? (
        <form onSubmit={(e) => void entrarConta(e)} className="space-y-3">
          <Campo label="E-mail da conta" obrigatorio>
            <Texto value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com.br" autoComplete="email" />
          </Campo>
          <Campo label="Senha" obrigatorio>
            <div className="flex gap-2">
              <Texto
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                type={mostrarSenha ? 'text' : 'password'}
                autoComplete="current-password"
                className="flex-1"
              />
              <Btn tam="sm" onClick={() => setMostrarSenha((m) => !m)}>{mostrarSenha ? '🙈' : '👁'}</Btn>
            </div>
          </Campo>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo label="Product ID" dica="Opcional — padrão do app.">
              <Texto value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="aurum-tax-ncm" className="font-mono text-xs" />
            </Campo>
            <Campo label="Nome deste PC" dica="Aparece no painel de dispositivos.">
              <Texto value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Desktop" />
            </Campo>
          </div>
          <Btn variante="primary" carregando={carregando} onClick={() => void entrarConta()}>
            {carregando ? 'Entrando…' : 'Entrar e ativar'}
          </Btn>
        </form>
      ) : (
        <form onSubmit={(e) => void entrarChave(e)} className="space-y-3">
          <p className="text-xs text-slate-500">
            Ativação por chave (fallback de conta sem licença). A chave integral nunca é salva — só exibimos {mascararChave('AURUM-0000-0000-WXYZ')}.
          </p>
          <Campo label="Chave de ativação" obrigatorio dica="Formato AURUM-XXXX-XXXX-XXXX.">
            <Texto
              value={chave}
              onChange={(e) => setChave(e.target.value.toUpperCase())}
              placeholder="AURUM-XXXX-XXXX-XXXX"
              mono
              grande
              erro={chave.length > 0 && !chaveFormatoOk}
            />
          </Campo>
          <Campo label="Nome deste PC">
            <Texto value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Desktop" />
          </Campo>
          <Btn variante="primary" carregando={carregando} onClick={() => void entrarChave()}>
            {carregando ? 'Ativando…' : 'Ativar com chave'}
          </Btn>
        </form>
      )}

      {codigo === 'DEVICE_LIMIT' || codigo === 'DEVICE_CONFLICT' ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed dark:border-amber-900 dark:bg-amber-950/30">
          <strong>Limite de dispositivos atingido.</strong> Libere um slot no painel e tente de novo.
          <div className="mt-2">
            <Btn tam="sm" variante="primary" onClick={abrirDashboard}>Abrir /dashboard/sistemas</Btn>
          </div>
        </div>
      ) : null}

      {codigo === 'REDE' ? (
        <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-900">
          <strong>Você está offline.</strong> O app segue funcionando até o vencimento do token offline — reconecte para ativar/renovar.
        </div>
      ) : null}

      {erro && codigo !== 'DEVICE_LIMIT' && codigo !== 'DEVICE_CONFLICT' && codigo !== 'REDE' ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {erro}
        </p>
      ) : null}
      {!erro && erroStore ? (
        <p className="mt-3 text-xs text-slate-400">{erroStore}</p>
      ) : null}

      <button
        type="button"
        onClick={() => setAvancado((a) => !a)}
        className="mt-3 text-[11px] font-semibold text-slate-400 hover:text-brand-600"
      >
        {avancado ? '▾ Ocultar servidor' : '▸ Servidor (avançado)'}
      </button>
      {avancado ? (
        <div className="mt-2 grid grid-cols-1 gap-2">
          <Campo label="API base (conta /api/*)" dica={lerApiBase()}>
            <Texto value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="https://api…" className="font-mono text-xs" />
          </Campo>
          <Campo label="Licenças base (/v1/*) — vazio = igual à API" dica={lerLicBase()}>
            <Texto value={licBase} onChange={(e) => setLicBase(e.target.value)} placeholder="(opcional)" className="font-mono text-xs" />
          </Campo>
          <div>
            <Btn
              tam="sm"
              onClick={() => {
                definirBases(apiBase.trim() || lerApiBase(), licBase.trim());
                toast('Servidor atualizado.', 'ok');
              }}
            >
              Salvar servidor
            </Btn>
          </div>
        </div>
      ) : null}
    </Painel>
  );
}
