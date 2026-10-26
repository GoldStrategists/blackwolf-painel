@echo off
title Black Wolf Trading Floor
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao 22 em https://nodejs.org e rode este arquivo de novo.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias - so na primeira vez, leva alguns minutos...
  call npm install || goto :erro
)
if not exist web\dist\index.html (
  echo Preparando a interface...
  call npm run build || goto :erro
)
echo.
echo Abrindo http://127.0.0.1:4100 no navegador. Para fechar a sala, feche esta janela.
start "" cmd /c "timeout /t 6 >nul & start http://127.0.0.1:4100"
call npm start
goto :eof
:erro
echo Algo deu errado. Copie as mensagens acima e envie para o suporte.
pause
