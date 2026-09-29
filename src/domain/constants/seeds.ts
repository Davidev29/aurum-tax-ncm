import type { TabelaAuxiliarSimples } from '../entities'

/**
 * Seeds das tabelas auxiliares (SPEC R9.6).
 * Gravados apenas quando a respectiva store estiver vazia.
 */

export const SEED_CFOP: TabelaAuxiliarSimples[] = [
  {"codigo":"1101","descricao":"Compra para industrialização ou produção rural","tipo":"Entrada"},
  {"codigo":"1102","descricao":"Compra para comercialização","tipo":"Entrada"},
  {"codigo":"1551","descricao":"Compra de bem para o ativo imobilizado","tipo":"Entrada"},
  {"codigo":"2101","descricao":"Compra para industrialização ou produção rural (interestadual)","tipo":"Entrada"},
  {"codigo":"2102","descricao":"Compra para comercialização (interestadual)","tipo":"Entrada"},
  {"codigo":"5101","descricao":"Venda de produção do estabelecimento","tipo":"Saída"},
  {"codigo":"5102","descricao":"Venda de mercadoria adquirida ou recebida de terceiros","tipo":"Saída"},
  {"codigo":"5103","descricao":"Venda de produção do estabelecimento, efetuada fora do estabelecimento","tipo":"Saída"},
  {"codigo":"5104","descricao":"Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento","tipo":"Saída"},
  {"codigo":"5105","descricao":"Venda de produção do estabelecimento que não deva por ele transitar","tipo":"Saída"},
  {"codigo":"5106","descricao":"Venda de mercadoria adquirida ou recebida de terceiros, que não deva por ele transitar","tipo":"Saída"},
  {"codigo":"5405","descricao":"Venda de mercadoria adquirida ou recebida de terceiros, em operação sujeita a ST","tipo":"Saída"},
  {"codigo":"5910","descricao":"Remessa em bonificação, doação ou brinde","tipo":"Saída"},
  {"codigo":"5915","descricao":"Remessa para conserto ou reparo","tipo":"Saída"},
  {"codigo":"5916","descricao":"Retorno de mercadoria recebida para conserto ou reparo","tipo":"Saída"},
  {"codigo":"5917","descricao":"Remessa para demonstração","tipo":"Saída"},
  {"codigo":"5949","descricao":"Outra saída de mercadoria ou prestação de serviço não especificado","tipo":"Saída"},
  {"codigo":"6101","descricao":"Venda de produção do estabelecimento (interestadual)","tipo":"Saída"},
  {"codigo":"6102","descricao":"Venda de mercadoria adquirida ou recebida de terceiros (interestadual)","tipo":"Saída"},
  {"codigo":"6107","descricao":"Venda de produção do estabelecimento, destinada a não contribuinte","tipo":"Saída"},
  {"codigo":"6108","descricao":"Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte","tipo":"Saída"},
  {"codigo":"7101","descricao":"Venda de produção do estabelecimento (exterior)","tipo":"Saída"},
  {"codigo":"7102","descricao":"Venda de mercadoria adquirida ou recebida de terceiros (exterior)","tipo":"Saída"},
  {"codigo":"1949","descricao":"Outra entrada de mercadoria ou prestação de serviço não especificada","tipo":"Entrada"},
];

export const SEED_CST_ICMS: TabelaAuxiliarSimples[] = [
  {"codigo":"000","descricao":"Tributada integralmente"},
  {"codigo":"010","descricao":"Tributada e com cobrança do ICMS por substituição tributária"},
  {"codigo":"020","descricao":"Com redução de base de cálculo"},
  {"codigo":"030","descricao":"Isenta ou não tributada e com cobrança do ICMS por ST"},
  {"codigo":"040","descricao":"Isenta"},
  {"codigo":"041","descricao":"Não tributada"},
  {"codigo":"050","descricao":"Suspensão"},
  {"codigo":"051","descricao":"Diferimento"},
  {"codigo":"060","descricao":"ICMS cobrado anteriormente por substituição tributária"},
  {"codigo":"070","descricao":"Com redução de base de cálculo e cobrança do ICMS por ST"},
  {"codigo":"090","descricao":"Outros"},
  {"codigo":"101","descricao":"Tributada com permissão de crédito (Simples Nacional)"},
  {"codigo":"102","descricao":"Tributada sem permissão de crédito (Simples Nacional)"},
  {"codigo":"103","descricao":"Isenção do ICMS para faixa de receita bruta (Simples Nacional)"},
  {"codigo":"201","descricao":"Tributada com permissão de crédito e com cobrança do ICMS por ST (Simples)"},
  {"codigo":"202","descricao":"Tributada sem permissão de crédito e com cobrança do ICMS por ST (Simples)"},
  {"codigo":"203","descricao":"Isenção do ICMS para faixa de receita bruta e com cobrança do ICMS por ST (Simples)"},
  {"codigo":"300","descricao":"Imune"},
  {"codigo":"400","descricao":"Não tributada pelo Simples Nacional"},
  {"codigo":"500","descricao":"ICMS cobrado anteriormente por ST ou por antecipação (Simples)"},
  {"codigo":"900","descricao":"Outros"},
];

export const SEED_CST_PISCOFINS: TabelaAuxiliarSimples[] = [
  {"codigo":"01","descricao":"Operação Tributável com Alíquota Básica"},
  {"codigo":"02","descricao":"Operação Tributável com Alíquota Diferenciada"},
  {"codigo":"03","descricao":"Operação Tributável com Alíquota por Unidade de Medida de Produto"},
  {"codigo":"04","descricao":"Operação Tributável Monofásica - Revenda a Alíquota Zero"},
  {"codigo":"05","descricao":"Operação Tributável por Substituição Tributária"},
  {"codigo":"06","descricao":"Operação Tributável a Alíquota Zero"},
  {"codigo":"07","descricao":"Operação Isenta da Contribuição"},
  {"codigo":"08","descricao":"Operação Sem Incidência da Contribuição"},
  {"codigo":"09","descricao":"Operação com Suspensão da Contribuição"},
  {"codigo":"49","descricao":"Outras Operações de Saída"},
  {"codigo":"99","descricao":"Outras Operações"},
];
