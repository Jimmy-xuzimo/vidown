using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Vidown.Native;

static class Program
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    static readonly object OutputLock = new();
    public static void Send(object value)
    {
        lock (OutputLock) Console.Out.WriteLine(JsonSerializer.Serialize(value, Json));
    }
    [STAThread]
    static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        using var form = new BrowserHost(new IntPtr(long.Parse(args[0])), int.Parse(args[1]), args[2]);
        _ = Task.Run(async () =>
        {
            while (await Console.In.ReadLineAsync() is { } line)
            {
                try
                {
                    var command = JsonDocument.Parse(line).RootElement.Clone();
                    form.BeginInvoke(async () => await form.Dispatch(command));
                }
                catch { /* Malformed local pipe input is never executed. */ }
            }
            if (!form.IsDisposed) form.BeginInvoke(() => Application.Exit());
        });
        Application.Run(form);
    }
}

sealed class BrowserHost : Form
{
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr child);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    readonly IntPtr parent;
    readonly string data;
    readonly Dictionary<string, WebView2> tabs = new();
    readonly Dictionary<string, (CoreWebView2DownloadOperation Op, CoreWebView2DownloadStartingEventArgs Args, CoreWebView2Deferral Deferral)> downloads = new();
    readonly System.Windows.Forms.Timer lifetime = new() { Interval = 1000 };
    CoreWebView2Environment? environment;
    WebView2? cookieView;
    string? active;
    bool shown;
    bool closing;
    public BrowserHost(IntPtr parent, int parentPid, string data)
    {
        this.parent = parent;
        this.data = data;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        AutoScaleMode = AutoScaleMode.None;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-32000, -32000);
        ClientSize = new Size(1, 1);
        BackColor = Color.FromArgb(245, 246, 250);
        lifetime.Tick += (_, _) =>
        {
            try { if (Process.GetProcessById(parentPid).HasExited) Application.Exit(); }
            catch { Application.Exit(); }
        };
        lifetime.Start();
    }
    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        SetParent(Handle, parent);
        SetWindowLong(Handle, -16, (GetWindowLong(Handle, -16) & ~unchecked((int)0x80000000)) | 0x40000000);
        Hide();
        Program.Send(new { type = "ready" });
    }
    static string Str(JsonElement value, string name, string fallback = "") =>
        value.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString()! : fallback;
    WebView2 Tab(JsonElement input) => tabs.GetValueOrDefault(Str(input, "tabId", active ?? "")) ?? throw new Exception("标签页已关闭");
    async Task Initialize(string proxy)
    {
        if (environment is not null) return;
        var options = new CoreWebView2EnvironmentOptions();
        if (proxy.Length > 0) options.AdditionalBrowserArguments = "--proxy-server=" + proxy;
        try { environment = await CoreWebView2Environment.CreateAsync(null, data, options); }
        catch (WebView2RuntimeNotFoundException) {
            throw new Exception("未找到 Windows WebView2 运行时，请安装 Microsoft Evergreen Runtime 后重试：https://developer.microsoft.com/microsoft-edge/webview2/");
        }
        cookieView = new WebView2 { Visible = false, Size = new Size(1, 1) };
        Controls.Add(cookieView);
        await cookieView.EnsureCoreWebView2Async(environment);
        Secure(cookieView.CoreWebView2);
    }
    void Secure(CoreWebView2 core)
    {
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsWebMessageEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
    }
    object Cookies(IEnumerable<CoreWebView2Cookie> cookies) => cookies.Select(c => new {
        name = c.Name, value = c.Value, domain = c.Domain, path = c.Path,
        secure = c.IsSecure, httpOnly = c.IsHttpOnly, session = c.IsSession,
        expirationDate = c.IsSession ? (double?)null : new DateTimeOffset(c.Expires.ToUniversalTime()).ToUnixTimeSeconds(),
        sameSite = c.SameSite.ToString().ToLowerInvariant()
    }).ToArray();
    void Changed(string id, WebView2 view) => Program.Send(new {
        type = "tab", tabId = id, url = view.Source?.ToString() ?? "about:blank",
        title = view.CoreWebView2.DocumentTitle, loading = navigating.Contains(id), zoomFactor = view.ZoomFactor
    });
    readonly HashSet<string> navigating = new();
    async Task NewTab(string id, string url)
    {
        if (environment is null) throw new Exception("浏览器尚未初始化");
        var view = new WebView2 { Dock = DockStyle.Fill, Visible = false, DefaultBackgroundColor = Color.White };
        tabs.Add(id, view);
        Controls.Add(view);
        await view.EnsureCoreWebView2Async(environment);
        var core = view.CoreWebView2;
        Secure(core);
        core.NavigationStarting += (_, e) => {
            if (!e.Uri.StartsWith("https://") && !e.Uri.StartsWith("http://") && e.Uri != "about:blank") { e.Cancel = true; return; }
            navigating.Add(id);
            Program.Send(new { type = "tab", tabId = id, url = e.Uri, title = core.DocumentTitle, loading = true });
        };
        core.NavigationCompleted += (_, e) => {
            navigating.Remove(id);
            Changed(id, view);
            if (!e.IsSuccess) Program.Send(new { type = "navigation-error", tabId = id, error = e.WebErrorStatus.ToString() });
        };
        core.SourceChanged += (_, _) => Changed(id, view);
        core.DocumentTitleChanged += (_, _) => Changed(id, view);
        core.NewWindowRequested += (_, e) => {
            e.Handled = true;
            if (e.Uri.StartsWith("http://") || e.Uri.StartsWith("https://")) Program.Send(new { type = "popup", url = e.Uri });
        };
        core.WebResourceResponseReceived += async (_, e) => {
            try {
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var h in e.Request.Headers) headers[h.Key] = h.Value;
                var mime = e.Response.Headers.Contains("Content-Type") ? e.Response.Headers.GetHeader("Content-Type") : "";
                if (!mime.StartsWith("video/", StringComparison.OrdinalIgnoreCase) && !mime.StartsWith("audio/", StringComparison.OrdinalIgnoreCase) && !mime.Contains("mpegurl", StringComparison.OrdinalIgnoreCase) && !mime.Contains("dash+xml", StringComparison.OrdinalIgnoreCase) && !System.Text.RegularExpressions.Regex.IsMatch(e.Request.Uri, @"\.(m3u8|mpd|mp4|m4a|webm|mp3|flac)(?:[?#]|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return;
                Program.Send(new { type = "capture", tabId = id, url = e.Request.Uri, mime, headers });
                if (mime.Contains("mpegurl", StringComparison.OrdinalIgnoreCase) || mime.Contains("dash+xml", StringComparison.OrdinalIgnoreCase)) {
                    using var stream = await e.Response.GetContentAsync();
                    if (stream is null) return;
                    using var buffer = new MemoryStream();
                    var bytes = new byte[65536];
                    int count;
                    while ((count = await stream.ReadAsync(bytes)) > 0) {
                        if (buffer.Length + count > 8*1024*1024) return;
                        buffer.Write(bytes, 0, count);
                    }
                    Program.Send(new { type = "manifest", url = e.Request.Uri, text = System.Text.Encoding.UTF8.GetString(buffer.ToArray()) });
                }
            } catch { /* Capture failure does not interrupt website playback. */ }
        };
        core.DownloadStarting += (_, e) => {
            e.Handled = true;
            var downloadId = Guid.NewGuid().ToString();
            var op = e.DownloadOperation;
            var deferral = e.GetDeferral();
            downloads.Add(downloadId, (op, e, deferral));
            long lastProgress = 0;
            void Progress() {
                var now = Environment.TickCount64;
                if(op.State == CoreWebView2DownloadState.InProgress && now-lastProgress < 100) return;
                lastProgress = now;
                Program.Send(new { type = "download-progress", downloadId, bytes = op.BytesReceived, total = op.TotalBytesToReceive, canResume = op.CanResume || op.State == CoreWebView2DownloadState.InProgress });
            }
            op.BytesReceivedChanged += (_, _) => Progress();
            op.StateChanged += (_, _) => {
                Progress();
                Program.Send(new { type = "download-state", downloadId, state = op.State.ToString(), reason = op.InterruptReason.ToString(), canResume = op.CanResume });
                if (op.State == CoreWebView2DownloadState.Completed) downloads.Remove(downloadId);
            };
            Program.Send(new { type = "download-start", downloadId, tabId = id, filename = Path.GetFileName(e.ResultFilePath), mime = op.MimeType, total = op.TotalBytesToReceive });
        };
        Select(id);
        core.Navigate(url);
    }
    void Select(string id)
    {
        if (!tabs.ContainsKey(id)) throw new Exception("标签页不存在");
        active = id;
        foreach (var pair in tabs) pair.Value.Visible = shown && pair.Key == active;
        tabs[id].BringToFront();
    }
    async Task<object?> Execute(WebView2 view, string code)
    {
        using var result = JsonDocument.Parse(await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", JsonSerializer.Serialize(new { expression = code, awaitPromise = true, returnByValue = true, userGesture = true })));
        var root = result.RootElement;
        if (root.TryGetProperty("exceptionDetails", out var exception)) {
            var description = exception.TryGetProperty("exception", out var ex) ? Str(ex, "description") : Str(exception, "text");
            throw new Exception(description);
        }
        return root.GetProperty("result").TryGetProperty("value", out var value) ? value.Clone() : null;
    }
    public async Task Dispatch(JsonElement input)
    {
        var request = Str(input, "id");
        try {
            object? value = null;
            var command = Str(input, "command");
            switch (command) {
                case "init":
                    await Initialize(Str(input, "proxy"));
                    value = new { version = environment!.BrowserVersionString, userAgent = cookieView!.CoreWebView2.Settings.UserAgent };
                    break;
                case "new": await NewTab(Str(input, "tabId"), Str(input, "url", "about:blank")); break;
                case "navigate": Tab(input).CoreWebView2.Navigate(Str(input, "url")); break;
                case "select": Select(Str(input, "tabId")); break;
                case "bounds":
                    shown = input.GetProperty("visible").GetBoolean();
                    SetWindowPos(Handle, IntPtr.Zero, input.GetProperty("x").GetInt32(), input.GetProperty("y").GetInt32(), Math.Max(1,input.GetProperty("width").GetInt32()), Math.Max(1,input.GetProperty("height").GetInt32()), 0x0010);
                    Visible = shown;
                    if (active is not null) Select(active);
                    break;
                case "reload": Tab(input).CoreWebView2.Reload(); break;
                case "back": if (Tab(input).CanGoBack) Tab(input).GoBack(); break;
                case "forward": if (Tab(input).CanGoForward) Tab(input).GoForward(); break;
                case "zoom": Tab(input).ZoomFactor = input.GetProperty("factor").GetDouble(); break;
                case "execute": value = await Execute(Tab(input), Str(input,"code")); break;
                case "capture":
                    using (var stream = new MemoryStream()) {
                        await Tab(input).CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                        value = Convert.ToBase64String(stream.ToArray());
                    }
                    break;
                case "geometry": value = new { parent = GetParent(Handle).ToInt64().ToString(), x = Left, y = Top, width = Width, height = Height, visible = Visible }; break;
                case "cookies": value = Cookies(await cookieView!.CoreWebView2.CookieManager.GetCookiesAsync(null)); break;
                case "setCookies":
                    var manager = cookieView!.CoreWebView2.CookieManager;
                    foreach (var item in input.GetProperty("cookies").EnumerateArray()) {
                        var c = manager.CreateCookie(Str(item,"name"), Str(item,"value"), Str(item,"domain"), Str(item,"path","/"));
                        c.IsHttpOnly = item.GetProperty("httpOnly").GetBoolean();
                        c.IsSecure = item.GetProperty("secure").GetBoolean();
                        c.SameSite = Str(item,"sameSite") switch {
                            "no_restriction" => CoreWebView2CookieSameSiteKind.None,
                            "strict" => CoreWebView2CookieSameSiteKind.Strict,
                            _ => CoreWebView2CookieSameSiteKind.Lax
                        };
                        manager.AddOrUpdateCookie(c);
                    }
                    break;
                case "logout":
                    foreach (var tab in tabs.Values) tab.Dispose();
                    tabs.Clear(); active = null;
                    await cookieView!.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.AllProfile);
                    cookieView.CoreWebView2.CookieManager.DeleteAllCookies();
                    break;
                case "close":
                    var id = Str(input, "tabId");
                    if(tabs.Remove(id, out var old)) old.Dispose();
                    if(active==id) active=null;
                    break;
                case "download-accept":
                    if (downloads.TryGetValue(Str(input,"downloadId"), out var pending)) {
                        pending.Args.ResultFilePath = Str(input,"path");
                        pending.Deferral.Complete();
                    }
                    break;
                case "download-action":
                    if(downloads.TryGetValue(Str(input,"downloadId"),out var job)) {
                        switch(Str(input,"action")) {
                            case "cancel": job.Op.Cancel(); try { job.Deferral.Complete(); } catch {} break;
                            case "pause": job.Op.Pause(); break;
                            case "resume": job.Op.Resume(); break;
                        }
                    }
                    break;
                case "shutdown": Program.Send(new { id=request, value=true }); Application.Exit(); return;
                default: throw new Exception("无效的浏览器命令");
            }
            Program.Send(new { id = request, value });
        } catch (Exception error) {
            Program.Send(new { id = request, error = error.Message });
        }
    }
    protected override void Dispose(bool disposing)
    {
        if(disposing && !closing) {
            closing=true;
            lifetime.Dispose();
            foreach(var job in downloads.Values) { job.Op.Cancel(); try { job.Deferral.Complete(); } catch {} }
            foreach(var view in tabs.Values) view.Dispose();
            cookieView?.Dispose();
        }
        base.Dispose(disposing);
    }
}

