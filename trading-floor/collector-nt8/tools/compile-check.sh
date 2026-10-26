#!/usr/bin/env bash
# Compila o coletor contra os stubs (Mono/mcs) e verifica que nenhuma API de ordem é usada.
# A compilação definitiva é no NinjaTrader 8 (Windows). Ver docs/NINJATRADER.md.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../BlackWolfFloorCollector.cs"
robot="$here/../BlackWolfFloorRobotEvents.cs"
out="$here/build"
mkdir -p "$out"

# 1) Somente leitura: nenhuma chamada que cria/envia/altera/cancela/fecha ordens.
if grep -nE '\.(Submit|Cancel|CancelAllOrders|Change|Flatten|CreateOrder)\s*\(' "$src" "$robot"; then
  echo "ERRO: o coletor usa API de ordens (deve ser somente leitura)" >&2
  exit 1
fi
echo "✓ nenhuma API de envio/alteração/cancelamento de ordens"

command -v mcs >/dev/null || { echo "mcs (Mono) não encontrado; pulei a compilação"; exit 0; }
mcs -nologo -langversion:7 -target:library -out:"$out/collector.dll" -r:System.dll -r:System.Core.dll "$here/NinjaTraderStubs.cs" "$src" "$robot"
echo "✓ compila (C# 7, .NET Framework) contra os stubs"
mcs -nologo -langversion:7 -out:"$out/harness.exe" -r:System.dll -r:System.Core.dll "$here/NinjaTraderStubs.cs" "$src" "$here/Harness.cs"
mcs -nologo -langversion:7 -out:"$out/robot-harness.exe" -r:System.dll -r:System.Core.dll "$robot" "$here/RobotHarness.cs"
echo "✓ harness compilados: $out/harness.exe, $out/robot-harness.exe"
