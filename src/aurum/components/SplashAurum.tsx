/**
 * Splash de boot — entrada do software (gate de licença).
 *
 * Mesma linguagem do resto do app: faixa de marca marinho→noite com emblema
 * em ouro (igual ao `Login`), anel `Spinner`, barra indeterminada dourada e
 * entrada em `fade-up` (curva padrão `0.2, 0.9, 0.3, 1`). A mensagem alterna
 * entre as etapas reais do `boot()` (cofre local → validação) para dar
 * sensação de progresso sem prometer porcentagem.
 *
 * Acessibilidade: `role="status"` + `aria-busy`; movimento reduzido
 * desacelera os giros via CSS (`prefers-reduced-motion` em `index.css`).
 */
import { useEffect, useState } from 'react';
import { nomeProduto } from '../config';
import { EmblemaLicenca } from '../pages/Login';
import { Spinner } from '@/ui/kit';

const ETAPAS = ['Lendo o cofre local', 'Verificando licença'] as const;
/** Troca de etapa — só percepção de progresso; o boot real é 1 leitura + revalidação em fundo. */
const TROCA_ETAPA_MS = 1400;

export function SplashAurum() {
  const [etapa, setEtapa] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setEtapa((e) => (e + 1) % ETAPAS.length), TROCA_ETAPA_MS);
    return () => window.clearInterval(t);
  }, []);

  return (
    <main
      className="animate-fade-up grid min-h-dvh place-items-center overflow-y-auto bg-[var(--surface)] px-4 py-10"
      role="status"
      aria-busy="true"
      aria-label="Abrindo o Aurum Tax NCM"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] shadow-pop">
        {/* Faixa de marca — idêntica à do Login (marinho→noite, emblema ouro). */}
        <div className="relative flex items-center gap-3.5 overflow-hidden bg-gradient-to-br from-brand-800 via-[#101c3f] to-slate-950 px-5 py-4 text-white">
          <div
            className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-aurum-500/20 blur-2xl"
            aria-hidden="true"
          />
          <EmblemaLicenca />
          <div className="relative min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-aurum-300">
              {nomeProduto()}
            </div>
            <div className="truncate text-[15px] font-black tracking-tight">Abrindo o app…</div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 p-6 sm:p-8">
          <Spinner tamanho="lg" rotulo={`${ETAPAS[etapa]}…`} />
          <div className="text-center">
            <p className="text-sm font-bold" aria-hidden="true">
              <span className="aurum-pontos">{ETAPAS[etapa]}</span>
            </p>
            <p className="sr-only">{ETAPAS[etapa]}…</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Funciona offline até o vencimento — nada seu sai deste PC.
            </p>
          </div>
          <div className="aurum-barra" aria-hidden="true" />
        </div>
      </div>
    </main>
  );
}
