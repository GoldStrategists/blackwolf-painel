// =============================================================================
//  Black Wolf Trading Floor — helper de eventos para o robô (NinjaScript)
// =============================================================================
//  Uso dentro da estratégia Black Wolf (opcional, desacoplado):
//
//     BlackWolfFloorEvents.Send("signal", Account.Name, "Black Wolf 3.1", Instrument.FullName,
//                               "buy", 1, Close[0], null, "Rompimento do canal");
//
//  Tipos aceitos: strategy_enabled, strategy_paused, channel_formed, signal,
//  entry_executed, take_profit, stop_loss, position_closed, error.
//
//  - Fire-and-forget: enfileira e retorna na hora. NUNCA bloqueia nem lança exceção
//    na thread da estratégia; se o painel estiver fora do ar, eventos são descartados
//    após 500 na fila (o painel é só monitoramento).
//  - Eventos do robô aparecem como INFORMATIVOS. A confirmação de execução vem do
//    coletor (feed de execuções da conta), nunca deste helper.
//  - Configuração: Documentos\NinjaTrader 8\BlackWolfFloor\robot.config
//        serverUrl=http://127.0.0.1:4100
//        token=<token do tipo "Robô">
//        target=live        (ou demo, para testar sem misturar com dados reais)
// =============================================================================

#region Using declarations
using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    public static class BlackWolfFloorEvents
    {
        private static readonly ConcurrentQueue<string> Queue = new ConcurrentQueue<string>();
        private static readonly AutoResetEvent Signal = new AutoResetEvent(false);
        private static readonly object InitLock = new object();
        private static Thread worker;
        private static string url, token;
        private static bool disabled;
        private static long counter;

        public static void Send(string type, string account, string strategy, string instrument, string side, int? quantity, double? price, string orderId, string message)
        {
            try
            {
                if (!EnsureStarted()) return;
                if (Queue.Count >= 500)
                {
                    string dropped;
                    Queue.TryDequeue(out dropped);
                }
                var id = DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture) + "-" + Interlocked.Increment(ref counter).ToString(CultureInfo.InvariantCulture);
                var sb = new StringBuilder(256);
                sb.Append('{');
                Field(sb, "eventId", id, true);
                Field(sb, "type", type, false);
                Field(sb, "account", account, false);
                Field(sb, "strategy", strategy, false);
                Field(sb, "instrument", instrument, false);
                Field(sb, "side", side, false);
                Field(sb, "orderId", orderId, false);
                Field(sb, "message", message != null && message.Length > 500 ? message.Substring(0, 500) : message, false);
                Field(sb, "time", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture), false);
                if (quantity.HasValue) sb.Append(",\"quantity\":").Append(quantity.Value.ToString(CultureInfo.InvariantCulture));
                if (price.HasValue && !double.IsNaN(price.Value) && !double.IsInfinity(price.Value)) sb.Append(",\"price\":").Append(price.Value.ToString("R", CultureInfo.InvariantCulture));
                sb.Append('}');
                Queue.Enqueue(sb.ToString());
                Signal.Set();
            }
            catch { /* nunca afeta o robô */ }
        }

        private static bool EnsureStarted()
        {
            if (worker != null) return true;
            if (disabled) return false;
            lock (InitLock)
            {
                if (worker != null) return true;
                try
                {
                    var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "NinjaTrader 8", "BlackWolfFloor", "robot.config");
                    if (!File.Exists(path)) { disabled = true; return false; }
                    string server = null, tok = null, target = "live";
                    foreach (var raw in File.ReadAllLines(path))
                    {
                        var line = raw.Trim();
                        if (line.StartsWith("#")) continue;
                        var i = line.IndexOf('=');
                        if (i <= 0) continue;
                        var k = line.Substring(0, i).Trim().ToLowerInvariant();
                        var v = line.Substring(i + 1).Trim();
                        if (k == "serverurl") server = v.TrimEnd('/');
                        else if (k == "token") tok = v;
                        else if (k == "target") target = v.Equals("demo", StringComparison.OrdinalIgnoreCase) ? "demo" : "live";
                    }
                    Uri uri;
                    if (string.IsNullOrEmpty(server) || string.IsNullOrEmpty(tok) || !Uri.TryCreate(server, UriKind.Absolute, out uri) || (uri.Scheme == "http" && !uri.IsLoopback))
                    {
                        disabled = true;
                        return false;
                    }
                    url = server + "/api/ingest/robot?target=" + target;
                    token = tok;
                    worker = new Thread(Loop) { IsBackground = true, Name = "BlackWolfFloorEvents" };
                    worker.Start();
                    return true;
                }
                catch
                {
                    disabled = true;
                    return false;
                }
            }
        }

        private static void Loop()
        {
            while (true)
            {
                Signal.WaitOne(2000);
                string item;
                while (Queue.TryPeek(out item))
                {
                    if (!Post(item))
                    {
                        Thread.Sleep(3000);
                        break;
                    }
                    Queue.TryDequeue(out item);
                }
            }
        }

        private static bool Post(string json)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 3000;
                req.Proxy = null;
                req.Headers[HttpRequestHeader.Authorization] = "Bearer " + token;
                var bytes = Encoding.UTF8.GetBytes(json);
                req.ContentLength = bytes.Length;
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                using (var resp = (HttpWebResponse)req.GetResponse()) return (int)resp.StatusCode == 200;
            }
            catch (WebException ex)
            {
                var http = ex.Response as HttpWebResponse;
                // 400 = evento inválido: descarta para não travar a fila.
                if (http != null && (int)http.StatusCode == 400) { http.Close(); return true; }
                if (http != null) http.Close();
                return false;
            }
            catch
            {
                return false;
            }
        }

        private static void Field(StringBuilder sb, string key, string value, bool first)
        {
            if (value == null) return;
            if (!first) sb.Append(',');
            sb.Append('"').Append(key).Append("\":\"");
            foreach (var ch in value)
            {
                if (ch == '"') sb.Append("\\\"");
                else if (ch == '\\') sb.Append("\\\\");
                else if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                else sb.Append(ch);
            }
            sb.Append('"');
        }
    }
}
