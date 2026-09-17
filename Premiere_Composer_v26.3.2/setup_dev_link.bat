@echo off
title Modo Desenvolvedor / Link Simbolico - Premiere Composer FX Studio (v26.3.2)
color 0B
cls
echo ======================================================================
echo       CONFIGURACAO MODO DEV (LINK DIRETO) - PREMIERE PRO v26.3.2
echo ======================================================================
echo.

:: 1. Ativar PlayerDebugMode no Registro do Windows
echo [1/3] Habilitando PlayerDebugMode no Registro...
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.14" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.15" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.16" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.17" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1

:: 2. Verificar/Criar pasta de extensoes CEP
set "CEP_DIR=%APPDATA%\Adobe\CEP\extensions"
if not exist "%CEP_DIR%" mkdir "%CEP_DIR%"
set "TARGET_LINK=%CEP_DIR%\com.composer.fxstudio"

:: 3. Remover link/pasta antiga se existir
echo [2/3] Limpando instalacao anterior em: %TARGET_LINK%...
if exist "%TARGET_LINK%" (
    rmdir /S /Q "%TARGET_LINK%" >nul 2>&1
    if exist "%TARGET_LINK%" del /F /Q "%TARGET_LINK%" >nul 2>&1
)

:: 4. Criar Junction Link apontando para esta pasta
echo [3/3] Criando Junction (Link Simbolico) para a pasta atual...
mklink /J "%TARGET_LINK%" "%~dp0"

echo.
echo ======================================================================
echo          VINCULO EM MODO DEV CRIADO COM SUCESSO!
echo ======================================================================
echo.
echo Qualquer edicao feita nos arquivos desta pasta tera efeito
echo IMEDIATO dentro do Adobe Premiere Pro v26.3.2.
echo.
echo Como depurar ou recarregar:
echo   - Feche e reabra o painel em: Janela -^> Extensoes -^> Premiere Composer FX Studio
echo   - Ou acesse via navegador Google Chrome: http://localhost:8088
echo.
echo ======================================================================
pause
