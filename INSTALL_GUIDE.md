# Guia de Instalação - Premiere Composer FX Studio (Premiere Pro 2025 v25.4.0)

Este guia orienta na instalação e configuração do **Premiere Composer FX Studio** no Adobe Premiere Pro 2025.

---

## ⚡ Método 1: Instalação Automática (Recomendado)

1. Certifique-se de que o **Adobe Premiere Pro está fechado**.
2. Dê um duplo clique no arquivo **`install.bat`** presente nesta pasta.
3. O instalador irá:
   - Configurar as chaves necessárias no Registro do Windows (`PlayerDebugMode = 1`).
   - Copiar a extensão para `%APPDATA%\Adobe\CEP\extensions\com.composer.fxstudio`.
4. Abra o **Adobe Premiere Pro 2025**.
5. No menu superior, vá em **Janela (Window) ➔ Extensões (Extensions) ➔ Premiere Composer FX Studio**.

---

## 🛠️ Método 2: Instalação Manual

Se preferir copiar manualmente:

### Passo 1: Habilitar PlayerDebugMode no Windows
Abra o Prompt de Comando (cmd.exe) como Administrador e execute os seguintes comandos:
```cmd
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d "1" /f
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d "1" /f
reg add "HKCU\Software\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d "1" /f
reg add "HKCU\Software\Adobe\CSXS.14" /v PlayerDebugMode /t REG_SZ /d "1" /f
```

### Passo 2: Copiar os arquivos da extensão
Copie a pasta inteira da extensão para o seguinte caminho:
`C:\Users\<SeuUsuario>\AppData\Roaming\Adobe\CEP\extensions\com.composer.fxstudio`

---

## 🚀 Recursos e Funcionalidades

### 1. Pastas Personalizadas
- Clique em **"+ Adicionar Pasta"** para vincular qualquer pasta do seu HD contendo arquivos de som (`.wav`, `.mp3`, `.m4a`, `.aac`, `.flac`) ou overlays de vídeo (`.mp4`, `.mov`, `.webm`, `.avi`).
- Os arquivos são indexados e salvos em cache automaticamente.

### 2. Max Peak de Áudio (Normalização Automática Persistente)
- Defina o valor alvo do **Max Peak Áudio** no slider ou no campo numérico (ex: `-6.0 dB`, `-3.0 dB`, `0.0 dB`).
- O valor configurado é **salvo em disco (cache)** e **não se perde ao fechar e abrir o Premiere**.
- Ao clicar em **"Inserir"**, o Premiere calcula o ganho necessário ($\Delta = \text{Target} - \text{Native}$) e aplica o ganho ao clipe na timeline!

### 3. Visualização de Waveform e Thumbnails Low-Res
- Áudios geram waveforms de alta qualidade via Web Audio API.
- Overlays geram thumbnails comprimidos de baixa resolução e permitem **Hover Scrubbing** (passar o mouse sobre o card para ver o preview do vídeo em tempo real).
- Todos os dados ficam armazenados no cache (`composer_cache.json`) para carregamento instantâneo em `< 50ms`.

### 4. Cortar Silêncio e Substituir Arquivo Original (Silence Cutter)
- Clique no ícone de **tesoura** ($\small\text{✂️}$) em qualquer card de áudio ou ative o toggle automático.
- O sistema analisa o áudio em tempo real, detecta o silêncio inicial e final, recorta os dados PCM e **substitui o arquivo original no disco** de forma limpa.
- A waveform e a duração no painel são atualizadas instantaneamente!

### 5. Busca Ultra Otimizada
- Digite na barra de busca para filtrar instantaneamente por nome do efeito, extensão ou nome da pasta sem travamentos.
