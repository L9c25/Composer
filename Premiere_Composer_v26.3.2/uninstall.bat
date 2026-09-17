@echo off
title Desinstalar Premiere Composer FX Studio
color 0C
cls
echo ======================================================================
echo            DESINSTALADOR - PREMIERE COMPOSER FX STUDIO
echo ======================================================================
echo.

set "TARGET_DIR=%APPDATA%\Adobe\CEP\extensions\com.composer.fxstudio"

echo Removendo extensao de: %TARGET_DIR%...
if exist "%TARGET_DIR%" (
    rmdir /S /Q "%TARGET_DIR%" >nul 2>&1
    if exist "%TARGET_DIR%" del /F /Q "%TARGET_DIR%" >nul 2>&1
    echo.
    echo ======================================================================
    echo          EXTENSAO DESINSTALADA COM SUCESSO!
    echo ======================================================================
) else (
    echo.
    echo Nenhuma instalacao foi encontrada no diretorio padrao do CEP.
)

echo.
pause
