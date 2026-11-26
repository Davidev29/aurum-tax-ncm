/**
 * Fator R obrigatório na store do Simples — integração das guardas de domínio
 * com `calcular()`, invalidação do relatório e preservação do resultado para
 * o botão Editar.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSimples, type CnaeOpcao } from '@/simples/store';
import { useUi } from '@/store/ui';

beforeEach(() => {
  useSimples.getState().limpar();
  useSimples.setState({
    modo: 'manual',
    anexoId: 'I',
    escolheuAnexo: true,
    cnpj: '',
    opcoes: [],
    cnaeEscolhido: '',
    sujeitaFatorR: true,
    compararHibrido: false,
  });
  useUi.setState({ toasts: [] });
});

describe('store — guarda da folha 12m', () => {
  it('sem folha não publica resultado e mostra toast específico', () => {
    useSimples.getState().set({ anexoId: 'V', rbt12: 300_000, receitaMes: 20_000 });
    useSimples.getState().calcular();

    const s = useSimples.getState();
    expect(s.relatorioVisivel).toBe(false);
    expect(s.convencional).toBeNull();
    expect(s.hibrido).toBeNull();
    expect(s.debitosCBS).toBe(0);
    const textos = useUi.getState().toasts.map((t) => t.texto);
    expect(textos.some((t) => /folha 12m não informada/i.test(t))).toBe(true);
  });

  it('folha zero não confirmada também bloqueia', () => {
    useSimples.getState().set({ anexoId: 'V', rbt12: 300_000, receitaMes: 20_000, folha12: 0 });
    useSimples.getState().calcular();
    expect(useSimples.getState().relatorioVisivel).toBe(false);
    expect(useUi.getState().toasts.map((t) => t.texto).some((t) => /folha/i.test(t))).toBe(true);
  });

  it('folha em Anexo I mantém o Anexo I (registrada, sem efeito)', () => {
    useSimples.getState().set({ anexoId: 'I', rbt12: 300_000, receitaMes: 20_000, folha12: 150_000 });
    useSimples.getState().calcular();

    const s = useSimples.getState();
    expect(s.relatorioVisivel).toBe(true);
    expect(s.convencional?.anexoId).toBe('I');
    expect(s.folhaInformada).toBe(true);
    expect(s.sujeitaFatorR).toBe(true);
  });

  it('folha >= 28% em Anexo V promove para III', () => {
    useSimples.getState().set({ anexoId: 'V', rbt12: 300_000, receitaMes: 20_000, folha12: 100_000 });
    useSimples.getState().calcular();
    expect(useSimples.getState().convencional?.anexoId).toBe('III');
  });

  it('folha < 28% mantém o Anexo V', () => {
    useSimples.getState().set({ anexoId: 'V', rbt12: 300_000, receitaMes: 20_000, folha12: 30_000 });
    useSimples.getState().calcular();
    expect(useSimples.getState().convencional?.anexoId).toBe('V');
  });

  it('convencional/hibrido não são apagados quando uma entrada invalida o relatório', () => {
    useSimples.getState().set({ anexoId: 'I', rbt12: 300_000, receitaMes: 20_000, folha12: 150_000, compararHibrido: true });
    useSimples.getState().calcular();
    const antes = useSimples.getState();
    expect(antes.relatorioVisivel).toBe(true);
    expect(antes.convencional).not.toBeNull();
    expect(antes.hibrido).not.toBeNull();

    useSimples.getState().set({ rbt12: 400_000 });
    const depois = useSimples.getState();
    expect(depois.relatorioVisivel).toBe(false);
    expect(depois.convencional).toBe(antes.convencional);
    expect(depois.hibrido).toBe(antes.hibrido);
  });

  it('trocar CNAE não apaga a folha e usa os anexos do CNAE no cálculo', () => {
    const op = {
      cnae7: '7020400',
      codigoFormatado: '7020-4/00',
      descricao: 'Serviços de consultoria',
      anexos: ['III', 'V'],
      exigeFatorR: true,
      tabela: null,
    } as unknown as CnaeOpcao;
    useSimples.setState({ modo: 'cnpj', opcoes: [op], cnaeEscolhido: '' });
    useSimples.getState().set({ folha12: 120_000, rbt12: 300_000, receitaMes: 20_000 });
    useSimples.getState().escolherCnae('7020400');

    const escolhido = useSimples.getState();
    expect(escolhido.folha12).toBe(120_000);
    expect(escolhido.folhaInformada).toBe(true);

    useSimples.getState().calcular();
    expect(useSimples.getState().convencional?.anexoId).toBe('III');
  });
});
