@echo off
title Configurar Modo Dev (Link Simbolico / Git Sync) - Premiere Composer FX Studio
color 0B
echo ================================================================
echo   CONFIGURANDO EROS / MODO DEV CEP (LINK DIRETO DO GIT)
echo ================================================================
echo.

:: 1. Ativar PlayerDebugMode no Registro do Windows
echo [1/3] Habilitando PlayerDebugMode no Registro do Windows...
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.14" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.15" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1

:: 2. Verificar/Criar pasta de extensoes CEP
set "CEP_DIR=%APPDATA%\Adobe\CEP\extensions"
if not exist "%CEP_DIR%" mkdir "%CEP_DIR%"

set "TARGET_LINK=%CEP_DIR%\com.composer.fxstudio"

:: 3. Remover pasta/link antigo se existir
echo [2/3] Removendo instalacao antiga ou estatica em: %TARGET_LINK%...
if exist "%TARGET_LINK%" (
    rmdir /S /Q "%TARGET_LINK%" >nul 2>&1
    if exist "%TARGET_LINK%" del /F /Q "%TARGET_LINK%" >nul 2>&1
)

:: 4. Criar Junction Link apontando para a pasta atual (onde esta o Git)
echo [3/3] Criando Link Simbolico (Junction) apontando para a pasta do Git...
mklink /J "%TARGET_LINK%" "%~dp0"

echo.
echo ================================================================
echo   CONFIGURACAO CONCLUIDA COM SUCESSO!
echo ================================================================
echo.
echo Agora a pasta da extensao no Premiere aponta DIRETO para este repositorio Git.
echo Qualquer commit, git pull ou edicao nos arquivos nesta pasta sera refletida
echo INSTANTANEAMENTE no Premiere Pro!
echo.
echo Dica para recarregar a extensao no Premiere sem fechar o programa:
echo - Feche a janela da extensao e reabra em: Janela -^> Extensoes -^> Premiere Composer FX Studio
echo - Ou abra no Chrome: http://localhost:8088 e pressione F5 / location.reload()
echo.
pause
