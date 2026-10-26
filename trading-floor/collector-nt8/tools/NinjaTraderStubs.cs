// STUBS para checagem de compilação fora do Windows. NÃO são a API real do NinjaTrader:
// imitam somente os membros que o coletor usa, com os nomes da documentação oficial
// do NT8. Compilar com eles prova que o código é C# válido e consistente — a validação
// definitiva é compilar no NinjaScript Editor (F5) do NinjaTrader 8.
using System;
using System.Collections.Generic;

namespace NinjaTrader.NinjaScript
{
    public enum State { SetDefaults, Configure, Active, DataLoaded, Historical, Transition, Realtime, Terminated }

    public abstract class AddOnBase
    {
        public string Name { get; set; }
        public string Description { get; set; }
        public State State { get; private set; }
        protected virtual void OnStateChange() { }
        public void SetStateForTest(State s) { State = s; OnStateChange(); }
    }
}

namespace NinjaTrader.Cbi
{
    public enum AccountItem
    {
        BuyingPower, CashValue, Commission, ExcessIntradayMargin, ExcessInitialMargin, ExcessMaintenanceMargin, ExcessPositionMargin, Fee,
        GrossRealizedProfitLoss, InitialMargin, IntradayMargin, LongOptionValue, LookAheadMaintenanceMargin, LongStockValue, MaintenanceMargin,
        NetLiquidation, NetLiquidationByCurrency, PositionMargin, RealizedProfitLoss, ShortOptionValue, ShortStockValue, SodCashValue,
        SodLiquidatingValue, UnrealizedProfitLoss, TotalCashBalance
    }
    public enum Currency { UsDollar, Euro, BritishPound }
    public enum MarketPosition { Flat, Long, Short }
    public enum ConnectionStatus { Connected, Connecting, ConnectionLost, Disconnecting, Disconnected }
    public enum OrderState { Accepted, CancelPending, CancelSubmitted, Cancelled, ChangePending, ChangeSubmitted, Filled, Initialized, PartFilled, Rejected, Submitted, TriggerPending, Unknown, Working }
    public enum OrderAction { Buy, BuyToCover, Sell, SellShort }
    public enum OrderType { Limit, Market, MIT, StopLimit, StopMarket, Unknown }
    public enum PerformanceUnit { Currency, Percent, Pips, Points, Ticks }
    public enum Provider { Rithmic, Tradovate, Simulator, Playback }

    public class Instrument { public string FullName { get; set; } }
    public class ConnectionOptions { public string Name { get; set; } public Provider Provider { get; set; } }
    public class Connection
    {
        public ConnectionOptions Options { get; set; }
        public ConnectionStatus Status { get; set; }
        public ConnectionStatus PriceStatus { get; set; }
    }

    public class Position
    {
        public Instrument Instrument { get; set; }
        public MarketPosition MarketPosition { get; set; }
        public int Quantity { get; set; }
        public double AveragePrice { get; set; }
        public double Unrealized;
        public double GetUnrealizedProfitLoss(PerformanceUnit unit, double price = double.MinValue) { return Unrealized; }
    }

    public class Order
    {
        public string OrderId { get; set; }
        public string Name { get; set; }
        public Instrument Instrument { get; set; }
        public OrderState OrderState { get; set; }
        public OrderAction OrderAction { get; set; }
        public OrderType OrderType { get; set; }
        public int Quantity { get; set; }
        public int Filled { get; set; }
        public double LimitPrice { get; set; }
        public double StopPrice { get; set; }
    }

    public class Execution
    {
        public Account Account { get; set; }
        public string ExecutionId { get; set; }
        public string OrderId { get; set; }
        public Instrument Instrument { get; set; }
        public MarketPosition MarketPosition { get; set; }
        public double Price { get; set; }
        public int Quantity { get; set; }
        public DateTime Time { get; set; }
    }

    public class AccountItemEventArgs : EventArgs
    {
        public Account Account { get; set; }
        public AccountItem AccountItem { get; set; }
        public double Value { get; set; }
    }

    public class ExecutionEventArgs : EventArgs { public Execution Execution { get; set; } }

    public class Account
    {
        public static List<Account> All = new List<Account>();
        public string Name { get; set; }
        public Connection Connection { get; set; }
        public Currency Denomination { get; set; }
        public List<Position> Positions = new List<Position>();
        public List<Order> Orders = new List<Order>();
        public List<Execution> Executions = new List<Execution>();
        public Dictionary<AccountItem, double> Values = new Dictionary<AccountItem, double>();
        public event EventHandler<AccountItemEventArgs> AccountItemUpdate;
        public event EventHandler<ExecutionEventArgs> ExecutionUpdate;
        public double Get(AccountItem item, Currency currency) { double v; return Values.TryGetValue(item, out v) ? v : 0; }
        public void RaiseItem(AccountItem item, double v) { Values[item] = v; var h = AccountItemUpdate; if (h != null) h(this, new AccountItemEventArgs { Account = this, AccountItem = item, Value = v }); }
        public void RaiseExecution(Execution e) { lock (Executions) Executions.Add(e); var h = ExecutionUpdate; if (h != null) h(this, new ExecutionEventArgs { Execution = e }); }
        public int Subscribers { get { return (ExecutionUpdate == null ? 0 : ExecutionUpdate.GetInvocationList().Length) + (AccountItemUpdate == null ? 0 : AccountItemUpdate.GetInvocationList().Length); } }
    }
}
