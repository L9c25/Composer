@echo off
title Instalação Premiere Composer FX Studio (Premiere Pro 2025)
color 0A
echo ================================================================
echo   INSTALADOR DO PREMIERE COMPOSER FX STUDIO (VERSION 25.4.0)
echo ================================================================
echo.

:: 1. Ativar PlayerDebugMode no Registro do Windows para CEP 11, 12, 13 e 14
echo [1/3] Habilitando modo de depuracao CEP no Registro do Windows...
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.14" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1

:: 2. Criar pasta de extensoes CEP se nao existir
set "TARGET_DIR=%APPDATA%\Adobe\CEP\extensions\com.composer.fxstudio"
echo [2/3] Criando pasta de destino: %TARGET_DIR%...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

:: 3. Copiar arquivos da extensao
echo [3/3] Copiando arquivos da extensao...
xcopy "%~dp0*" "%TARGET_DIR%\" /E /Y /I /Q >nul

echo.
echo ================================================================
echo   INSTALACAO CONCLUIDA COM SUCESSO!
echo ================================================================
echo.
echo Para abrir a extensao no Premiere Pro 2025:
echo 1. Inicie ou reinicie o Adobe Premiere Pro 2025.
echo 2. Va no menu: Janela (Window) -^> Extensoes -^> Premiere Composer FX Studio.
echo.
pause
