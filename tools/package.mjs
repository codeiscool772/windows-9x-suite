/*
 * Packages the suite two ways:
 *
 *   dist/Win9x Suite <version>/     a folder you can copy and run (the .cmd files work)
 *   dist/Win9x-Suite-<version>.zip  the same folder zipped
 *   dist/Win9x-Suite-<version>.exe  one self-extracting exe: the whole suite is embedded
 *                                   and unpacked to %LOCALAPPDATA%\Win9xSuite\app on first run
 *
 *   node tools/package.mjs        (or: npm run package)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `Win9x Suite ${pkg.version}`;

const distDir = path.join(root, 'dist');
const stage = path.join(distDir, name);
const zipPath = path.join(distDir, `Win9x-Suite-${pkg.version}.zip`);
const singleExe = path.join(distDir, `Win9x-Suite-${pkg.version}.exe`);
const payloadZip = path.join(root, 'shell', 'payload.zip');

const ROOT_FILES = [
  'index.html',
  'launcher.css',
  'launcher.js',
  'Launcher.cmd',
  'Paint.cmd',
  'Notepad.cmd',
  'Calculator.cmd',
  'Minesweeper.cmd',
];
const DIRS = ['apps', 'chrome'];
const BIN_DIR = path.join(root, 'shell', 'bin');
const BIN_FILES = [
  'Win9x.exe',
  'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll',
  'WebView2Loader.dll',
];

const README_TEXT = String.raw`Windows 98 Suite __VERSION__
=============================

A suite of re-created classic Windows applications, each running in its own real window:
Program Manager (the launcher), Paint, Notepad, Calculator and Minesweeper.

HOW TO RUN
----------
Double-click Launcher.cmd to open Program Manager and pick an app, or start one directly:

    Paint.cmd       Notepad.cmd       Calculator.cmd       Minesweeper.cmd

The same thing from a prompt (or a shortcut):

    shell\bin\Win9x.exe            the launcher
    shell\bin\Win9x.exe notepad    any of: paint, notepad, calc, minesweeper

If you have the single-file Win9x-Suite-__VERSION__.exe, that is all you need: it unpacks
this same folder to %LOCALAPPDATA%\Win9xSuite\app on first run and starts from there.

Nothing is installed. A single exe can be moved anywhere (a USB stick works); to remove the
suite, delete this folder and %LOCALAPPDATA%\Win9xSuite.

REQUIREMENTS
------------
- Windows 10 or 11, 64-bit.
- Microsoft Edge WebView2 runtime, which ships with Windows 11 and with Edge on Windows 10.
  If a window says it could not start its rendering engine, install it from:
  https://developer.microsoft.com/microsoft-edge/webview2/

NOTES
-----
- The Windows 95 title bar you see is the real window frame: drag it, and the minimise /
  maximise / close buttons are the real ones.
- Paint and Notepad open, save and print real files.
- Minesweeper keeps its best times per level, and Notepad keeps its font and word-wrap
  setting, in %LOCALAPPDATA%\Win9xSuite.
- Two copies of the same app cannot run at once; the launcher plus different apps can.

WHAT IS IN HERE
---------------
    index.html, launcher.*   Program Manager
    apps\paint               Paint (Windows 95)
    apps\notepad             Notepad (Windows 98)
    apps\calc                Calculator (Windows 98, standard view)
    apps\minesweeper         Minesweeper (Windows 98)
    chrome\                  shared Win95 chrome: styles, menu bar, dialogs, window glue
    shell\bin\Win9x.exe      the native host for every app
`;

function readme() {
  return README_TEXT.replace(/__VERSION__/g, pkg.version);
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

/* ---------- checks ---------- */

const missing = BIN_FILES.filter((file) => !fs.existsSync(path.join(BIN_DIR, file)));
if (missing.length) {
  console.error('missing from shell/bin: ' + missing.join(', '));
  console.error('build it first: bash shell/build.sh');
  process.exit(1);
}

const missingFiles = ROOT_FILES.filter((file) => !fs.existsSync(path.join(root, file)));
const missingDirs = DIRS.filter((dir) => !fs.existsSync(path.join(root, dir)));
if (missingFiles.length || missingDirs.length) {
  console.error('missing from the suite: ' + missingFiles.concat(missingDirs).join(', '));
  process.exit(1);
}

/* ---------- stage the runnable folder ---------- */

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.rmSync(singleExe, { force: true });
fs.mkdirSync(path.join(stage, 'shell', 'bin'), { recursive: true });

for (const file of ROOT_FILES) {
  fs.copyFileSync(path.join(root, file), path.join(stage, file));
}
for (const dir of DIRS) {
  fs.cpSync(path.join(root, dir), path.join(stage, dir), { recursive: true });
}
for (const file of BIN_FILES) {
  fs.copyFileSync(path.join(BIN_DIR, file), path.join(stage, 'shell', 'bin', file));
}
fs.writeFileSync(path.join(stage, 'README.txt'), readme(), 'utf8');

/* ---------- zips ---------- */

// ZipFile rather than tar: GNU tar reads "D:\..." as a remote host, and ZipFile writes
// forward-slashed entries, which is exactly what the bootstrapper extracts.
function zipDir(source, destination, includeBase) {
  const script =
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;' +
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${source}', '${destination}', ` +
    `[System.IO.Compression.CompressionLevel]::Optimal, $${includeBase ? 'true' : 'false'})`;
  execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
}

zipDir(stage, zipPath, true);

/* ---------- single exe ---------- */

fs.rmSync(payloadZip, { force: true });
zipDir(stage, payloadZip, false);

const FW = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const csc = path.join(FW, 'csc.exe');
if (!fs.existsSync(csc)) {
  console.error('\nno .NET Framework compiler at ' + csc + ' - skipped the single exe');
  process.exit(1);
}

execFileSync(
  csc,
  [
    '-nologo',
    '-target:winexe',
    '-platform:x64',
    '-optimize+',
    '-out:' + singleExe,
    '-r:' + path.join(FW, 'System.dll'),
    '-r:' + path.join(FW, 'System.Windows.Forms.dll'),
    '-r:' + path.join(FW, 'System.IO.Compression.dll'),
    '-r:' + path.join(FW, 'System.IO.Compression.FileSystem.dll'),
    '-resource:' + payloadZip + ',Payload.zip',
    path.join(root, 'shell', 'Boot.cs'),
  ],
  { stdio: 'inherit' }
);
fs.rmSync(payloadZip, { force: true });

/* ---------- report ---------- */

function measure(dir) {
  let bytes = 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = measure(full);
      bytes += sub.bytes;
      count += sub.count;
    } else {
      bytes += fs.statSync(full).size;
      count++;
    }
  }
  return { bytes, count };
}

const staged = measure(stage);
console.log(`\nfolder   dist/${name}/  (${staged.count} files, ${kb(staged.bytes)})`);
console.log(`zip      dist/${path.basename(zipPath)}  (${kb(fs.statSync(zipPath).size)})`);
console.log(`single   dist/${path.basename(singleExe)}  (${kb(fs.statSync(singleExe).size)})`);
console.log(`\nrun it:  dist/${path.basename(singleExe)}`);
