# Guia de Instalação - Premiere Composer FX Studio (Premiere Pro v26.3.2)

Este guia detalha o processo de instalação e configuração do **Premiere Composer FX Studio** otimizado para o **Adobe Premiere Pro versão 26.3.2 (Premiere 2026)** e compatível com as versões recentes do Premiere Pro.

---

## ⚡ Método 1: Instalação Automática (Recomendado - 1 Clique)

1. **Feche o Adobe Premiere Pro** caso esteja aberto.
2. Dê um duplo clique no arquivo **`install.bat`** nesta pasta.
3. O script executará automaticamente:
   - A habilitação do modo de depuração CEP (`PlayerDebugMode = 1`) no Registro do Windows para as versões do CSXS (11 até 17).
   - A criação e cópia limpa de todos os arquivos da extensão para a pasta do Premiere:
     `%APPDATA%\Adobe\CEP\extensions\com.composer.fxstudio`
4. Abra o **Adobe Premiere Pro v26.3.2**.
5. No menu superior, navegue até:
   **Janela (Window) ➔ Extensões (Extensions) ➔ Premiere Composer FX Studio**.

---

## 🛠️ Método 2: Modo Desenvolvedor (Live Link / Junction)

Se você estiver desenvolvendo ou alterando arquivos e quiser que as modificações apareçam imediatamente no Premiere sem precisar reinstalar:

1. Dê um duplo clique em **`setup_dev_link.bat`**.
2. Ele criará um link simbólico (Junction) apontando a pasta de extensões do Premiere diretamente para esta pasta de projeto.
3. Para recarregar o painel aberto: basta fechar e reabrir o painel ou acessar via Chrome em `http://localhost:8088` e pressionar F5.

---

## 🗑️ Desinstalação

Para remover a extensão do seu computador a qualquer momento, execute o script **`uninstall.bat`**.

---

## 🚀 Principais Recursos do Composer FX Studio v26.3.2

### 1. Sistema de Pastas Locais Ilimitadas
- Clique em **"+ Adicionar Pasta"** para carregar pastas com efeitos sonoros (`.wav`, `.mp3`, `.m4a`, `.aac`, `.flac`) ou overlays de vídeo (`.mp4`, `.mov`, `.webm`, `.avi`).
- Indexação recursiva ultra rápida com subpastas organizadas em árvore.

### 2. Normalização Max Peak de Áudio em Tempo Real
- Defina o limite de pico desejado (ex: `-6.0 dB`, `-3.0 dB`, `0.0 dB`).
- O valor fica salvo em disco persistente e é aplicado automaticamente ao inserir o áudio na timeline.

### 3. Waveform e Hover Scrubbing de Vídeo
- Geração instantânea de forma de onda sonora de alta resolução.
- Hover Scrubbing em cartões de vídeo (passe o cursor sobre o card para pré-visualizar a animação/vídeo em tempo real).

### 4. Silence Cutter (Removedor de Silêncio PCM)
- Detecta e corta silêncio inicial e final de qualquer arquivo de áudio com precisão milimétrica.
- Atualização instantânea da waveform e substituição limpa do arquivo em disco.

### 5. Inserção Inteligente na Timeline
- Insere clips na posição do cursor CTI respeitando faixas livres e criando novas trilhas de áudio/vídeo automaticamente se necessário.
