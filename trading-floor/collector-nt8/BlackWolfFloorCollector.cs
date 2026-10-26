// =============================================================================
//  Black Wolf Trading Floor — Coletor para NinjaTrader 8 (AddOn)
// =============================================================================
//  SOMENTE LEITURA. Este AddOn NÃO envia, altera, cancela nem fecha ordens.
//  Ele lê contas, posições, ordens e execuções que o próprio NinjaTrader já
//  recebe das conexões (Rithmic, Tradovate, ...) e envia um resumo para o
//  servidor local do Black Wolf Trading Floor via HTTP (padrão 127.0.0.1).
//
//  - Não pede nem lê senhas de corretora: usa as conexões já abertas no NT8.
//  - Autentica no servidor com um token de ingestão (só permite ENVIAR dados).
//  - Sem bibliotecas externas: compila no NinjaScript Editor (F5).
//
//  Instalação: copie este arquivo para
//     Documentos\NinjaTrader 8\bin\Custom\AddOns\
//  e veja docs/NINJATRADER.md.
// =============================================================================

#region Using declarations
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using NinjaTrader.Cbi;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    public class BlackWolfFloorCollector : AddOnBase
    {
        // O NT8 cria instâncias de AddOn a cada compilação/inicialização. Um único
        // núcleo (estático) evita coletores duplicados enviando em paralelo.
        private static readonly object Gate = new object();
        private static BlackWolfCollectorCore core;
        private static BlackWolfFloorCollector owner;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "BlackWolfFloorCollector";
                Description = "Black Wolf Trading Floor: envia contas, posições e execuções (somente leitura) para o painel local.";
            }
            else if (State == State.Configure || State == State.Active)
            {
                // Idempotente: a mesma instância pode passar por Configure e Active.
                // Uma instância nova (recompilação) assume o lugar da antiga.
                lock (Gate)
                {
                    if (owner == this) return;
                    if (core != null) core.Stop();
                    core = new BlackWolfCollectorCore();
                    owner = this;
                    core.Start();
                }
            }
            else if (State == State.Terminated)
            {
                lock (Gate)
                {
                    if (core != null && owner == this)
                    {
                        core.Stop();
                        core = null;
                        owner = null;
                    }
                }
            }
        }
    }

    /// <summary>Configuração lida de Documentos\NinjaTrader 8\BlackWolfFloor\collector.config</summary>
    internal sealed class BlackWolfCollectorConfig
    {
        public string ServerUrl = "http://127.0.0.1:4100";
        public string Token = "";
        public string CollectorId = "";
        public int IntervalMs = 1000;
        public HashSet<string> Include = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> Exclude = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Sim101", "Backtest", "Playback101" };
        public bool IncludeSimulator = false;
        public bool Enabled = true;

        public static string Folder
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "NinjaTrader 8", "BlackWolfFloor"); }
        }

        public static string FilePath { get { return Path.Combine(Folder, "collector.config"); } }

        public static BlackWolfCollectorConfig Load(out string problem)
        {
            problem = null;
            var c = new BlackWolfCollectorConfig();
            c.CollectorId = SafeId(Environment.MachineName);
            try
            {
                Directory.CreateDirectory(Folder);
                if (!File.Exists(FilePath))
                {
                    File.WriteAllText(FilePath, Template(c.CollectorId), Encoding.UTF8);
                    problem = "Arquivo de configuração criado em " + FilePath + ". Preencha o token e reinicie o NinjaTrader (ou recompile).";
                    c.Enabled = false;
                    return c;
                }
                foreach (var rawLine in File.ReadAllLines(FilePath))
                {
                    var line = rawLine.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    var idx = line.IndexOf('=');
                    if (idx <= 0) continue;
                    var key = line.Substring(0, idx).Trim().ToLowerInvariant();
                    var val = line.Substring(idx + 1).Trim();
                    switch (key)
                    {
                        case "serverurl": c.ServerUrl = val.TrimEnd('/'); break;
                        case "token": c.Token = val; break;
                        case "collectorid": if (val.Length > 0) c.CollectorId = SafeId(val); break;
                        case "intervalms":
                            int ms;
                            if (int.TryParse(val, out ms)) c.IntervalMs = Math.Max(250, Math.Min(10000, ms));
                            break;
                        case "includeaccounts": c.Include = Split(val); break;
                        case "excludeaccounts": c.Exclude = Split(val); break;
                        case "includesimulator": c.IncludeSimulator = val.Equals("true", StringComparison.OrdinalIgnoreCase); break;
                        case "enabled": c.Enabled = !val.Equals("false", StringComparison.OrdinalIgnoreCase); break;
                    }
                }
            }
            catch (Exception ex)
            {
                problem = "Erro lendo configuração: " + ex.Message;
                c.Enabled = false;
                return c;
            }

            if (string.IsNullOrEmpty(c.Token) || c.Token.StartsWith("COLE_"))
            {
                problem = "Token não configurado em " + FilePath;
                c.Enabled = false;
            }
            Uri uri;
            if (!Uri.TryCreate(c.ServerUrl, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            {
                problem = "serverUrl inválido: " + c.ServerUrl;
                c.Enabled = false;
            }
            else if (uri.Scheme == "http" && !uri.IsLoopback)
            {
                // Dados financeiros e token não trafegam sem criptografia fora do próprio PC.
                problem = "serverUrl aponta para outra máquina sem HTTPS. Use https:// (ver docs/SEGURANCA.md).";
                c.Enabled = false;
            }
            return c;
        }

        private static HashSet<string> Split(string v)
        {
            return new HashSet<string>(v.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).Where(s => s.Length > 0), StringComparer.OrdinalIgnoreCase);
        }

        private static string SafeId(string v)
        {
            var sb = new StringBuilder();
            foreach (var ch in v) sb.Append(char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' || ch == '.' ? ch : '-');
            var s = sb.ToString();
            if (s.Length == 0) s = "nt8";
            return s.Length > 64 ? s.Substring(0, 64) : s;
        }

        private static string Template(string id)
        {
            return string.Join(Environment.NewLine, new[]
            {
                "# Black Wolf Trading Floor — coletor NinjaTrader 8",
                "# Gere o token em Configurações → Integrações no painel (tipo: Coletor NinjaTrader 8).",
                "# NUNCA coloque senhas de corretora neste arquivo.",
                "serverUrl=http://127.0.0.1:4100",
                "token=COLE_O_TOKEN_AQUI",
                "collectorId=" + id,
                "intervalMs=1000",
                "# Lista de contas (separadas por vírgula). Vazio = todas.",
                "includeAccounts=",
                "excludeAccounts=Sim101,Backtest,Playback101",
                "# true para incluir contas da conexão Simulator do próprio NT8",
                "includeSimulator=false",
                "enabled=true",
                ""
            });
        }
    }

    /// <summary>Núcleo do coletor: lê o estado do NT8 e envia ao servidor numa thread própria.</summary>
    internal sealed class BlackWolfCollectorCore
    {
        private const string Version = "bw-nt8-collector/1.0.0";
        private const int MaxQueuedExecutions = 20000;

        // Itens que o NT8 expõe via Account.Get (enum AccountItem). Nomes iguais aos aceitos pelo servidor.
        private static readonly AccountItem[] Items =
        {
            AccountItem.BuyingPower, AccountItem.CashValue, AccountItem.Commission, AccountItem.ExcessIntradayMargin,
            AccountItem.ExcessInitialMargin, AccountItem.ExcessMaintenanceMargin, AccountItem.Fee, AccountItem.GrossRealizedProfitLoss,
            AccountItem.InitialMargin, AccountItem.IntradayMargin, AccountItem.MaintenanceMargin, AccountItem.NetLiquidation,
            AccountItem.RealizedProfitLoss, AccountItem.SodCashValue, AccountItem.SodLiquidatingValue, AccountItem.TotalCashBalance,
            AccountItem.UnrealizedProfitLoss
        };
        private static readonly HashSet<AccountItem> Core = new HashSet<AccountItem>
        {
            AccountItem.CashValue, AccountItem.NetLiquidation, AccountItem.RealizedProfitLoss, AccountItem.UnrealizedProfitLoss
        };
        private static readonly HashSet<string> FinalOrderStates = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Filled", "Cancelled", "Rejected", "Unknown"
        };

        private readonly string sessionId = Guid.NewGuid().ToString("N");
        private readonly ConcurrentQueue<ExecRecord> pending = new ConcurrentQueue<ExecRecord>();
        private readonly ConcurrentDictionary<string, byte> seenItems = new ConcurrentDictionary<string, byte>();
        private readonly HashSet<Account> subscribed = new HashSet<Account>();
        private readonly object subLock = new object();
        private readonly ManualResetEvent stopSignal = new ManualResetEvent(false);
        private Thread worker;
        private BlackWolfCollectorConfig config;
        private long seq;
        private volatile bool stopping;
        private int failures;
        private DateTime lastBackfill = DateTime.MinValue;
        private DateTime lastLogAt = DateTime.MinValue;
        private string lastLogMsg;

        private sealed class ExecRecord
        {
            public string Account, ExecId, TimeUtc, Instrument, Side, OrderId;
            public int Quantity;
            public double Price;
        }

        public void Start()
        {
            string problem;
            config = BlackWolfCollectorConfig.Load(out problem);
            if (problem != null) Log(problem);
            if (!config.Enabled)
            {
                Log("Coletor desativado.");
                return;
            }
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            }
            catch { }
            worker = new Thread(Loop) { IsBackground = true, Name = "BlackWolfFloorCollector" };
            worker.Start();
            Log("Coletor iniciado (" + Version + ") → " + config.ServerUrl + " como " + config.CollectorId);
        }

        public void Stop()
        {
            stopping = true;
            stopSignal.Set();
            lock (subLock)
            {
                foreach (var a in subscribed)
                {
                    try
                    {
                        a.ExecutionUpdate -= OnExecutionUpdate;
                        a.AccountItemUpdate -= OnAccountItemUpdate;
                    }
                    catch { }
                }
                subscribed.Clear();
            }
            if (worker != null && worker.IsAlive) worker.Join(3000);
        }

        // ------------------------------------------------------------------ eventos NT8 (só leitura)

        private void OnAccountItemUpdate(object sender, AccountItemEventArgs e)
        {
            try
            {
                if (e.Account != null) seenItems[e.Account.Name + "|" + e.AccountItem] = 1;
            }
            catch { }
        }

        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            try
            {
                if (e.Execution != null) Enqueue(e.Execution);
            }
            catch (Exception ex)
            {
                Log("Erro lendo execução: " + ex.Message);
            }
        }

        private void Enqueue(Execution x)
        {
            if (x == null || x.Account == null || string.IsNullOrEmpty(x.ExecutionId) || x.Quantity <= 0) return;
            if (pending.Count >= MaxQueuedExecutions)
            {
                ExecRecord dropped;
                pending.TryDequeue(out dropped);
            }
            pending.Enqueue(new ExecRecord
            {
                Account = x.Account.Name,
                ExecId = x.ExecutionId,
                TimeUtc = ToUtcIso(x.Time),
                Instrument = x.Instrument != null ? x.Instrument.FullName : "?",
                Side = x.MarketPosition == MarketPosition.Short ? "sell" : "buy",
                Quantity = x.Quantity,
                Price = x.Price,
                OrderId = x.OrderId
            });
        }

        // ------------------------------------------------------------------ laço principal

        private void Loop()
        {
            while (!stopping)
            {
                var started = DateTime.UtcNow;
                try
                {
                    SyncSubscriptions();
                    // Reenvia as execuções da sessão periodicamente e após falhas: o servidor
                    // deduplica pelo ExecutionId, então isso só preenche lacunas.
                    if ((DateTime.UtcNow - lastBackfill).TotalMinutes >= 5) Backfill();
                    var batch = new List<ExecRecord>();
                    ExecRecord r;
                    while (batch.Count < 2000 && pending.TryDequeue(out r)) batch.Add(r);
                    var json = BuildPayload(batch);
                    var ok = Post(json);
                    if (ok)
                    {
                        if (failures > 0)
                        {
                            Log("Conexão com o servidor restabelecida.");
                            lastBackfill = DateTime.MinValue;
                        }
                        failures = 0;
                    }
                    else
                    {
                        // Devolve as execuções para a fila (ordem não importa; o servidor ordena por tempo).
                        foreach (var b in batch) pending.Enqueue(b);
                        failures++;
                    }
                }
                catch (Exception ex)
                {
                    failures++;
                    Log("Erro no coletor: " + ex.Message);
                }
                var wait = failures == 0 ? config.IntervalMs : Math.Min(15000, config.IntervalMs * (1 << Math.Min(failures, 4)));
                var elapsed = (int)(DateTime.UtcNow - started).TotalMilliseconds;
                if (stopSignal.WaitOne(Math.Max(50, wait - elapsed))) break;
            }
        }

        private bool Included(Account a)
        {
            if (a == null || string.IsNullOrEmpty(a.Name)) return false;
            if (config.Include.Count > 0 && !config.Include.Contains(a.Name)) return false;
            if (config.Exclude.Contains(a.Name)) return false;
            if (!config.IncludeSimulator)
            {
                var provider = ProviderName(a);
                if (provider != null && provider.IndexOf("Simulator", StringComparison.OrdinalIgnoreCase) >= 0) return false;
            }
            return true;
        }

        private List<Account> Accounts()
        {
            var list = new List<Account>();
            lock (Account.All)
            {
                foreach (var a in Account.All) if (Included(a)) list.Add(a);
            }
            return list;
        }

        private void SyncSubscriptions()
        {
            var current = Accounts();
            lock (subLock)
            {
                foreach (var a in current)
                {
                    if (subscribed.Contains(a)) continue;
                    // Remove antes de adicionar: evita assinatura dupla.
                    a.ExecutionUpdate -= OnExecutionUpdate;
                    a.AccountItemUpdate -= OnAccountItemUpdate;
                    a.ExecutionUpdate += OnExecutionUpdate;
                    a.AccountItemUpdate += OnAccountItemUpdate;
                    subscribed.Add(a);
                }
                foreach (var gone in subscribed.Where(a => !current.Contains(a)).ToList())
                {
                    try
                    {
                        gone.ExecutionUpdate -= OnExecutionUpdate;
                        gone.AccountItemUpdate -= OnAccountItemUpdate;
                    }
                    catch { }
                    subscribed.Remove(gone);
                }
            }
        }

        private void Backfill()
        {
            lastBackfill = DateTime.UtcNow;
            foreach (var a in Accounts())
            {
                lock (a.Executions)
                {
                    foreach (var x in a.Executions) Enqueue(x);
                }
            }
        }

        // ------------------------------------------------------------------ montagem do JSON

        private string BuildPayload(List<ExecRecord> executions)
        {
            var w = new BlackWolfJson();
            w.BeginObject();
            w.Prop("v", 1);
            w.Prop("collectorId", config.CollectorId);
            w.Prop("sessionId", sessionId);
            w.Prop("seq", Interlocked.Increment(ref seq));
            w.Prop("sentAt", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture));
            w.Prop("version", Version);

            w.Key("connections");
            w.BeginArray();
            var seenConn = new HashSet<string>();
            foreach (var a in Accounts())
            {
                var c = a.Connection;
                if (c == null || c.Options == null || !seenConn.Add(c.Options.Name)) continue;
                w.BeginObject();
                w.Prop("name", c.Options.Name);
                w.Prop("provider", ProviderName(a));
                w.Prop("status", MapStatus(c.Status.ToString()));
                w.EndObject();
            }
            w.EndArray();

            w.Key("accounts");
            w.BeginArray();
            foreach (var a in Accounts()) WriteAccount(w, a);
            w.EndArray();

            w.Key("executions");
            w.BeginArray();
            foreach (var e in executions)
            {
                w.BeginObject();
                w.Prop("account", e.Account);
                w.Prop("execId", e.ExecId);
                w.Prop("time", e.TimeUtc);
                w.Prop("instrument", e.Instrument);
                w.Prop("side", e.Side);
                w.Prop("quantity", e.Quantity);
                w.Prop("price", e.Price);
                w.Prop("orderId", e.OrderId);
                w.EndObject();
            }
            w.EndArray();
            w.EndObject();
            return w.ToString();
        }

        private void WriteAccount(BlackWolfJson w, Account a)
        {
            var conn = a.Connection;
            w.BeginObject();
            w.Prop("name", a.Name);
            w.Prop("connection", conn != null && conn.Options != null ? conn.Options.Name : null);
            w.Prop("provider", ProviderName(a));
            w.Prop("connectionStatus", conn != null ? MapStatus(conn.Status.ToString()) : "unknown");
            w.Prop("priceStatus", conn != null ? MapStatus(conn.PriceStatus.ToString()) : "unknown");
            w.Prop("denomination", a.Denomination.ToString());

            // Só envia itens que a conexão REALMENTE informa. Regra:
            //  - item que já chegou por AccountItemUpdate, ou valor ≠ 0 → informado;
            //  - itens centrais (saldo/P&L) valendo 0 contam como informados se algum
            //    outro item central da conta é ≠ 0 (ex.: P&L realizado 0 no início do dia).
            var values = new Dictionary<AccountItem, double>();
            foreach (var item in Items)
            {
                try { values[item] = a.Get(item, a.Denomination); }
                catch { }
            }
            var coreReported = values.Any(kv => Core.Contains(kv.Key) && kv.Value != 0 && !double.IsNaN(kv.Value));
            w.Key("items");
            w.BeginObject();
            foreach (var kv in values)
            {
                if (double.IsNaN(kv.Value) || double.IsInfinity(kv.Value)) continue;
                var seen = seenItems.ContainsKey(a.Name + "|" + kv.Key);
                if (seen || kv.Value != 0 || (coreReported && Core.Contains(kv.Key))) w.Prop(kv.Key.ToString(), kv.Value);
            }
            w.EndObject();

            w.Key("positions");
            w.BeginArray();
            lock (a.Positions)
            {
                foreach (var p in a.Positions)
                {
                    if (p == null || p.MarketPosition == MarketPosition.Flat || p.Quantity <= 0) continue;
                    w.BeginObject();
                    w.Prop("instrument", p.Instrument != null ? p.Instrument.FullName : "?");
                    w.Prop("side", p.MarketPosition == MarketPosition.Long ? "long" : "short");
                    w.Prop("quantity", p.Quantity);
                    w.Prop("avgPrice", p.AveragePrice);
                    double? unreal = null;
                    try
                    {
                        // Usa o último preço que o NT8 tem para o instrumento. Sem cotação ativa → null.
                        var u = p.GetUnrealizedProfitLoss(PerformanceUnit.Currency);
                        if (!double.IsNaN(u) && !double.IsInfinity(u) && Math.Abs(u) < 1e12) unreal = u;
                    }
                    catch { }
                    w.Prop("unrealized", unreal);
                    w.EndObject();
                }
            }
            w.EndArray();

            w.Key("orders");
            w.BeginArray();
            lock (a.Orders)
            {
                foreach (var o in a.Orders)
                {
                    if (o == null) continue;
                    var state = o.OrderState.ToString();
                    if (FinalOrderStates.Contains(state)) continue;
                    w.BeginObject();
                    w.Prop("orderId", string.IsNullOrEmpty(o.OrderId) ? "?" : o.OrderId);
                    w.Prop("instrument", o.Instrument != null ? o.Instrument.FullName : "?");
                    w.Prop("action", o.OrderAction.ToString());
                    w.Prop("type", o.OrderType.ToString());
                    w.Prop("quantity", o.Quantity);
                    w.Prop("filled", o.Filled);
                    w.Prop("limitPrice", o.LimitPrice != 0 ? (double?)o.LimitPrice : null);
                    w.Prop("stopPrice", o.StopPrice != 0 ? (double?)o.StopPrice : null);
                    w.Prop("state", state);
                    w.Prop("name", string.IsNullOrEmpty(o.Name) ? null : (o.Name.Length > 64 ? o.Name.Substring(0, 64) : o.Name));
                    w.EndObject();
                }
            }
            w.EndArray();
            w.EndObject();
        }

        private static string ProviderName(Account a)
        {
            try
            {
                if (a.Connection != null && a.Connection.Options != null) return a.Connection.Options.Provider.ToString();
            }
            catch { }
            return null;
        }

        /// <summary>ConnectionStatus do NT8 → valores do protocolo.</summary>
        internal static string MapStatus(string s)
        {
            switch (s)
            {
                case "Connected": return "connected";
                case "Connecting": return "connecting";
                case "ConnectionLost": return "connection_lost";
                case "Disconnecting": return "disconnecting";
                case "Disconnected": return "disconnected";
                default: return "unknown";
            }
        }

        private static string ToUtcIso(DateTime t)
        {
            // Horários do NT8 vêm no fuso local do PC.
            var utc = t.Kind == DateTimeKind.Utc ? t : DateTime.SpecifyKind(t, DateTimeKind.Local).ToUniversalTime();
            return utc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        }

        // ------------------------------------------------------------------ HTTP

        private bool Post(string json)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(config.ServerUrl + "/api/ingest/nt8");
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 4000;
                req.ReadWriteTimeout = 4000;
                req.KeepAlive = true;
                req.Proxy = null;
                req.Headers[HttpRequestHeader.Authorization] = "Bearer " + config.Token;
                var bytes = Encoding.UTF8.GetBytes(json);
                req.ContentLength = bytes.Length;
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    return (int)resp.StatusCode == 200;
                }
            }
            catch (WebException ex)
            {
                var http = ex.Response as HttpWebResponse;
                if (http != null)
                {
                    var code = (int)http.StatusCode;
                    http.Close();
                    if (code == 401) Log("Servidor recusou o token (401). Gere um novo token do tipo NinjaTrader e atualize " + BlackWolfCollectorConfig.FilePath);
                    else if (code == 400) Log("Servidor recusou os dados (400). Verifique se o coletor e o servidor estão na mesma versão.");
                    else Log("Servidor respondeu HTTP " + code);
                }
                else Log("Sem conexão com o servidor (" + ex.Status + "). Tentando novamente…");
                return false;
            }
            catch (Exception ex)
            {
                Log("Falha ao enviar: " + ex.Message);
                return false;
            }
        }

        // ------------------------------------------------------------------ log (sem dados sensíveis)

        private void Log(string msg)
        {
            // Limita repetição da mesma mensagem (ex.: servidor fora do ar) a 1 por minuto.
            var now = DateTime.Now;
            if (msg == lastLogMsg && (now - lastLogAt).TotalSeconds < 60) return;
            lastLogMsg = msg;
            lastLogAt = now;
            try
            {
                Directory.CreateDirectory(BlackWolfCollectorConfig.Folder);
                var path = Path.Combine(BlackWolfCollectorConfig.Folder, "collector.log");
                var fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 1024 * 1024) File.Copy(path, path + ".1", true);
                if (fi.Exists && fi.Length > 1024 * 1024) File.Delete(path);
                File.AppendAllText(path, now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + msg + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }
    }

    /// <summary>Escritor JSON mínimo (sem dependências). Números em cultura invariante; NaN → null.</summary>
    internal sealed class BlackWolfJson
    {
        private readonly StringBuilder sb = new StringBuilder(4096);
        private readonly Stack<bool> first = new Stack<bool>();
        private bool afterKey;

        public void BeginObject() { Comma(); sb.Append('{'); first.Push(true); }
        public void EndObject() { sb.Append('}'); first.Pop(); }
        public void BeginArray() { Comma(); sb.Append('['); first.Push(true); }
        public void EndArray() { sb.Append(']'); first.Pop(); }

        public void Key(string k)
        {
            Comma();
            Str(k);
            sb.Append(':');
            afterKey = true;
        }

        public void Prop(string k, string v) { Key(k); Value(v); }
        public void Prop(string k, long v) { Key(k); Raw(v.ToString(CultureInfo.InvariantCulture)); }
        public void Prop(string k, int v) { Key(k); Raw(v.ToString(CultureInfo.InvariantCulture)); }
        public void Prop(string k, double v) { Key(k); Num(v); }
        public void Prop(string k, double? v) { Key(k); if (v.HasValue) Num(v.Value); else Raw("null"); }

        private void Value(string v)
        {
            if (v == null) Raw("null");
            else { Comma(); Str(v); }
        }

        private void Num(double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) Raw("null");
            else Raw(v.ToString("R", CultureInfo.InvariantCulture));
        }

        private void Raw(string s) { Comma(); sb.Append(s); }

        private void Comma()
        {
            if (afterKey) { afterKey = false; return; }
            if (first.Count == 0) return;
            if (first.Peek()) { first.Pop(); first.Push(false); }
            else sb.Append(',');
        }

        private void Str(string s)
        {
            sb.Append('"');
            foreach (var ch in s)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                        else sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
        }

        public override string ToString() { return sb.ToString(); }
    }
}
