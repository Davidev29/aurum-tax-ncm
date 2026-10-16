/**
 * Ativação — a única coisa que o usuário preenche: conta OU chave.
 *
 * `productId`, `label` do dispositivo, bases de API e plano vêm do build
 * (`src/aurum/config.ts` via `VITE_AURUM_*`) — nada manual em tela.
 * Inclui redefinição de senha ("Esqueci a senha" → link no e-mail).
 *
 * Mapa de erros (item 2 da spec):
 *   - `AUTH` (401) → "entre novamente" (sessão já limpa no store);
 *   - `ACCOUNT_NO_LICENSE` (404) → cai sozinho na aba de chave;
 *   - `DEVICE_LIMIT`/`DEVICE_CONFLICT` (409) → card com `/dashboard/sistemas`;
 *   - `REDE` (502/timeout) → aviso offline (o gate offline segue valendo).
 */
import { useState } from 'react';
import { ErroAurum, REGEX_CHAVE, mascararChave, solicitarRedefinicaoSenha } from '../api';
import { nomeProduto, urlPainelSistemas } from '../config';
import { useLicenca } from '../store';
import { abrirUrlExterna } from '../storage';
import { Btn, Campo, Texto } from '@/ui/kit';
import { useUi } from '@/store/ui';

/** Formata a chave enquanto digita: `AURUM-XXXX-XXXX-XXXX`. */
function formatarChaveDigitada(v: string): string {
  const alnum = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const corpo = alnum.replace(/^AURUM/, '').slice(0, 12);
  if (!corpo) return '';
  return `AURUM-${(corpo.match(/.{1,4}/g) ?? []).join('-')}`;
}

function digitosChave(formatada: string): number {
  return formatada.replace(/^AURUM-?/, '').replace(/-/g, '').length;
}

export function EmblemaLicenca({ tamanho = 'md' }: { tamanho?: 'md' | 'lg' }) {
  const dim = tamanho === 'lg' ? 'h-16 w-16 text-3xl' : 'h-11 w-11 text-xl';
  return (
    <div
      className={`grid ${dim} shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 via-brand-700 to-aurum-600 text-white shadow-pop ring-1 ring-white/20`}
      aria-hidden="true"
    >
      🛡
    </div>
  );
}

type Passo = 'conta' | 'chave' | 'esqueci' | 'esqueci-ok';

export function Login() {
  const carregando = useLicenca((s) => s.carregando);
  const loginConta = useLicenca((s) => s.loginConta);
  const ativarComChave = useLicenca((s) => s.ativarComChave);
  const toast = useUi((s) => s.toast);

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [passo, setPasso] = useState<Passo>('conta');
  const [chave, setChave] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const chaveValida = REGEX_CHAVE.test(chave.trim());
  const digitos = digitosChave(chave);
  const emailOk = /.+@.+\..+/.test(email.trim());

  function ir(p: Passo) {
    setPasso(p);
    setErro(null);
    setCodigo(null);
    setAviso(null);
  }

  async function entrarConta(e?: React.FormEvent) {
    e?.preventDefault();
    setErro(null);
    setCodigo(null);
    setAviso(null);
    try {
      const r = await loginConta(email.trim(), senha);
      if (r.precisaChave) {
        setPasso('chave');
        setAviso('Sua conta não tem licença ativa — cole sua chave abaixo para concluir.');
        return;
      }
      toast('Licença ativada. Bom trabalho!', 'ok');
    } catch (e2) {
      setCodigo(e2 instanceof ErroAurum ? e2.code : null);
      setErro(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function entrarChave(e?: React.FormEvent) {
    e?.preventDefault();
    setErro(null);
    setCodigo(null);
    setAviso(null);
    if (!chaveValida) {
      setCodigo('KEY_INVALID');
      setErro('Chave incompleta — o formato é AURUM-XXXX-XXXX-XXXX.');
      return;
    }
    try {
      // A chave integral vai SÓ no corpo do POST — em tela, só a máscara.
      await ativarComChave(chave.trim());
      setChave('');
      toast(`Licença ${mascararChave(chave)} ativada.`, 'ok');
    } catch (e2) {
      setCodigo(e2 instanceof ErroAurum ? e2.code : null);
      setErro(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function enviarRedefinicao(e?: React.FormEvent) {
    e?.preventDefault();
    setErro(null);
    setCodigo(null);
    if (!emailOk) {
      setErro('Informe o e-mail da conta para receber o link.');
      return;
    }
    try {
      await solicitarRedefinicaoSenha(email.trim());
      setPasso('esqueci-ok');
    } catch (e2) {
      setCodigo(e2 instanceof ErroAurum ? e2.code : null);
      setErro(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  const mostraAbas = passo === 'conta' || passo === 'chave';

  return (
    <div className="overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] shadow-pop">
      {/* Faixa de marca — produto resolvido no build, sem campo manual. */}
      <div className="relative flex items-center gap-3.5 overflow-hidden bg-gradient-to-br from-brand-800 via-[#101c3f] to-slate-950 px-5 py-4 text-white sm:px-6">
        <div
          className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-aurum-500/20 blur-2xl"
          aria-hidden="true"
        />
        <EmblemaLicenca />
        <div className="relative min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-aurum-300">
            {nomeProduto()}
          </div>
          <div className="truncate text-[15px] font-black tracking-tight">
            {passo === 'chave' ? 'Ative com sua chave' : passo === 'conta' ? 'Entre com sua conta' : 'Recuperar acesso'}
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {mostraAbas ? (
          <div
            role="tablist"
            aria-label="Método de ativação"
            className="mb-5 grid grid-cols-2 gap-1 rounded-2xl border border-[var(--line)] bg-slate-100 p-1 dark:bg-slate-800/80"
          >
            {(['conta', 'chave'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={passo === t}
                type="button"
                onClick={() => ir(t)}
                className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${
                  passo === t
                    ? 'bg-white text-brand-700 shadow-card dark:bg-slate-900 dark:text-brand-300'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {t === 'conta' ? '👤 Conta' : '🔑 Chave'}
              </button>
            ))}
          </div>
        ) : null}

        {aviso ? (
          <p className="mb-4 rounded-2xl border border-brand-200 bg-brand-50 p-3 text-xs leading-relaxed text-brand-800 dark:border-aurum-900 dark:bg-brand-950/30 dark:text-brand-200">
            {aviso}
          </p>
        ) : null}

        {passo === 'conta' ? (
          <form onSubmit={(e) => void entrarConta(e)} className="space-y-4">
            <Campo label="E-mail" obrigatorio>
              <Texto
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
                autoComplete="email"
                inputMode="email"
              />
            </Campo>
            <Campo label="Senha" obrigatorio>
              <div className="flex gap-2">
                <Texto
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="Sua senha"
                  type={mostrarSenha ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="flex-1"
                />
                <Btn tam="sm" onClick={() => setMostrarSenha((m) => !m)} title={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}>
                  {mostrarSenha ? '🙈' : '👁'}
                </Btn>
              </div>
              <div className="mt-1.5 text-right">
                <button
                  type="button"
                  onClick={() => ir('esqueci')}
                  className="text-[11px] font-bold text-brand-600 hover:underline dark:text-aurum-300"
                >
                  Esqueci a senha
                </button>
              </div>
            </Campo>
            <Btn
              variante="primary"
              carregando={carregando}
              onClick={() => void entrarConta()}
              className="w-full !py-2.5 !text-sm"
            >
              {carregando ? 'Entrando…' : 'Entrar e ativar →'}
            </Btn>
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
              🔒 Seus dados ficam no cofre deste PC
            </p>
          </form>
        ) : null}

        {passo === 'chave' ? (
          <form onSubmit={(e) => void entrarChave(e)} className="space-y-4">
            <Campo label="Chave de ativação" obrigatorio>
              <Texto
                value={chave}
                onChange={(e) => setChave(formatarChaveDigitada(e.target.value))}
                placeholder="AURUM-XXXX-XXXX-XXXX"
                mono
                grande
                autoComplete="off"
                spellCheck={false}
                erro={chave.length > 0 && !chaveValida}
              />
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className={chaveValida ? 'font-bold text-emerald-600' : 'text-slate-400'}>
                  {chaveValida ? '✓ Chave completa' : `${digitos}/12 caracteres`}
                </span>
                <span className="text-slate-400">exibimos só {mascararChave('AURUM-0000-0000-WXYZ')}</span>
              </div>
              <div className="mt-1.5 flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((i) => {
                  const n = (chave.replace(/^AURUM-?/, '').split('-')[i] ?? '').length;
                  return (
                    <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className={`h-1 rounded-full transition-all ${n >= 4 ? 'bg-emerald-500' : 'bg-brand-500'}`}
                        style={{ width: `${Math.min(100, (n / 4) * 100)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </Campo>
            <Btn
              variante="primary"
              carregando={carregando}
              onClick={() => void entrarChave()}
              className="w-full !py-2.5 !text-sm"
            >
              {carregando ? 'Ativando…' : 'Ativar licença →'}
            </Btn>
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
              🔒 A chave integral nunca é salva — só trafega na ativação
            </p>
          </form>
        ) : null}

        {passo === 'esqueci' ? (
          <form onSubmit={(e) => void enviarRedefinicao(e)} className="space-y-4">
            <p className="text-xs leading-relaxed text-slate-500">
              Informe o e-mail da conta — enviamos um link para criar uma nova senha.
            </p>
            <Campo label="E-mail da conta" obrigatorio>
              <Texto
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
                autoComplete="email"
                inputMode="email"
              />
            </Campo>
            <Btn
              variante="primary"
              carregando={carregando}
              onClick={() => void enviarRedefinicao()}
              className="w-full !py-2.5 !text-sm"
            >
              {carregando ? 'Enviando…' : 'Enviar link de redefinição'}
            </Btn>
            <div className="text-center">
              <button
                type="button"
                onClick={() => ir('conta')}
                className="text-[11px] font-bold text-slate-400 hover:text-brand-600"
              >
                ← Voltar ao login
              </button>
            </div>
          </form>
        ) : null}

        {passo === 'esqueci-ok' ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-xl dark:bg-emerald-950/60">
              ✉
            </div>
            <div>
              <div className="text-sm font-black">Verifique seu e-mail</div>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                Se <strong>{email.trim()}</strong> estiver cadastrado, o link de redefinição já está a caminho.
              </p>
            </div>
            <Btn onClick={() => ir('conta')} className="w-full">
              Voltar ao login
            </Btn>
          </div>
        ) : null}

        {codigo === 'DEVICE_LIMIT' || codigo === 'DEVICE_CONFLICT' ? (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-relaxed dark:border-amber-900 dark:bg-amber-950/30">
            <strong>Limite de dispositivos atingido.</strong>
            <p className="mt-1 text-amber-800 dark:text-amber-200">
              Libere um slot no painel e tente de novo — leva menos de um minuto.
            </p>
            <div className="mt-2">
              <Btn
                tam="sm"
                variante="primary"
                onClick={() => void abrirUrlExterna(urlPainelSistemas()).catch(() => undefined)}
              >
                Abrir painel de dispositivos ↗
              </Btn>
            </div>
          </div>
        ) : null}

        {codigo === 'REDE' ? (
          <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-50 p-4 text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-900">
            <strong>📴 Você está offline.</strong>
            <p className="mt-1 text-slate-500">
              Sem conexão agora. Se este PC já foi ativado, o app segue funcionando até o vencimento — reconecte para entrar ou renovar.
            </p>
          </div>
        ) : null}

        {erro && codigo !== 'DEVICE_LIMIT' && codigo !== 'DEVICE_CONFLICT' && codigo !== 'REDE' ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {erro}
          </p>
        ) : null}
      </div>
    </div>
  );
}
