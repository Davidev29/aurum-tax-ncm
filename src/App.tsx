import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Layout } from '@/ui/Layout';
import { AssistenteInstalacao } from '@/ui/TermoAceite';
import { lerAceite } from '@/domain/contrato';
import { useUi } from '@/store/ui';
import { Calculadora } from '@/pages/Calculadora';
import { AurumChat } from '@/pages/AurumChat';
import { SimplesNacional } from '@/simples/page';
import { Consulta } from '@/pages/Consulta';
import { ConsultaServicos } from '@/pages/ConsultaServicos';
import { ConsultaCnaes } from '@/pages/ConsultaCnaes';
import { DebugIA } from '@/pages/DebugIA';
import { Lote } from '@/pages/Lote';
import { NfeXml } from '@/pages/NfeXml';
import { NfeXmlPolida } from '@/pages/NfeXmlPolida';
import { Produtos } from '@/pages/Produtos';
import { Auxiliares } from '@/pages/Auxiliares';
import { Legislacao } from '@/pages/Legislacao';

/**
 * Troca de views do shell. Cada página é pura apresentação sobre as stores.
 */
export function App() {
  const view = useUi((s) => s.view);
  // Portão de aceite local: exibido antes de qualquer tela até o aceite v1.
  const [aceito, setAceito] = useState(() => lerAceite() !== null);

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

  let pagina: ReactNode;
  switch (view) {
    case 'aurum':
      pagina = <AurumChat />;
      break;
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
      pagina =
        typeof localStorage !== 'undefined' && localStorage.getItem('xml-layout') === 'polida' ? (
          <NfeXmlPolida />
        ) : (
          <NfeXml />
        );
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
    case 'debugia':
      pagina = <DebugIA />;
      break;
    default:
      pagina = <Calculadora />;
  }

  return (
    <Layout>
      {pagina}
      {!aceito ? <AssistenteInstalacao onConcluido={() => setAceito(true)} /> : null}
    </Layout>
  );
}
