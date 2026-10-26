// Envia eventos de teste do robô usando o helper real (BlackWolfFloorEvents).
using System;
using System.Threading;
using NinjaTrader.NinjaScript.AddOns;

public static class RobotHarness
{
    public static int Main()
    {
        BlackWolfFloorEvents.Send("strategy_enabled", "DEMO-APEX-01", "Black Wolf 3.1", null, null, null, null, null, "Teste do helper C#");
        BlackWolfFloorEvents.Send("signal", "DEMO-APEX-01", "Black Wolf 3.1", "NQ 12-26", "buy", 1, 21000.5, null, "Canal \"rompido\"");
        BlackWolfFloorEvents.Send("tipo_invalido", "DEMO-APEX-01", null, null, null, null, null, null, null); // deve ser descartado (400) sem travar a fila
        BlackWolfFloorEvents.Send("error", "DEMO-APEX-01", "Black Wolf 3.1", null, null, null, null, null, "Erro simulado");
        Thread.Sleep(3000);
        Console.WriteLine("ROBOT HARNESS OK");
        return 0;
    }
}
