@echo off
title Instalador Premiere Composer FX Studio (Premiere Pro v26.3.2)
color 0A
cls
echo ======================================================================
echo       PREMIERE COMPOSER FX STUDIO - INSTALADOR OFICIAL
echo                  Compativel com Premiere Pro v26.3.2
echo ======================================================================
echo.

:: 1. Ativar PlayerDebugMode no Registro do Windows para todas as versoes CEP/CSXS (11 ate 17)
echo [1/3] Configurando Registro do Windows (PlayerDebugMode)...
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.14" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.15" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.16" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.17" /v PlayerDebugMode /t REG_SZ /d "1" /f >nul 2>&1

:: 2. Definir e preparar pasta de extensoes CEP
set "TARGET_DIR=%APPDATA%\Adobe\CEP\extensions\com.composer.fxstudio"
echo [2/3] Preparando pasta de destino CEP:
echo       %TARGET_DIR%
if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"
if exist "%TARGET_DIR%" rmdir /S /Q "%TARGET_DIR%" >nul 2>&1
mkdir "%TARGET_DIR%"

:: 3. Copiar arquivos da extensao
echo [3/3] Instalando e copiando arquivos da versao 26.3.2...
xcopy "%~dp0*" "%TARGET_DIR%\" /E /Y /I /Q >nul

echo.
echo ======================================================================
echo       INSTALACAO CONCLUIDA COM SUCESSO PARA PREMIERE PRO v26.3.2!
echo ======================================================================
echo.
echo Como abrir a extensao no Premiere Pro:
echo   1. Abra ou reinicie o Adobe Premiere Pro v26.3.2.
echo   2. No menu superior, clique em:
echo      Janela (Window) -^> Extensoes (Extensions) -^> Premiere Composer FX Studio
echo.
echo ======================================================================
pause
