import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Layout } from '@/ui/Layout';
import { ErroFatal, SkeletonPagina } from '@/ui/ErroFatal';
import { AssistenteInstalacao } from '@/ui/TermoAceite';
import { lerAceite } from '@/domain/contrato';
import { deveAbrirAposInstalacao, useTutorial } from '@/store/tutorial';
import { useUi } from '@/store/ui';

// Code-splitting por view: o boot carrega só o shell; cada tela (com seu
// chart.js pesado) vira um chunk sob demanda + Suspense com esqueleto.
const Calculadora = lazy(() => import('@/pages/Calculadora').then((m) => ({ default: m.Calculadora })));
const SimplesNacional = lazy(() => import('@/simples/page').then((m) => ({ default: m.SimplesNacional })));
const Consulta = lazy(() => import('@/pages/Consulta').then((m) => ({ default: m.Consulta })));
const ConsultaServicos = lazy(() => import('@/pages/ConsultaServicos').then((m) => ({ default: m.ConsultaServicos })));
const ConsultaCnaes = lazy(() => import('@/pages/ConsultaCnaes').then((m) => ({ default: m.ConsultaCnaes })));
const Lote = lazy(() => import('@/pages/Lote').then((m) => ({ default: m.Lote })));
const NfeXml = lazy(() => import('@/pages/NfeXml').then((m) => ({ default: m.NfeXml })));
const NfeXmlPolida = lazy(() => import('@/pages/NfeXmlPolida').then((m) => ({ default: m.NfeXmlPolida })));
const Produtos = lazy(() => import('@/pages/Produtos').then((m) => ({ default: m.Produtos })));
const Auxiliares = lazy(() => import('@/pages/Auxiliares').then((m) => ({ default: m.Auxiliares })));
const Legislacao = lazy(() => import('@/pages/Legislacao').then((m) => ({ default: m.Legislacao })));

/**
 * Troca de views do shell. Cada página é pura apresentação sobre as stores.
 */
export function App() {
  const view = useUi((s) => s.view);
  // Portão de aceite local: exibido antes de qualquer tela até o aceite v1.
  const [aceito, setAceito] = useState(() => lerAceite() !== null);
  // Layout do XML lido 1× fora do render crítico (vira estado inicial).
  const [layoutXml] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('xml-layout') : null;
    } catch {
      return null;
    }
  });

  // Tour guiado: abre sozinho 1x após a instalação (ou para quem já
  // aceitou o contrato anterior mas nunca viu o tour).
  useEffect(() => {
    if (!aceito) return;
    if (!deveAbrirAposInstalacao()) return;
    const t = window.setTimeout(() => useTutorial.getState().abrir(0), 600);
    return () => window.clearTimeout(t);
  }, [aceito]);

  // GRAFO-08: job incremental do overlay ao abrir + ocioso (<1s, nunca
  // rebuild diário — só poda TTL + teto). Best-effort, nunca lança.
  useEffect(() => {
    try {
      void import('@/application/grafo-overlay').then((m) => {
        try {
          m.agendarJobOverlay()
        } catch {
          /* job nunca quebra o boot */
        }
      }).catch(() => undefined)
    } catch {
      /* ignora */
    }
  }, [])

  // Pré-carrega a Consulta em idle: é a tela mais visitada e o chunk já fica
  // quente sem bloquear a primeira dobra.
  useEffect(() => {
    const precarregar = () => {
      void import('@/pages/Consulta').catch(() => undefined);
    };
    try {
      const g = globalThis as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (typeof g.requestIdleCallback === 'function') {
        const id = g.requestIdleCallback(precarregar, { timeout: 4000 });
        return () => {
          try {
            g.cancelIdleCallback?.(id);
          } catch {
            /* ignora */
          }
        };
      }
    } catch {
      /* cai no setTimeout */
    }
    const t = window.setTimeout(precarregar, 2500);
    return () => window.clearTimeout(t);
  }, []);

  let pagina: ReactNode;
  switch (view) {
    case 'simples':
      pagina = <SimplesNacional />;
      break;
    case 'consulta':
      pagina = <Consulta />;
      break;
    case 'servicos':
      pagina = <ConsultaServicos />;
      break;
    case 'cnaes':
      pagina = <ConsultaCnaes />;
      break;
    case 'lote':
      pagina = <Lote />;
      break;
    case 'nfe':
      pagina = layoutXml === 'polida' ? <NfeXmlPolida /> : <NfeXml />;
      break;
    case 'produtos':
      pagina = <Produtos />;
      break;
    case 'auxiliares':
      pagina = <Auxiliares />;
      break;
    case 'legislacao':
      pagina = <Legislacao />;
      break;
    default:
      pagina = <Calculadora />;
  }

  return (
    <Layout>
      {/* `key` reseta a barreira a cada troca de tela: falha numa view não
          contamina a próxima. */}
      <ErroFatal key={view} nome={view}>
        <Suspense fallback={<SkeletonPagina />}>{pagina}</Suspense>
      </ErroFatal>
      {!aceito ? (
        <AssistenteInstalacao
          onConcluido={() => {
            setAceito(true);
            // Pós-instalação: apresenta o tour guiado menu a menu.
            window.setTimeout(() => useTutorial.getState().abrir(0), 400);
          }}
        />
      ) : null}
    </Layout>
  );
}
