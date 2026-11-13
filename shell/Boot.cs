using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Windows.Forms;

namespace Win9xSuitePack
{
    /// <summary>
    /// The single-file release: the shell exe, its WebView2 DLLs and every app page travel
    /// inside this exe as one embedded zip. On first run - or whenever the payload changes -
    /// it unpacks to %LOCALAPPDATA%\Win9xSuite\app and starts shell\bin\Win9x.exe with the
    /// same arguments, so `Win9x-Suite.exe notepad` behaves like `Win9x.exe notepad`.
    /// </summary>
    internal static class Program
    {
        private const string ResourceName = "Payload.zip";

        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                string target = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Win9xSuite",
                    "app");
                string exe = Path.Combine(target, "shell", "bin", "Win9x.exe");

                using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName))
                {
                    if (payload == null)
                    {
                        throw new InvalidOperationException("This exe is missing its suite payload.");
                    }

                    string stamp = Hash(payload);
                    string stampFile = Path.Combine(target, "payload.stamp");
                    bool upToDate = File.Exists(exe)
                        && File.Exists(stampFile)
                        && string.Equals(File.ReadAllText(stampFile).Trim(), stamp, StringComparison.Ordinal);

                    if (!upToDate)
                    {
                        try
                        {
                            Unpack(payload, target, stamp);
                        }
                        catch (Exception ex)
                        {
                            // A copy of the suite is running from the target folder, so the
                            // old files are locked. That copy is still fine to start.
                            if (!File.Exists(exe))
                            {
                                throw new Exception(
                                    "The suite could not be unpacked to:\n" + target + "\n\n" + ex.Message, ex);
                            }
                        }
                    }
                }

                if (!File.Exists(exe))
                {
                    throw new FileNotFoundException("The suite was not unpacked correctly.", exe);
                }

                ProcessStartInfo start = new ProcessStartInfo(exe);
                start.WorkingDirectory = target;
                foreach (string arg in args)
                {
                    if (start.Arguments.Length > 0)
                    {
                        start.Arguments += " ";
                    }

                    start.Arguments += Quote(arg);
                }

                Process.Start(start);
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString(), "Windows 9x Suite", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static string Hash(Stream payload)
        {
            payload.Position = 0;
            using (SHA1 sha = SHA1.Create())
            {
                return BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "");
            }
        }

        private static void Unpack(Stream payload, string target, string stamp)
        {
            string temp = target + ".new";
            string zip = Path.Combine(Path.GetTempPath(), "win9x-suite-payload.zip");

            if (Directory.Exists(temp))
            {
                Directory.Delete(temp, true);
            }

            payload.Position = 0;
            using (FileStream file = File.Create(zip))
            {
                payload.CopyTo(file);
            }

            Directory.CreateDirectory(temp);
            try
            {
                ZipFile.ExtractToDirectory(zip, temp);
            }
            finally
            {
                File.Delete(zip);
            }

            try
            {
                if (Directory.Exists(target))
                {
                    Directory.Delete(target, true);
                }
            }
            catch (IOException)
            {
                // Files held open by a running copy; keep the new folder for next launch.
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(target));
            Directory.Move(temp, target);
            File.WriteAllText(Path.Combine(target, "payload.stamp"), stamp);
        }

        private static string Quote(string value)
        {
            return value.IndexOf(' ') >= 0 ? "\"" + value + "\"" : value;
        }
    }
}
