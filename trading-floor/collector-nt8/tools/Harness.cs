// Simula o NinjaTrader 8 (com os stubs) e roda o coletor REAL contra o servidor local.
using System;
using System.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript.AddOns;

public static class Harness
{
    public static int Main()
    {
        var rith = new Connection { Options = new ConnectionOptions { Name = "Apex Rithmic", Provider = Provider.Rithmic }, Status = ConnectionStatus.Connected, PriceStatus = ConnectionStatus.Connected };
        var sim = new Connection { Options = new ConnectionOptions { Name = "Simulator", Provider = Provider.Simulator }, Status = ConnectionStatus.Connected, PriceStatus = ConnectionStatus.Connected };
        var nq = new Instrument { FullName = "NQ 12-26" };

        var a = new Account { Name = "APEX-HARNESS-01", Connection = rith, Denomination = Currency.UsDollar };
        a.Values[AccountItem.CashValue] = 50250.5;
        a.Values[AccountItem.NetLiquidation] = 50310.5;
        a.Values[AccountItem.RealizedProfitLoss] = 250.5;
        a.Values[AccountItem.UnrealizedProfitLoss] = 60;
        a.Positions.Add(new Position { Instrument = nq, MarketPosition = MarketPosition.Long, Quantity = 2, AveragePrice = 21000.25, Unrealized = 60 });
        a.Positions.Add(new Position { Instrument = nq, MarketPosition = MarketPosition.Flat, Quantity = 0 });
        a.Orders.Add(new Order { OrderId = "ord-1", Name = "Stop \"loss\"", Instrument = nq, OrderState = OrderState.Working, OrderAction = OrderAction.Sell, OrderType = OrderType.StopMarket, Quantity = 2, StopPrice = 20950 });
        a.Orders.Add(new Order { OrderId = "ord-0", Instrument = nq, OrderState = OrderState.Filled, OrderAction = OrderAction.Buy, OrderType = OrderType.Market, Quantity = 2, Filled = 2 });
        a.Executions.Add(new Execution { Account = a, ExecutionId = "exec-1", OrderId = "ord-0", Instrument = nq, MarketPosition = MarketPosition.Long, Price = 21000.25, Quantity = 2, Time = DateTime.Now.AddMinutes(-3) });

        // Conta sem P&L informado (só saldo): RealizedProfitLoss deve chegar como "não informado"? Não: CashValue ≠ 0 → itens centrais contam.
        var b = new Account { Name = "APEX-HARNESS-02", Connection = new Connection { Options = new ConnectionOptions { Name = "Apex Tradovate", Provider = Provider.Tradovate }, Status = ConnectionStatus.ConnectionLost, PriceStatus = ConnectionStatus.ConnectionLost }, Denomination = Currency.UsDollar };
        var s101 = new Account { Name = "Sim101", Connection = sim, Denomination = Currency.UsDollar };
        s101.Values[AccountItem.CashValue] = 100000;
        Account.All.Add(a);
        Account.All.Add(b);
        Account.All.Add(s101);

        var addon = new BlackWolfFloorCollector();
        addon.SetStateForTest(NinjaTrader.NinjaScript.State.SetDefaults);
        addon.SetStateForTest(NinjaTrader.NinjaScript.State.Configure);
        addon.SetStateForTest(NinjaTrader.NinjaScript.State.Active); // não deve duplicar
        Thread.Sleep(2500);
        if (a.Subscribers != 2) { Console.WriteLine("FALHA: assinaturas duplicadas/ausentes = " + a.Subscribers); return 2; }
        if (s101.Subscribers != 0) { Console.WriteLine("FALHA: Sim101 não deveria ser assinada"); return 2; }

        // Nova execução em tempo real + mudança de saldo
        a.Values[AccountItem.CashValue] = 50400.5;
        a.RaiseItem(AccountItem.RealizedProfitLoss, 400.5);
        a.RaiseExecution(new Execution { Account = a, ExecutionId = "exec-2", OrderId = "ord-2", Instrument = nq, MarketPosition = MarketPosition.Short, Price = 21075.5, Quantity = 1, Time = DateTime.Now });
        Thread.Sleep(2500);

        // Recompilação: nova instância assume, antiga termina sem derrubar a nova
        var addon2 = new BlackWolfFloorCollector();
        addon2.SetStateForTest(NinjaTrader.NinjaScript.State.SetDefaults);
        addon2.SetStateForTest(NinjaTrader.NinjaScript.State.Configure);
        addon.SetStateForTest(NinjaTrader.NinjaScript.State.Terminated);
        Thread.Sleep(2000);
        if (a.Subscribers != 2) { Console.WriteLine("FALHA após recompilação: assinaturas = " + a.Subscribers); return 3; }
        addon2.SetStateForTest(NinjaTrader.NinjaScript.State.Terminated);
        if (a.Subscribers != 0) { Console.WriteLine("FALHA: assinaturas não removidas no Terminated = " + a.Subscribers); return 4; }
        Console.WriteLine("HARNESS OK");
        return 0;
    }
}
