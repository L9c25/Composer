/**
 * Premiere Composer FX Studio - Main Application Controller
 * Handles Folder Scanning, Ultra-Fast Search Engine, UI State,
 * CSInterface Bridge to Premiere Pro 2025, Audio Max Peak persistence,
 * and Cut Silence file overwrite trigger.
 */

class ComposerApp {
    constructor() {
        this.csInterface = new CSInterface();
        this.allAssets = [];        // Scanned assets list
        this.filteredAssets = [];   // Search & filter result
        this.currentFilter = 'all'; // all, sfx, overlay, favorites
        this.searchQuery = '';
        this.isScanning = false;
        
        this.activePlayingAsset = null;

        this.initUI();
        this.bindEvents();
        this.loadInitialFolders();
    }

    initUI() {
        // Load saved Max Peak Target setting (Default -6.0 dB)
        var savedMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
        var slider = document.getElementById('slider-max-peak');
        var input = document.getElementById('input-max-peak');
        if (slider) slider.value = savedMaxPeak;
        if (input) input.value = savedMaxPeak;

        // Load Cut Silence settings
        var autoCut = window.cacheMgr.getSetting('autoCutSilence', false);
        var toggleCut = document.getElementById('toggle-auto-cut');
        if (toggleCut) toggleCut.checked = autoCut;

        var silenceThresh = window.cacheMgr.getSetting('silenceThresholdDb', -45.0);
        var inputThresh = document.getElementById('input-silence-thresh');
        if (inputThresh) inputThresh.value = silenceThresh;

        this.renderFoldersList();
    }

    bindEvents() {
        // Search bar debounced input
        var searchInput = document.getElementById('search-input');
        if (searchInput) {
            var searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.searchQuery = e.target.value.toLowerCase().trim();
                    this.applyFiltersAndRender();
                }, 120);
            });
        }

        // Navigation Tabs (All, SFX, Overlays, Favorites)
        var tabBtns = document.querySelectorAll('.nav-item[data-filter]');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                tabBtns.forEach(b => b.classList.remove('active'));
                var target = e.currentTarget;
                target.classList.add('active');
                this.currentFilter = target.getAttribute('data-filter');
                this.applyFiltersAndRender();
            });
        });

        // Add Folder Button
        var addFolderBtn = document.getElementById('btn-add-folder');
        if (addFolderBtn) {
            addFolderBtn.addEventListener('click', () => this.promptAddFolder());
        }

        // Max Peak Slider & Input Sync
        var slider = document.getElementById('slider-max-peak');
        var input = document.getElementById('input-max-peak');

        if (slider && input) {
            slider.addEventListener('input', (e) => {
                var val = parseFloat(e.target.value).toFixed(1);
                input.value = val;
                window.cacheMgr.setSetting('targetMaxPeakDb', parseFloat(val));
            });

            input.addEventListener('change', (e) => {
                var val = parseFloat(e.target.value);
                if (isNaN(val)) val = -6.0;
                val = Math.max(-36.0, Math.min(0.0, val));
                input.value = val.toFixed(1);
                slider.value = val;
                window.cacheMgr.setSetting('targetMaxPeakDb', parseFloat(val));
            });
        }

        // Cut Silence Toggle & Threshold
        var toggleCut = document.getElementById('toggle-auto-cut');
        if (toggleCut) {
            toggleCut.addEventListener('change', (e) => {
                window.cacheMgr.setSetting('autoCutSilence', e.target.checked);
            });
        }

        var inputThresh = document.getElementById('input-silence-thresh');
        if (inputThresh) {
            inputThresh.addEventListener('change', (e) => {
                var val = parseFloat(e.target.value);
                if (isNaN(val)) val = -45.0;
                inputThresh.value = val;
                window.cacheMgr.setSetting('silenceThresholdDb', val);
            });
        }

        // Global Audio Stop Button in Player
        var btnPlayMain = document.getElementById('btn-play-main');
        if (btnPlayMain) {
            btnPlayMain.addEventListener('click', () => {
                if (window.audioEngine.currentSound) {
                    window.audioEngine.stopAudioPreview();
                    btnPlayMain.innerHTML = '<i class="fas fa-play"></i>';
                }
            });
        }
    }

    /**
     * Folder Selection via File Dialog / Node fs
     */
    promptAddFolder() {
        if (typeof require !== 'undefined') {
            try {
                // Electron / CEP dialog via input or node dialog
                var input = document.createElement('input');
                input.type = 'file';
                input.webkitdirectory = true;
                input.onchange = (e) => {
                    if (e.target.files.length > 0) {
                        var folderPath = e.target.files[0].path;
                        if (folderPath) {
                            var parentFolder = require('path').dirname(folderPath);
                            this.addFolderAndScan(parentFolder || folderPath);
                        }
                    }
                };
                input.click();
                return;
            } catch (err) {}
        }
        
        // Manual prompt fallback
        var folder = prompt("Digite o caminho completo da pasta de efeitos (ex: C:\\Audios\\SFX):");
        if (folder && folder.trim()) {
            this.addFolderAndScan(folder.trim());
        }
    }

    addFolderAndScan(folderPath) {
        if (window.cacheMgr.addFolder(folderPath)) {
            this.renderFoldersList();
            this.rescanAllFolders();
        }
    }

    removeFolder(folderPath) {
        window.cacheMgr.removeFolder(folderPath);
        this.renderFoldersList();
        this.rescanAllFolders();
    }

    renderFoldersList() {
        var container = document.getElementById('folder-list');
        if (!container) return;

        var folders = window.cacheMgr.getFolders();
        if (folders.length === 0) {
            container.innerHTML = `<div style="font-size:11px; color:var(--text-dim); padding:6px;">Nenhuma pasta adicionada.</div>`;
            return;
        }

        container.innerHTML = folders.map(f => {
            var folderName = typeof require !== 'undefined' ? require('path').basename(f) : f.split(/[\/\\]/).pop();
            return `
                <div class="folder-item" title="${f}">
                    <span><i class="far fa-folder" style="color:var(--accent-emerald); margin-right:6px;"></i>${folderName}</span>
                    <i class="fas fa-times folder-remove" data-folder="${encodeURIComponent(f)}"></i>
                </div>
            `;
        }).join('');

        // Bind folder remove events
        container.querySelectorAll('.folder-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                var fPath = decodeURIComponent(e.target.getAttribute('data-folder'));
                this.removeFolder(fPath);
            });
        });
    }

    loadInitialFolders() {
        var folders = window.cacheMgr.getFolders();
        if (folders.length > 0) {
            this.rescanAllFolders();
        } else {
            this.renderAssetGrid([]);
        }
    }

    /**
     * Recursive Folder Scanning Engine (Node.js fs)
     */
    async rescanAllFolders() {
        if (typeof require === 'undefined') {
            console.warn("Folder scanning requires CEP Node.js environment.");
            return;
        }

        var fs = require('fs');
        var path = require('path');
        var folders = window.cacheMgr.getFolders();
        
        var audioExts = ['.wav', '.mp3', '.m4a', '.aac', '.flac'];
        var videoExts = ['.mp4', '.mov', '.webm', '.avi'];

        var foundAssets = [];

        var scanRecursive = (dirPath) => {
            try {
                var entries = fs.readdirSync(dirPath, { withFileTypes: true });
                for (var entry of entries) {
                    var fullPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        scanRecursive(fullPath);
                    } else if (entry.isFile()) {
                        var ext = path.extname(entry.name).toLowerCase();
                        var stats = fs.statSync(fullPath);
                        
                        if (audioExts.includes(ext)) {
                            foundAssets.push({
                                type: 'sfx',
                                path: fullPath,
                                name: entry.name,
                                ext: ext,
                                mtime: stats.mtimeMs,
                                size: stats.size
                            });
                        } else if (videoExts.includes(ext)) {
                            foundAssets.push({
                                type: 'overlay',
                                path: fullPath,
                                name: entry.name,
                                ext: ext,
                                mtime: stats.mtimeMs,
                                size: stats.size
                            });
                        }
                    }
                }
            } catch (err) {
                console.error("Scan error on path:", dirPath, err);
            }
        };

        for (var folder of folders) {
            if (fs.existsSync(folder)) {
                scanRecursive(folder);
            }
        }

        this.allAssets = foundAssets;
        
        // Update nav badge count
        var badgeAll = document.getElementById('badge-count-all');
        if (badgeAll) badgeAll.textContent = this.allAssets.length;

        this.applyFiltersAndRender();
    }

    /**
     * Ultra-Fast Filter Engine
     */
    applyFiltersAndRender() {
        var query = this.searchQuery;
        var filter = this.currentFilter;

        this.filteredAssets = this.allAssets.filter(asset => {
            // Type filter
            if (filter === 'sfx' && asset.type !== 'sfx') return false;
            if (filter === 'overlay' && asset.type !== 'overlay') return false;
            if (filter === 'favorites' && !window.cacheMgr.isFavorite(asset.path)) return false;

            // Query search
            if (query) {
                var matchName = asset.name.toLowerCase().includes(query);
                var matchPath = asset.path.toLowerCase().includes(query);
                if (!matchName && !matchPath) return false;
            }

            return true;
        });

        this.renderAssetGrid(this.filteredAssets);
    }

    /**
     * Render Asset Grid Cards
     */
    renderAssetGrid(assets) {
        var grid = document.getElementById('grid-assets');
        if (!grid) return;

        if (assets.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="fas fa-folder-open empty-icon"></i>
                    <h3>Nenhum efeito ou overlay encontrado</h3>
                    <p>Adicione pastas com seus arquivos de áudio (.wav, .mp3) ou vídeos (.mp4, .mov).</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = assets.map((asset, idx) => {
            var isFav = window.cacheMgr.isFavorite(asset.path);
            var isAudio = asset.type === 'sfx';

            return `
                <div class="asset-card" data-index="${idx}" data-path="${encodeURIComponent(asset.path)}">
                    <div class="card-top">
                        <span class="card-title" title="${asset.name}">${asset.name}</span>
                        <span class="card-badge ${isAudio ? 'badge-sfx' : 'badge-overlay'}">${isAudio ? 'SFX' : 'OVERLAY'}</span>
                    </div>

                    <div class="card-preview-box">
                        ${isAudio ? 
                            `<canvas class="waveform-canvas" id="canvas-${idx}"></canvas>` : 
                            `<div class="overlay-preview-container" id="overlay-box-${idx}">
                                <img class="overlay-thumbnail" id="thumb-${idx}" src="" alt="preview" />
                                <video class="overlay-hover-video" style="display:none;" loop muted></video>
                            </div>`
                        }
                    </div>

                    <div class="card-bottom">
                        <div class="card-info-specs">
                            <span class="dur-tag" id="dur-${idx}">--:--</span>
                            ${isAudio ? `<span class="peak-tag" id="peak-${idx}">-.- dB</span>` : ''}
                        </div>

                        <div class="card-actions">
                            <button class="btn-icon btn-fav ${isFav ? 'active' : ''}" title="Favorito">
                                <i class="${isFav ? 'fas' : 'far'} fa-star" style="${isFav ? 'color:#f59e0b' : ''}"></i>
                            </button>
                            
                            ${isAudio ? `
                                <button class="btn-icon btn-cut-silence" title="Cortar Silêncio e Substituir Arquivo" style="color:var(--accent-red);">
                                    <i class="fas fa-scissors"></i>
                                </button>
                                <button class="btn-icon btn-play" title="Ouvir Preview">
                                    <i class="fas fa-play"></i>
                                </button>
                            ` : ''}

                            <button class="btn-insert" title="Inserir na Timeline do Premiere">
                                <i class="fas fa-plus"></i> Inserir
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Bind interactive events and populate cached/async waveforms
        assets.forEach((asset, idx) => {
            var card = grid.children[idx];
            if (!card) return;

            // Favorite Button
            var btnFav = card.querySelector('.btn-fav');
            if (btnFav) {
                btnFav.addEventListener('click', (e) => {
                    e.stopPropagation();
                    var isNowFav = window.cacheMgr.toggleFavorite(asset.path);
                    btnFav.innerHTML = `<i class="${isNowFav ? 'fas' : 'far'} fa-star" style="${isNowFav ? 'color:#f59e0b' : ''}"></i>`;
                });
            }

            // Insert to Timeline Button
            var btnInsert = card.querySelector('.btn-insert');
            if (btnInsert) {
                btnInsert.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.insertToTimeline(asset);
                });
            }

            if (asset.type === 'sfx') {
                // Audio Waveform & Metadata Processing
                var canvas = card.querySelector(`#canvas-${idx}`);
                var durTag = card.querySelector(`#dur-${idx}`);
                var peakTag = card.querySelector(`#peak-${idx}`);
                var btnPlay = card.querySelector('.btn-play');
                var btnCutSilence = card.querySelector('.btn-cut-silence');

                // Load from Cache or Process
                var cached = window.cacheMgr.getAudioCache(asset.path, asset.mtime);
                if (cached) {
                    if (durTag) durTag.textContent = this.formatTime(cached.duration);
                    if (peakTag) peakTag.textContent = `${cached.nativePeakDb} dB`;
                    window.audioEngine.drawWaveform(canvas, cached.waveform, 0, cached.silenceStartSec, cached.silenceEndSec, cached.duration);
                    asset.procData = cached;
                } else {
                    // Process Web Audio in Background
                    window.audioEngine.decodeAudioFile(asset.path).then(audioBuf => {
                        var proc = window.audioEngine.processAudioBuffer(audioBuf);
                        window.cacheMgr.setAudioCache(asset.path, asset.mtime, proc);
                        if (durTag) durTag.textContent = this.formatTime(proc.duration);
                        if (peakTag) peakTag.textContent = `${proc.nativePeakDb} dB`;
                        window.audioEngine.drawWaveform(canvas, proc.waveform, 0, proc.silenceStartSec, proc.silenceEndSec, proc.duration);
                        asset.procData = proc;
                    }).catch(() => {});
                }

                // Play Preview
                if (btnPlay) {
                    btnPlay.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.playAudioPreview(asset, canvas, btnPlay);
                    });
                }

                // CUT SILENCE & OVERWRITE FILE BUTTON
                if (btnCutSilence) {
                    btnCutSilence.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (confirm(`Deseja cortar o silêncio do arquivo "${asset.name}" e substituir o arquivo original no disco?`)) {
                            btnCutSilence.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                            try {
                                var thresh = window.cacheMgr.getSetting('silenceThresholdDb', -45.0);
                                var newProc = await window.audioEngine.cutSilenceAndReplaceFile(asset.path, thresh);
                                
                                asset.mtime = Date.now();
                                asset.procData = newProc;

                                if (durTag) durTag.textContent = this.formatTime(newProc.duration);
                                if (peakTag) peakTag.textContent = `${newProc.nativePeakDb} dB`;
                                window.audioEngine.drawWaveform(canvas, newProc.waveform, 0, newProc.silenceStartSec, newProc.silenceEndSec, newProc.duration);
                                
                                btnCutSilence.innerHTML = `<i class="fas fa-check" style="color:var(--accent-green-bright);"></i>`;
                                setTimeout(() => { btnCutSilence.innerHTML = `<i class="fas fa-scissors"></i>`; }, 2000);
                            } catch (errCut) {
                                alert("Erro ao cortar silêncio: " + errCut.message);
                                btnCutSilence.innerHTML = `<i class="fas fa-scissors"></i>`;
                            }
                        }
                    });
                }

            } else {
                // Video Overlay Processing
                var thumbImg = card.querySelector(`#thumb-${idx}`);
                var durTagVideo = card.querySelector(`#dur-${idx}`);
                
                var cachedOverlay = window.cacheMgr.getOverlayCache(asset.path, asset.mtime);
                if (cachedOverlay) {
                    if (thumbImg) thumbImg.src = cachedOverlay.thumbnailDataUrl;
                    if (durTagVideo) durTagVideo.textContent = this.formatTime(cachedOverlay.duration);
                } else {
                    window.overlayEngine.generateLowResThumbnail(asset.path).then(info => {
                        if (info) {
                            window.cacheMgr.setOverlayCache(asset.path, asset.mtime, info);
                            if (thumbImg) thumbImg.src = info.thumbnailDataUrl;
                            if (durTagVideo) durTagVideo.textContent = this.formatTime(info.duration);
                        }
                    });
                }

                // Setup Hover Scrubbing
                window.overlayEngine.setupHoverScrub(card, asset.path);
            }
        });
    }

    /**
     * Play Audio Preview in Panel
     */
    playAudioPreview(asset, canvas, btnPlay) {
        var btnMain = document.getElementById('btn-play-main');
        var playerTitle = document.getElementById('player-title');
        
        if (playerTitle) playerTitle.textContent = asset.name;
        if (btnMain) btnMain.innerHTML = `<i class="fas fa-stop"></i>`;
        btnPlay.innerHTML = `<i class="fas fa-stop"></i>`;

        window.audioEngine.playAudioPreview(asset.path, (pct, elapsed, duration) => {
            if (canvas && asset.procData) {
                window.audioEngine.drawWaveform(canvas, asset.procData.waveform, pct, asset.procData.silenceStartSec, asset.procData.silenceEndSec, duration);
            }
        }, () => {
            btnPlay.innerHTML = `<i class="fas fa-play"></i>`;
            if (btnMain) btnMain.innerHTML = `<i class="fas fa-play"></i>`;
            if (canvas && asset.procData) {
                window.audioEngine.drawWaveform(canvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
            }
        });
    }

    /**
     * 1-Click Timeline Insertion via ExtendScript Bridge
     */
    insertToTimeline(asset) {
        var targetMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
        var nativePeak = (asset.procData && asset.procData.nativePeakDb) ? asset.procData.nativePeakDb : 0;

        var scriptCall = `ComposerHost.importAndInsertAsset("${asset.path.replace(/\\/g, '\\\\')}", "${asset.type}", ${targetMaxPeak}, ${nativePeak})`;
        
        this.csInterface.evalScript(scriptCall, (resultStr) => {
            try {
                var res = JSON.parse(resultStr);
                if (res.success) {
                    this.showNotification("✨ " + res.message);
                } else {
                    alert("Aviso Premiere: " + res.error);
                }
            } catch (e) {
                console.log("Response from Premiere:", resultStr);
            }
        });
    }

    showNotification(msg) {
        var notif = document.getElementById('toast-notification');
        if (!notif) return;
        notif.textContent = msg;
        notif.classList.add('show');
        setTimeout(() => notif.classList.remove('show'), 3000);
    }

    formatTime(sec) {
        if (!sec || isNaN(sec)) return "00:00";
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}

// Instantiate on DOM Loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ComposerApp();
});
