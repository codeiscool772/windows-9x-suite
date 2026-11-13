#!/usr/bin/env bash
# Builds Win9x.exe with the .NET Framework compiler that ships with Windows (no .NET SDK
# needed). The WebView2 managed DLLs are pulled once from NuGet and kept in shell/lib; the
# WebView2 runtime itself is already part of Windows 11.
set -e
cd "$(dirname "$0")"

FW="/c/Windows/Microsoft.NET/Framework64/v4.0.30319"
CSC="$FW/csc.exe"
[ -x "$CSC" ] || { echo "no .NET Framework compiler at $CSC" >&2; exit 1; }

mkdir -p lib bin

if [ -z "$(find lib -name 'Microsoft.Web.WebView2.Core.dll' -print -quit 2>/dev/null)" ]; then
  echo "fetching Microsoft.Web.WebView2 from nuget..."
  V=$(node -e "fetch('https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json').then(r=>r.json()).then(j=>{const v=j.versions.filter(x=>x.indexOf('-')<0);process.stdout.write(v[v.length-1])})")
  echo "  version $V"
  tmp=$(mktemp -d)
  curl -sL -o "$tmp/wv2.nupkg" "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$V/microsoft.web.webview2.$V.nupkg"
  mkdir -p "$tmp/x"
  if ! (cd "$tmp/x" && tar -xf ../wv2.nupkg 2>/dev/null); then
    cp "$tmp/wv2.nupkg" "$tmp/wv2.zip"
    powershell -NoProfile -Command "Expand-Archive -Force -Path '$(cygpath -w "$tmp/wv2.zip")' -DestinationPath '$(cygpath -w "$tmp/x")'"
  fi
  cp -r "$tmp/x/lib/." lib/
  mkdir -p lib/native
  cp "$(find "$tmp/x/runtimes" -name WebView2Loader.dll -path '*win-x64*' | head -1)" lib/native/
  echo "$V" > lib/VERSION.txt
  rm -rf "$tmp"
fi

CORE=$(find lib -name 'Microsoft.Web.WebView2.Core.dll' | sort | head -1)
SETTINGS=$(dirname "$CORE")
WINS=$(find "$SETTINGS" -name 'Microsoft.Web.WebView2.WinForms.dll' | head -1)
echo "using $SETTINGS"

# -style options and no argument conversion: Git Bash rewrites /switch paths otherwise
MSYS2_ARG_CONV_EXCL='*' "$CSC" -nologo -target:winexe -platform:x64 -optimize+ \
  -out:"$(cygpath -w "$(pwd)/bin/Win9x.exe")" \
  -r:"$(cygpath -w "$FW/System.dll")" \
  -r:"$(cygpath -w "$FW/System.Drawing.dll")" \
  -r:"$(cygpath -w "$FW/System.Windows.Forms.dll")" \
  -r:"$(cygpath -w "$FW/System.Web.Extensions.dll")" \
  -r:"$(cygpath -w "$(pwd)/$CORE")" \
  -r:"$(cygpath -w "$(pwd)/$WINS")" \
  -win32manifest:app.manifest \
  Win9xWindow.cs

cp "$(dirname "$CORE")"/*.dll bin/
cp lib/native/WebView2Loader.dll bin/
echo "built shell/bin/Win9x.exe"
