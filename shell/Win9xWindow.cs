using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Win9xSuite
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            string app = args.Length > 0 ? args[0].ToLowerInvariant() : "launcher";
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new SuiteWindow(app));
            }
            catch (Exception ex)
            {
                try
                {
                    File.WriteAllText(
                        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "startup-error.txt"),
                        ex.ToString());
                }
                catch
                {
                }

                MessageBox.Show(ex.ToString(), "Windows 9x Suite", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    /// <summary>
    /// One frameless window for every app in the suite: the page draws the Windows 95
    /// title bar and border, so there is exactly one title bar and it is the real window
    /// frame. WS_THICKFRAME stays set (with the non-client area zeroed) so the outer edge
    /// still resizes, and caption dragging still goes through DefWindowProc.
    /// </summary>
    internal sealed class SuiteWindow : Form
    {
        private const int WM_NCLBUTTONDOWN = 0x00A1;
        private const int WM_NCCALCSIZE = 0x0083;
        private const int HTCAPTION = 0x0002;
        private const int WS_THICKFRAME = 0x00040000;
        private const int WS_MINIMIZEBOX = 0x00020000;
        private const int WS_MAXIMIZEBOX = 0x00010000;

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

        private readonly string app;
        private readonly string page;
        private readonly WebView2 web;
        private CoreWebView2 core;
        private bool maximized;
        private Rectangle restoreBounds;

        public SuiteWindow(string app)
        {
            this.app = app;
            page = PageFor(app);

            Text = app == "paint" ? "untitled - Paint"
                : app == "notepad" ? "Untitled - Notepad"
                : app == "calc" ? "Calculator"
                : app == "minesweeper" ? "Minesweeper"
                : "Program Manager";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            BackColor = Color.FromArgb(0, 128, 128);

            float scale = 1f;
            using (Graphics screen = Graphics.FromHwnd(IntPtr.Zero))
            {
                scale = screen.DpiX / 96f;
            }

            int w = app == "paint" ? 1000 : app == "notepad" ? 660 : app == "calc" ? 262 : app == "minesweeper" ? 166 : 720;
            int h = app == "paint" ? 720 : app == "notepad" ? 520 : app == "calc" ? 264 : app == "minesweeper" ? 250 : 520;
            Bounds = new Rectangle((int)(80 * scale), (int)(50 * scale), (int)(w * scale), (int)(h * scale));
            MinimumSize = new Size((int)(Math.Min(420, w) * scale), (int)(Math.Min(300, h) * scale));

            KeyPreview = true;
            SetStyle(
                ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.ResizeRedraw,
                true);

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(0, 128, 128);
            Controls.Add(web);

            Load += OnLoaded;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.Style = cp.Style | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
                return cp;
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
            {
                m.Result = IntPtr.Zero;
                return;
            }

            base.WndProc(ref m);
        }

        private static string PageFor(string app)
        {
            switch (app)
            {
                case "paint":
                    return "apps/paint/index.html";
                case "notepad":
                    return "apps/notepad/index.html";
                case "calc":
                    return "apps/calc/index.html";
                case "minesweeper":
                    return "apps/minesweeper/index.html";
                default:
                    return "index.html";
            }
        }

        private async void OnLoaded(object sender, EventArgs e)
        {
            try
            {
                await InitAsync();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "The suite could not start its rendering engine.\n\n" + ex.Message,
                    "Windows 9x Suite",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Close();
            }
        }

        private async Task InitAsync()
        {
            string root = FindWebRoot();
            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Win9xSuite",
                app);
            Directory.CreateDirectory(userData);

            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData);
            await web.EnsureCoreWebView2Async(env);

            core = web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.SetVirtualHostNameToFolderMapping("win9x.local", root, CoreWebView2HostResourceAccessKind.Allow);
            core.WebMessageReceived += OnWebMessage;
            core.DocumentTitleChanged += OnTitleChanged;
            core.DownloadStarting += OnDownload;
            core.NewWindowRequested += OnNewWindow;

            web.Source = new Uri("https://win9x.local/" + page + (page.IndexOf('?') >= 0 ? "&" : "?") + "shell=1");
        }

        private static string FindWebRoot()
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            for (int i = 0; i < 6 && dir != null; i++)
            {
                if (File.Exists(Path.Combine(dir, "index.html")) && Directory.Exists(Path.Combine(dir, "apps")))
                {
                    return dir;
                }

                DirectoryInfo parent = Directory.GetParent(dir);
                dir = parent == null ? null : parent.FullName;
            }

            throw new FileNotFoundException("The suite folder (index.html + apps) was not found near Win9x.exe.");
        }

        private void OnTitleChanged(object sender, object e)
        {
            if (core != null)
            {
                Text = core.DocumentTitle;
            }
        }

        private void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
        }

        /* ---------- messages from the page ---------- */

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw = e.WebMessageAsJson;
            if (string.IsNullOrEmpty(raw))
            {
                return;
            }

            // postMessage("...") arrives as a JSON string, postMessage(object) as a JSON
            // object; unwrap the string form so both reach the same handler.
            string payload = raw;
            if (payload[0] == '"')
            {
                try
                {
                    payload = new JavaScriptSerializer().Deserialize<string>(payload) ?? "";
                }
                catch
                {
                }
            }

            if (payload.Length > 0 && payload[0] == '{')
            {
                Dictionary<string, object> message = null;
                try
                {
                    message = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(payload);
                }
                catch
                {
                    message = null;
                }

                if (message != null)
                {
                    HandleJson(message);
                    return;
                }
            }

            HandleCommand(payload);
        }

        private static string Unquote(string raw)
        {
            if (raw.Length >= 2 && raw[0] == '"' && raw[raw.Length - 1] == '"')
            {
                return raw.Substring(1, raw.Length - 2);
            }

            return raw;
        }

        private void HandleJson(Dictionary<string, object> m)
        {
            string t = Str(m, "t") ?? "";
            switch (t)
            {
                case "minimize":
                    WindowState = FormWindowState.Minimized;
                    break;
                case "maximize":
                    ToggleMaximize();
                    break;
                case "close":
                    Close();
                    break;
                case "drag":
                    StartDrag();
                    break;
                case "open":
                    OpenTextFile();
                    break;
                case "saveAs":
                    SaveText(Str(m, "name"), Str(m, "text"), null);
                    break;
                case "saveTo":
                    SaveText(Str(m, "name"), Str(m, "text"), Str(m, "path"));
                    break;
                case "paste":
                    Post(new Dictionary<string, object>
                    {
                        { "t", "clipboard" },
                        { "text", Clipboard.ContainsText() ? Clipboard.GetText() : "" },
                    });
                    break;
                case "copy":
                    string copy = Str(m, "text");
                    if (!string.IsNullOrEmpty(copy))
                    {
                        Clipboard.SetText(copy);
                    }

                    break;
                case "print":
                    PrintText(m);
                    break;
                case "launch":
                    Launch(Str(m, "app"));
                    break;
                case "resize":
                    ResizeWindow(Num(m, "w", 0f), Num(m, "h", 0f));
                    break;
            }
        }

        private void HandleCommand(string cmd)
        {
            switch (cmd)
            {
                case "minimize":
                    WindowState = FormWindowState.Minimized;
                    break;
                case "maximize":
                    ToggleMaximize();
                    break;
                case "close":
                    Close();
                    break;
                case "drag":
                    StartDrag();
                    break;
            }
        }

        private void Post(Dictionary<string, object> message)
        {
            if (core != null)
            {
                core.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(message));
            }
        }

        private static string Str(Dictionary<string, object> m, string key)
        {
            object value;
            if (m != null && m.TryGetValue(key, out value) && value != null)
            {
                return Convert.ToString(value);
            }

            return null;
        }

        private static float Num(Dictionary<string, object> m, string key, float fallback)
        {
            object value;
            if (m != null && m.TryGetValue(key, out value) && value != null)
            {
                float parsed;
                if (float.TryParse(Convert.ToString(value), out parsed) && parsed >= 0f)
                {
                    return parsed;
                }
            }

            return fallback;
        }

        /* ---------- window behaviour ---------- */

        private void StartDrag()
        {
            if (maximized)
            {
                ToggleMaximize();
            }

            ReleaseCapture();
            SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
        }

        private void ToggleMaximize()
        {
            if (!maximized)
            {
                restoreBounds = Bounds;
                Bounds = Screen.FromControl(this).WorkingArea;
                maximized = true;
            }
            else
            {
                Bounds = restoreBounds;
                maximized = false;
            }
        }

        /// <summary>Resizes the window to a requested page size, in CSS pixels.</summary>
        private void ResizeWindow(float width, float height)
        {
            if (maximized || width < 80f || height < 80f)
            {
                return;
            }

            float scale = 1f;
            using (Graphics screen = Graphics.FromHwnd(IntPtr.Zero))
            {
                scale = screen.DpiX / 96f;
            }

            Size = new Size((int)Math.Round(width * scale), (int)Math.Round(height * scale));
        }

        /* ---------- files ---------- */

        private void OpenTextFile()
        {
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Title = "Open";
                dlg.Filter = "Text Documents (*.txt)|*.txt|All Files (*.*)|*.*";
                if (dlg.ShowDialog(this) != DialogResult.OK)
                {
                    Post(new Dictionary<string, object> { { "t", "cancelled" } });
                    return;
                }

                string text = File.ReadAllText(dlg.FileName, Encoding.UTF8);
                Post(new Dictionary<string, object>
                {
                    { "t", "opened" },
                    { "path", dlg.FileName },
                    { "name", Path.GetFileName(dlg.FileName) },
                    { "text", text },
                });
            }
        }

        private void SaveText(string name, string text, string currentPath)
        {
            string path = currentPath;
            if (string.IsNullOrEmpty(path))
            {
                using (SaveFileDialog dlg = new SaveFileDialog())
                {
                    dlg.Title = "Save As";
                    dlg.Filter = "Text Documents (*.txt)|*.txt|All Files (*.*)|*.*";
                    dlg.FileName = string.IsNullOrEmpty(name) || name == "Untitled" ? "Untitled.txt" : name;
                    if (dlg.ShowDialog(this) != DialogResult.OK)
                    {
                        Post(new Dictionary<string, object> { { "t", "cancelled" } });
                        return;
                    }

                    path = dlg.FileName;
                }
            }

            File.WriteAllText(path, text ?? "", new UTF8Encoding(false));
            Post(new Dictionary<string, object>
            {
                { "t", "savedAs" },
                { "path", path },
                { "name", Path.GetFileName(path) },
            });
        }

        private void OnDownload(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            string ext = Path.GetExtension(e.ResultFilePath).ToLowerInvariant();
            using (SaveFileDialog dlg = new SaveFileDialog())
            {
                dlg.Title = "Save As";
                dlg.FileName = Path.GetFileName(e.ResultFilePath);

                if (ext == ".txt")
                {
                    dlg.Filter = "Text Documents (*.txt)|*.txt|All Files (*.*)|*.*";
                    dlg.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                }
                else if (ext == ".bmp")
                {
                    dlg.Filter = "256 Color Bitmap (*.bmp)|*.bmp|PNG image (*.png)|*.png";
                    dlg.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
                }
                else
                {
                    dlg.Filter = "PNG image (*.png)|*.png|256 Color Bitmap (*.bmp)|*.bmp";
                    dlg.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
                }

                if (dlg.ShowDialog(this) != DialogResult.OK)
                {
                    e.Cancel = true;
                    Post(new Dictionary<string, object> { { "t", "cancelled" } });
                    return;
                }

                e.ResultFilePath = dlg.FileName;
                Post(new Dictionary<string, object>
                {
                    { "t", "savedAs" },
                    { "path", dlg.FileName },
                    { "name", Path.GetFileName(dlg.FileName) },
                });
            }
        }

        /* ---------- printing ---------- */

        private void PrintText(Dictionary<string, object> m)
        {
            string name = Str(m, "name") ?? "Untitled";
            string text = Str(m, "text") ?? "";
            string header = Str(m, "header") ?? "";
            string footer = Str(m, "footer") ?? "";
            float mLeft = Num(m, "mLeft", 0.75f);
            float mTop = Num(m, "mTop", 0.75f);
            float mRight = Num(m, "mRight", 0.75f);
            float mBottom = Num(m, "mBottom", 0.75f);

            string[] lines = (text.Replace("\r\n", "\n").Replace('\r', '\n')).Split('\n');

            using (PrintDocument document = new PrintDocument())
            using (PrintDialog dlg = new PrintDialog())
            {
                document.DocumentName = name;
                int line = 0;
                int pageNo = 0;
                float y = 0f;
                bool first = true;

                document.PrintPage += (s, e) =>
                {
                    pageNo++;
                    using (Font body = new Font("Fixedsys", 10f))
                    using (Font small = new Font("Courier New", 8f))
                    {
                        RectangleF area = e.MarginBounds;
                        float left = area.Left + mLeft * 100f;
                        float top = area.Top + mTop * 100f;
                        float bottom = area.Bottom - mBottom * 100f;
                        float lineHeight = body.GetHeight(e.Graphics);

                        if (!string.IsNullOrEmpty(header))
                        {
                            string head = Tokens(header, name, pageNo);
                            e.Graphics.DrawString(head, small, Brushes.Black, left, area.Top);
                            top += small.GetHeight(e.Graphics) + 6f;
                        }

                        float footerY = area.Bottom - small.GetHeight(e.Graphics);
                        if (!string.IsNullOrEmpty(footer))
                        {
                            bottom -= small.GetHeight(e.Graphics) + 6f;
                        }

                        if (first)
                        {
                            y = top;
                            first = false;
                        }

                        while (line < lines.Length)
                        {
                            if (y + lineHeight > bottom)
                            {
                                break;
                            }

                            e.Graphics.DrawString(lines[line], body, Brushes.Black, left, y);
                            y += lineHeight;
                            line++;
                        }

                        if (!string.IsNullOrEmpty(footer))
                        {
                            e.Graphics.DrawString(Tokens(footer, name, pageNo), small, Brushes.Black, left, footerY);
                        }

                        if (line < lines.Length)
                        {
                            e.HasMorePages = true;
                            y = 0f;
                            first = true;
                        }
                        else
                        {
                            e.HasMorePages = false;
                        }
                    }
                };

                dlg.Document = document;
                dlg.UseEXDialog = false;
                if (dlg.ShowDialog(this) == DialogResult.OK)
                {
                    document.Print();
                }
            }
        }

        private static string Tokens(string pattern, string name, int page)
        {
            return pattern.Replace("&f", name).Replace("&p", page.ToString());
        }

        /* ---------- launching other apps ---------- */

        private void Launch(string target)
        {
            if (string.IsNullOrEmpty(target))
            {
                return;
            }

            Process.Start(Application.ExecutablePath, target);
        }
    }
}
