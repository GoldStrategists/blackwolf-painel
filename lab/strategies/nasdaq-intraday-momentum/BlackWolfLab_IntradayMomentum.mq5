//+------------------------------------------------------------------+
//|  BlackWolfLab_IntradayMomentum.mq5                               |
//|  Laboratorio Black Wolf — STAGE 0/1                              |
//|                                                                  |
//|  Hipotese: perto do fechamento existe fluxo obrigatorio          |
//|  (rebalanceamento de fundos e ETFs alavancados). Quando o dia ja  |
//|  veio subindo, esse fluxo entra comprando; quando veio caindo,    |
//|  entra vendendo. Referencia: Gao, Han, Li & Zhou, "Market         |
//|  Intraday Momentum", Journal of Financial Economics (2018).       |
//|                                                                  |
//|  REGRA DA CASA: a posicao nasce e morre na mesma sessao.          |
//|  NUNCA segura posicao com o mercado fechado.                      |
//|                                                                  |
//|  Este arquivo e material de TESTE. Nao e produto, nao vai para    |
//|  cliente e nao passou por nenhum estagio do ciclo de vida.        |
//+------------------------------------------------------------------+
#property copyright "Black Wolf — laboratorio"
#property link      "https://github.com/GoldStrategists/blackwolf-painel"
#property version   "0.10"

#include <Trade\Trade.mqh>

input group "=== Horarios (HORA DO SERVIDOR do MT5) ==="
input int    InpSignalHour      = 16;       // Leitura do sinal: hora
input int    InpSignalMinute    = 0;        // Leitura do sinal: minuto
input int    InpEntryHour       = 21;       // Entrada: hora
input int    InpEntryMinute     = 0;        // Entrada: minuto
input int    InpCloseHour       = 22;       // Fechamento forcado: hora
input int    InpCloseMinute     = 45;       // Fechamento forcado: minuto

input group "=== Sinal ==="
input double InpMinMovePct      = 0.10;     // Movimento minimo ate o sinal (%)
input bool   InpAllowShort      = true;     // Permite venda
input bool   InpInvertSignal    = false;    // Inverte o sinal (teste de controle)

input group "=== Risco ==="
input double InpRiskPercent     = 1.0;      // Risco por operacao (% do saldo)
input double InpStopLossPct     = 0.60;     // Stop loss (% do preco de entrada)
input double InpTakeProfitPct   = 0.0;      // Take profit (% — 0 desliga)
input int    InpMaxSpreadPoints = 60;       // Spread maximo aceito (pontos, 0 desliga)

input group "=== Identificacao ==="
input long   InpMagic           = 20260915; // Numero magico

CTrade   g_trade;
datetime g_diaOperado = 0;   // dia em que ja houve decisao (operou ou descartou)

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpSignalHour < 0 || InpSignalHour > 23 || InpEntryHour < 0 || InpEntryHour > 23 ||
      InpCloseHour  < 0 || InpCloseHour  > 23)
     {
      Print("ERRO: hora fora do intervalo 0-23.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   if(InpSignalMinute < 0 || InpSignalMinute > 59 || InpEntryMinute < 0 || InpEntryMinute > 59 ||
      InpCloseMinute  < 0 || InpCloseMinute  > 59)
     {
      Print("ERRO: minuto fora do intervalo 0-59.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   int mSinal   = InpSignalHour * 60 + InpSignalMinute;
   int mEntrada = InpEntryHour  * 60 + InpEntryMinute;
   int mFecha   = InpCloseHour  * 60 + InpCloseMinute;
   if(!(mSinal < mEntrada && mEntrada < mFecha))
     {
      Print("ERRO: os horarios precisam ser, na ordem: sinal < entrada < fechamento.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   if(InpRiskPercent <= 0.0 || InpStopLossPct <= 0.0)
     {
      Print("ERRO: risco e stop loss precisam ser maiores que zero.");
      return(INIT_PARAMETERS_INCORRECT);
     }

   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetTypeFillingBySymbol(_Symbol);
   g_trade.SetDeviationInPoints(20);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Monta um horario (hora:minuto) no mesmo dia da data informada.    |
//+------------------------------------------------------------------+
datetime HorarioDoDia(const datetime base, const int hora, const int minuto)
  {
   MqlDateTime d;
   TimeToStruct(base, d);
   d.hour = hora;
   d.min  = minuto;
   d.sec  = 0;
   return(StructToTime(d));
  }

//+------------------------------------------------------------------+
//| Ultimo fechamento M5 ate o horario pedido.                        |
//| janelaSegundos = quanto aceita voltar no tempo se nao houver      |
//| barra exatamente naquele horario (feriado, fim de sessao, DST).   |
//+------------------------------------------------------------------+
double FechamentoAte(const datetime quando, const int janelaSegundos)
  {
   double buf[];
   int n = CopyClose(_Symbol, PERIOD_M5, quando - janelaSegundos, quando + 299, buf);
   if(n <= 0)
      return(0.0);
   return(buf[n - 1]);
  }

//+------------------------------------------------------------------+
//| Preco no fechamento da sessao anterior (volta ate 7 dias).        |
//+------------------------------------------------------------------+
double FechamentoSessaoAnterior(const datetime agora)
  {
   for(int d = 1; d <= 7; d++)
     {
      datetime alvo = HorarioDoDia(agora - d * 86400, InpCloseHour, InpCloseMinute);
      double preco = FechamentoAte(alvo, 1800);
      if(preco > 0.0)
         return(preco);
     }
   return(0.0);
  }

//+------------------------------------------------------------------+
bool TemPosicaoAberta()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return(true);
     }
   return(false);
  }

//+------------------------------------------------------------------+
void FecharPosicoes(const string motivo)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;
      if(g_trade.PositionClose(ticket))
         PrintFormat("Posicao %I64u fechada: %s", ticket, motivo);
      else
         PrintFormat("FALHA ao fechar a posicao %I64u (%s). Erro %d",
                     ticket, motivo, g_trade.ResultRetcode());
     }
  }

//+------------------------------------------------------------------+
//| Lote pelo risco. Se a conta for pequena demais para o risco       |
//| pedido, devolve 0 e NAO opera — arredondar para cima seria        |
//| arriscar mais do que o declarado, escondido do operador.          |
//+------------------------------------------------------------------+
double LotePorRisco(const double distanciaStop)
  {
   if(distanciaStop <= 0.0)
      return(0.0);

   double saldo     = AccountInfoDouble(ACCOUNT_BALANCE);
   double risco     = saldo * InpRiskPercent / 100.0;
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0.0 || tickValue <= 0.0 || risco <= 0.0)
      return(0.0);

   double perdaPorLote = (distanciaStop / tickSize) * tickValue;
   if(perdaPorLote <= 0.0)
      return(0.0);

   double lotes   = risco / perdaPorLote;
   double passo   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minLote = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLote = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);

   if(passo > 0.0)
      lotes = MathFloor(lotes / passo) * passo;
   if(lotes < minLote)
     {
      PrintFormat("Sem operacao: risco de %.2f%% do saldo da menos que o lote minimo (%.2f).",
                  InpRiskPercent, minLote);
      return(0.0);
     }
   if(maxLote > 0.0 && lotes > maxLote)
      lotes = maxLote;

   return(NormalizeDouble(lotes, 2));
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   datetime agora = TimeCurrent();
   MqlDateTime d;
   TimeToStruct(agora, d);
   if(d.day_of_week == 0 || d.day_of_week == 6)
      return;

   datetime tEntrada = HorarioDoDia(agora, InpEntryHour, InpEntryMinute);
   datetime tFecha   = HorarioDoDia(agora, InpCloseHour, InpCloseMinute);

   // REGRA DA CASA: nada aberto depois do horario de fechamento.
   if(agora >= tFecha)
     {
      FecharPosicoes("fim de sessao");
      return;
     }

   if(TemPosicaoAberta())
      return;

   datetime diaAtual = HorarioDoDia(agora, 0, 0);
   if(g_diaOperado == diaAtual)
      return;
   if(agora < tEntrada)
      return;

   if(InpMaxSpreadPoints > 0)
     {
      long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      if(spread > InpMaxSpreadPoints)
         return;   // tenta de novo no proximo tick, dentro da janela
     }

   datetime tSinal = HorarioDoDia(agora, InpSignalHour, InpSignalMinute);
   double precoSinal = FechamentoAte(tSinal, 0);
   double precoRef   = FechamentoSessaoAnterior(agora);
   if(precoSinal <= 0.0 || precoRef <= 0.0)
     {
      g_diaOperado = diaAtual;   // sem referencia confiavel: dia descartado
      return;
     }

   double variacaoPct = (precoSinal - precoRef) / precoRef * 100.0;
   if(MathAbs(variacaoPct) < InpMinMovePct)
     {
      g_diaOperado = diaAtual;   // dia parado: nao opera
      return;
     }

   bool comprar = (variacaoPct > 0.0);
   if(InpInvertSignal)
      comprar = !comprar;
   if(!comprar && !InpAllowShort)
     {
      g_diaOperado = diaAtual;
      return;
     }

   double preco = comprar ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                          : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(preco <= 0.0)
      return;

   double distStop = preco * InpStopLossPct / 100.0;
   long   nivel    = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double distMin  = nivel * _Point;
   if(distStop < distMin)
      distStop = distMin * 1.5;

   double sl = comprar ? preco - distStop : preco + distStop;
   double tp = 0.0;
   if(InpTakeProfitPct > 0.0)
     {
      double distTp = preco * InpTakeProfitPct / 100.0;
      if(distTp < distMin)
         distTp = distMin * 1.5;
      tp = comprar ? preco + distTp : preco - distTp;
     }

   double lotes = LotePorRisco(distStop);
   if(lotes <= 0.0)
     {
      g_diaOperado = diaAtual;
      return;
     }

   sl = NormalizeDouble(sl, _Digits);
   if(tp > 0.0)
      tp = NormalizeDouble(tp, _Digits);

   bool ok = comprar
             ? g_trade.Buy(lotes, _Symbol, 0.0, sl, tp, "BW lab intraday")
             : g_trade.Sell(lotes, _Symbol, 0.0, sl, tp, "BW lab intraday");

   if(ok)
     {
      g_diaOperado = diaAtual;
      PrintFormat("%s %.2f lote(s). Variacao ate o sinal: %.2f%%. SL %.*f",
                  comprar ? "COMPRA" : "VENDA", lotes, variacaoPct, _Digits, sl);
     }
   else
      PrintFormat("FALHA na entrada. Erro %d", g_trade.ResultRetcode());
  }
//+------------------------------------------------------------------+
