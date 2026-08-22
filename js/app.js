/**
 * Premiere Composer FX Studio - Main Application Controller
 * High-Performance Async Folder Scanning, Progress Bar, Cache Engine,
 * View Modes (Grid, List, Folder Tree), Interactive Sidebar Explorer, and Premiere Bridge.
 */

class ComposerApp {
    constructor() {
        this.csInterface = new CSInterface();
        this.allAssets = [];        // Complete scanned assets list
        this.filteredAssets = [];   // Search & filter results
        this.currentFilter = 'all'; // all, sfx, overlay, favorites
        this.viewMode = 'folder';   // Default to Folder Navigation View ("Navegar por Pastas")
        this.currentFolderNav = null; // null = Root, or string path for main folder view
        this.selectedSidebarFolder = null; // Selected folder path in sidebar tree
        this.expandedSidebarNodes = new Set(); // Set of expanded folder paths in sidebar
        this.searchQuery = '';
        this.isScanning = false;
        
        this.pageSize = 60;
        this.renderedCount = 60;
        this.activePlayingAsset = null;
        this.selectedAsset = null;
        this.pitchSemitones = 0;
        this.isReverse = false;

        this.initUI();
        this.setupPlayerScrubber();
        this.bindEvents();
        this.bindSidebarCollapsibles();
        this.loadInitialFolders();
    }

    initUI() {
        // Restore Sidebar Collapsed state preference
        var isSidebarCollapsed = window.cacheMgr.getSetting('sidebarCollapsed', false);
        if (isSidebarCollapsed) {
            this.setSidebarCollapsed(true);
        }

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

        // Bind Footer Pitch & Reverse Controls
        var sliderPitch = document.getElementById('slider-pitch');
        var valPitch = document.getElementById('val-pitch');
        var btnResetPitch = document.getElementById('btn-reset-pitch');
        var chkReverse = document.getElementById('chk-reverse');

        if (sliderPitch && valPitch) {
            sliderPitch.addEventListener('input', (e) => {
                this.pitchSemitones = parseInt(e.target.value, 10) || 0;
                valPitch.textContent = this.pitchSemitones > 0 ? `+${this.pitchSemitones}` : `${this.pitchSemitones}`;
                if (this.selectedAsset && window.audioEngine.state === 'playing') {
                    this.playAudioPreview(this.selectedAsset, null, null, window.audioEngine.getPlaybackInfo().percent);
                }
            });
        }

        if (btnResetPitch) {
            btnResetPitch.addEventListener('click', () => {
                this.pitchSemitones = 0;
                if (sliderPitch) sliderPitch.value = 0;
                if (valPitch) valPitch.textContent = "0";
                if (this.selectedAsset && window.audioEngine.state === 'playing') {
                    this.playAudioPreview(this.selectedAsset, null, null, window.audioEngine.getPlaybackInfo().percent);
                }
            });
        }

        if (chkReverse) {
            chkReverse.addEventListener('change', (e) => {
                this.isReverse = e.target.checked;
                if (this.selectedAsset && window.audioEngine.state === 'playing') {
                    this.playAudioPreview(this.selectedAsset, null, null, 0);
                }
            });
        }

        // Keyboard Shortcuts (Space: Play/Pause, Up/Down: Navigate Items, Enter: Insert to Timeline)
        window.addEventListener('keydown', (e) => {
            var activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            if (activeTag === 'input' || activeTag === 'textarea') {
                return;
            }

            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                this.togglePlayPause();
            } else if (e.key === 'ArrowUp' || e.code === 'ArrowUp') {
                e.preventDefault();
                this.navigateByArrow(-1);
            } else if (e.key === 'ArrowDown' || e.code === 'ArrowDown') {
                e.preventDefault();
                this.navigateByArrow(1);
            } else if (e.key === 'Enter' || e.code === 'Enter') {
                if (this.selectedAsset) {
                    e.preventDefault();
                    this.insertToTimeline(this.selectedAsset);
                }
            }
        });

        this.renderFoldersList();
    }

    /**
     * Navigate up or down in the current view using Arrow Keys
     */
    navigateByArrow(direction) {
        var container = document.getElementById('grid-assets');
        if (!container) return;

        // Find all visible selectable file rows in the DOM
        var visibleFileRows = Array.from(container.querySelectorAll('.composer-tree-row.file-row, .asset-list-row:not(.folder-list-row), .asset-card'));
        if (visibleFileRows.length === 0) return;

        // Find current selected index
        var currentIndex = -1;
        if (this.selectedAsset) {
            var selPathNorm = this.selectedAsset.path.replace(/\\/g, '/').toLowerCase();
            currentIndex = visibleFileRows.findIndex(row => {
                var p = row.getAttribute('data-file-path') || row.getAttribute('data-path');
                if (p) {
                    var decoded = decodeURIComponent(p).replace(/\\/g, '/').toLowerCase();
                    return decoded === selPathNorm;
                }
                return false;
            });
        }

        var newIndex = currentIndex + direction;
        if (newIndex < 0) newIndex = 0;
        if (newIndex >= visibleFileRows.length) newIndex = visibleFileRows.length - 1;

        if (newIndex === currentIndex && currentIndex !== -1) return;

        var targetRow = visibleFileRows[newIndex];
        if (!targetRow) return;

        var rawPath = targetRow.getAttribute('data-file-path') || targetRow.getAttribute('data-path');
        if (!rawPath) return;

        var targetPath = decodeURIComponent(rawPath);
        var targetAsset = this.allAssets.find(a => a.path === targetPath);
        if (!targetAsset) return;

        // Highlight new row
        visibleFileRows.forEach(r => r.classList.remove('selected'));
        targetRow.classList.add('selected');

        // Smoothly scroll target row into view
        targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

        // Select and draw asset in bottom player
        this.selectedAsset = targetAsset;
        this.selectAndDrawPlayerAsset(targetAsset);

        // Autoplay preview on arrow navigate if it's audio
        if (targetAsset.type === 'sfx') {
            this.playAudioPreview(targetAsset, null, null, 0);
        }
    }

    /**
     * Interactive Scrubber & Needle Control for Waveform Box
     */
    setupPlayerScrubber() {
        var mainCanvas = document.getElementById('player-waveform-canvas');
        var box = document.getElementById('player-waveform-box');
        var tooltip = document.getElementById('waveform-hover-tooltip');
        var timeCurrent = document.getElementById('player-time-current');
        if (!mainCanvas || !box) return;

        var isDragging = false;

        var getPercentFromEvent = (e) => {
            var rect = mainCanvas.getBoundingClientRect();
            var clientX = e.clientX;
            if (clientX === undefined && e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
            }
            var x = clientX - rect.left;
            return Math.max(0, Math.min(0.999, x / rect.width));
        };

        var updateHoverTooltip = (pct, clientX) => {
            if (!this.selectedAsset || this.selectedAsset.type !== 'sfx') {
                if (tooltip) tooltip.classList.remove('visible');
                return;
            }
            var dur = (this.selectedAsset.procData && this.selectedAsset.procData.duration) || 1;
            var hoverSec = pct * dur;
            if (tooltip) {
                tooltip.textContent = this.formatTimePrecise(hoverSec);
                var rect = box.getBoundingClientRect();
                var relX = clientX - rect.left;
                tooltip.style.left = `${Math.max(25, Math.min(rect.width - 25, relX))}px`;
                tooltip.classList.add('visible');
            }
        };

        var handleSeek = (pct) => {
            if (!this.selectedAsset) {
                if (this.allAssets.length > 0) {
                    this.selectedAsset = this.allAssets[0];
                } else {
                    return;
                }
            }
            if (this.selectedAsset.type !== 'sfx') return;

            var dur = (this.selectedAsset.procData && this.selectedAsset.procData.duration) || 1;
            var curSec = pct * dur;
            if (timeCurrent) timeCurrent.textContent = this.formatTimePrecise(curSec);

            if (window.audioEngine.state === 'stopped') {
                this.playAudioPreview(this.selectedAsset, null, null, pct);
            } else {
                window.audioEngine.seekAudioPreview(pct);
                if (this.selectedAsset.procData) {
                    window.audioEngine.drawWaveform(mainCanvas, this.selectedAsset.procData.waveform, pct, this.selectedAsset.procData.silenceStartSec, this.selectedAsset.procData.silenceEndSec, dur);
                }
            }
        };

        mainCanvas.addEventListener('pointerdown', (e) => {
            isDragging = true;
            try { mainCanvas.setPointerCapture(e.pointerId); } catch (errP) {}
            var pct = getPercentFromEvent(e);
            handleSeek(pct);
            updateHoverTooltip(pct, e.clientX);
        });

        mainCanvas.addEventListener('pointermove', (e) => {
            var pct = getPercentFromEvent(e);
            if (isDragging) {
                handleSeek(pct);
            } else {
                var dur = (this.selectedAsset && this.selectedAsset.procData && this.selectedAsset.procData.duration) || 1;
                var currentPct = window.audioEngine.getPlaybackInfo().percent;
                if (this.selectedAsset && this.selectedAsset.procData) {
                    window.audioEngine.drawWaveform(mainCanvas, this.selectedAsset.procData.waveform, currentPct, this.selectedAsset.procData.silenceStartSec, this.selectedAsset.procData.silenceEndSec, dur, pct);
                }
            }
            updateHoverTooltip(pct, e.clientX);
        });

        var endDrag = (e) => {
            if (isDragging) {
                isDragging = false;
                try { mainCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
                var pct = getPercentFromEvent(e);
                handleSeek(pct);
            }
        };

        mainCanvas.addEventListener('pointerup', endDrag);
        mainCanvas.addEventListener('pointercancel', endDrag);

        box.addEventListener('pointerleave', () => {
            if (!isDragging) {
                if (tooltip) tooltip.classList.remove('visible');
                if (this.selectedAsset && this.selectedAsset.procData) {
                    var dur = this.selectedAsset.procData.duration || 1;
                    var currentPct = window.audioEngine.getPlaybackInfo().percent;
                    window.audioEngine.drawWaveform(mainCanvas, this.selectedAsset.procData.waveform, currentPct, this.selectedAsset.procData.silenceStartSec, this.selectedAsset.procData.silenceEndSec, dur, -1);
                }
            }
        });
    }

    bindSidebarCollapsibles() {
        var headerLib = document.getElementById('header-library');
        var sectionLib = document.getElementById('section-library');
        if (headerLib && sectionLib) {
            headerLib.addEventListener('click', () => {
                sectionLib.classList.toggle('collapsed');
            });
        }

        var headerFolders = document.getElementById('header-folders');
        var sectionFolders = document.getElementById('section-folders');
        if (headerFolders && sectionFolders) {
            headerFolders.addEventListener('click', () => {
                sectionFolders.classList.toggle('collapsed');
            });
        }

        // Full Sidebar Collapse / Expand Toggle Buttons
        var btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
        var btnExpandSidebar = document.getElementById('btn-expand-sidebar');

        if (btnToggleSidebar) {
            btnToggleSidebar.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setSidebarCollapsed(true);
            });
        }

        if (btnExpandSidebar) {
            btnExpandSidebar.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setSidebarCollapsed(false);
            });
        }
    }

    setSidebarCollapsed(collapsed) {
        var sidebar = document.getElementById('sidebar');
        var btnExpand = document.getElementById('btn-expand-sidebar');

        if (sidebar) {
            if (collapsed) {
                sidebar.classList.add('collapsed');
                if (btnExpand) btnExpand.style.display = 'flex';
                window.cacheMgr.setSetting('sidebarCollapsed', true);
            } else {
                sidebar.classList.remove('collapsed');
                if (btnExpand) btnExpand.style.display = 'none';
                window.cacheMgr.setSetting('sidebarCollapsed', false);
            }
        }
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

        // Navigation Category Tabs & Top Filter Pills (All, SFX, Overlays, Favorites)
        var filterBtns = document.querySelectorAll('.btn-pill[data-filter], .nav-item[data-filter]');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filterBtns.forEach(b => b.classList.remove('active'));
                var target = e.currentTarget;
                target.classList.add('active');
                this.currentFilter = target.getAttribute('data-filter');
                this.selectedSidebarFolder = null;
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

        var selectMaxPeakPlayer = document.getElementById('select-max-peak-player');
        if (selectMaxPeakPlayer) {
            var savedPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
            selectMaxPeakPlayer.value = parseFloat(savedPeak).toFixed(1);
            selectMaxPeakPlayer.addEventListener('change', (e) => {
                var val = parseFloat(e.target.value);
                window.cacheMgr.setSetting('targetMaxPeakDb', val);
            });
        }

        // Single Global Audio Play/Pause Button in Player
        var btnPlayMain = document.getElementById('btn-play-main');
        if (btnPlayMain && !btnPlayMain._boundPlay) {
            btnPlayMain._boundPlay = true;
            btnPlayMain.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePlayPause();
            });
        }

        // Global + Inserir Button in Player
        var btnInsertMain = document.getElementById('btn-insert-main');
        if (btnInsertMain && !btnInsertMain._boundInsert) {
            btnInsertMain._boundInsert = true;
            btnInsertMain.addEventListener('click', () => {
                var target = this.selectedAsset || (this.filteredAssets.length > 0 ? this.filteredAssets[0] : (this.allAssets.length > 0 ? this.allAssets[0] : null));
                if (target) {
                    this.insertToTimeline(target);
                } else {
                    alert("Nenhum áudio selecionado para inserir.");
                }
            });
        }

        // Infinite Scroll Handler for Large Asset Libraries (+10,000 files)
        var contentBody = document.querySelector('.content-body');
        if (contentBody) {
            contentBody.addEventListener('scroll', () => {
                if (contentBody.scrollTop + contentBody.clientHeight >= contentBody.scrollHeight - 300) {
                    if (this.renderedCount < this.filteredAssets.length) {
                        this.renderedCount += this.pageSize;
                        this.renderCurrentView(true);
                    }
                }
            });
        }
    }

    /**
     * Clean Toggle Play/Pause/Resume
     */
    togglePlayPause() {
        var btnMain = document.getElementById('btn-play-main');
        var targetAsset = this.selectedAsset || (this.filteredAssets.length > 0 ? this.filteredAssets[0] : (this.allAssets.length > 0 ? this.allAssets[0] : null));
        if (!targetAsset || targetAsset.type !== 'sfx') return;

        var state = window.audioEngine.state;
        if (state === 'playing') {
            window.audioEngine.pauseAudioPreview();
            if (btnMain) btnMain.innerHTML = `<i class="fas fa-play"></i>`;
            document.querySelectorAll('.btn-play').forEach(b => b.innerHTML = `<i class="fas fa-play"></i>`);
        } else if (state === 'paused') {
            var resumed = window.audioEngine.resumeAudioPreview();
            if (resumed) {
                if (btnMain) btnMain.innerHTML = `<i class="fas fa-pause"></i>`;
            } else {
                this.playAudioPreview(targetAsset, null, null, 0);
            }
        } else {
            // stopped
            this.playAudioPreview(targetAsset, null, null, 0);
        }
    }

    /**
     * Folder Selection via File Dialog / Node fs
     */
    promptAddFolder() {
        if (this.csInterface) {
            this.csInterface.evalScript("ComposerHost.selectFolderDialog()", (folderPath) => {
                if (folderPath && folderPath.length > 1 && folderPath !== "undefined" && folderPath !== "null") {
                    this.addFolderAndScan(folderPath);
                } else {
                    this.fallbackAddFolderInput();
                }
            });
        } else {
            this.fallbackAddFolderInput();
        }
    }

    fallbackAddFolderInput() {
        var picker = document.getElementById('input-folder-picker');
        if (picker) {
            picker.onchange = (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    var fileObj = e.target.files[0];
                    var folderPath = fileObj.path;
                    if (folderPath) {
                        var pathLib = typeof require !== 'undefined' ? require('path') : null;
                        var dirP = pathLib ? pathLib.dirname(folderPath) : folderPath.substring(0, folderPath.lastIndexOf('/'));
                        this.addFolderAndScan(dirP || folderPath);
                    }
                }
            };
            picker.click();
            return;
        }

        var folder = prompt("Digite o caminho completo da pasta de efeitos (ex: C:\\Audios\\SFX):");
        if (folder && folder.trim()) {
            this.addFolderAndScan(folder.trim());
        }
    }

    promptRemoveFolder() {
        var userFolders = window.cacheMgr.getFolders();
        if (userFolders.length === 0) {
            alert("Nenhuma pasta adicionada para remover.");
            return;
        }

        if (userFolders.length === 1) {
            var fName = userFolders[0].split(/[\/\\]/).pop();
            if (confirm(`Deseja remover a pasta "${fName}" (${userFolders[0]}) do Premiere Composer?`)) {
                this.removeFolder(userFolders[0]);
            }
            return;
        }

        var folderListStr = userFolders.map((f, i) => `${i + 1}. ${f.split(/[\/\\]/).pop()} (${f})`).join('\n');
        var choice = prompt(`Digite o número da pasta que deseja remover:\n\n${folderListStr}`);
        if (choice) {
            var idx = parseInt(choice, 10) - 1;
            if (!isNaN(idx) && idx >= 0 && idx < userFolders.length) {
                this.removeFolder(userFolders[idx]);
            } else {
                alert("Número de pasta inválido.");
            }
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
        if (this.selectedSidebarFolder === folderPath) {
            this.selectedSidebarFolder = null;
        }
        this.renderFoldersList();
        this.rescanAllFolders();
    }

    /**
     * Render Hierarchical Interactive Folder Tree in Sidebar
     */
    renderFoldersList() {
        var container = document.getElementById('folder-list');
        if (!container) return;

        var rootFolders = window.cacheMgr.getFolders();
        if (rootFolders.length === 0) {
            container.innerHTML = `<div style="font-size:11px; color:var(--text-dim); padding:6px;">Nenhuma pasta adicionada.</div>`;
            return;
        }

        var pathLib = typeof require !== 'undefined' ? require('path') : null;

        var buildFolderTreeNode = (dirPath, level = 0) => {
            var name = pathLib ? pathLib.basename(dirPath) : dirPath.split(/[\/\\]/).pop();
            var totalCount = this.allAssets.filter(a => a.path.startsWith(dirPath)).length;

            // Find direct child subfolders of dirPath
            var subfolderPaths = new Set();
            this.allAssets.forEach(asset => {
                if (asset.path.startsWith(dirPath) && asset.path !== dirPath) {
                    var rel = asset.path.substring(dirPath.length).replace(/^[\/\\]/, '');
                    var parts = rel.split(/[\/\\]/);
                    if (parts.length > 1) {
                        var childSub = pathLib ? pathLib.join(dirPath, parts[0]) : dirPath + '/' + parts[0];
                        subfolderPaths.add(childSub);
                    }
                }
            });

            var subfolders = Array.from(subfolderPaths).sort();
            var hasChildren = subfolders.length > 0;
            var isExpanded = this.expandedSidebarNodes.has(dirPath);
            var isActive = (this.selectedSidebarFolder === dirPath);

            var html = `<div class="tree-node">`;
            html += `
                <div class="tree-row ${isActive ? 'active' : ''}" data-tree-path="${encodeURIComponent(dirPath)}">
                    ${hasChildren ? 
                        `<span class="tree-expander ${isExpanded ? 'expanded' : ''}" data-expand-path="${encodeURIComponent(dirPath)}">
                            <i class="fas fa-chevron-right"></i>
                        </span>` : 
                        `<span style="width:14px; display:inline-block;"></span>`
                    }
                    <i class="fas fa-folder tree-folder-icon"></i>
                    <span class="tree-folder-name" title="${dirPath}">${name}</span>
                    <span class="tree-folder-badge">${totalCount.toLocaleString()}</span>
                    ${level === 0 ? `<i class="fas fa-times tree-folder-remove" title="Remover Pasta" data-remove-folder="${encodeURIComponent(dirPath)}"></i>` : ''}
                </div>
            `;

            if (hasChildren && isExpanded) {
                html += `<div class="tree-children">`;
                subfolders.forEach(subPath => {
                    html += buildFolderTreeNode(subPath, level + 1);
                });
                html += `</div>`;
            }

            html += `</div>`;
            return html;
        };

        var htmlTree = rootFolders.map(fPath => buildFolderTreeNode(fPath, 0)).join('');
        container.innerHTML = htmlTree;

        // Bind Expander clicks
        container.querySelectorAll('.tree-expander').forEach(exp => {
            exp.addEventListener('click', (e) => {
                e.stopPropagation();
                var p = decodeURIComponent(exp.getAttribute('data-expand-path'));
                if (this.expandedSidebarNodes.has(p)) {
                    this.expandedSidebarNodes.delete(p);
                } else {
                    this.expandedSidebarNodes.add(p);
                }
                this.renderFoldersList();
            });
        });

        // Bind Folder Selection clicks
        container.querySelectorAll('.tree-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.classList.contains('tree-expander') || e.target.closest('.tree-expander') || e.target.classList.contains('tree-folder-remove')) {
                    return;
                }
                var p = decodeURIComponent(row.getAttribute('data-tree-path'));
                
                if (this.selectedSidebarFolder === p) {
                    this.selectedSidebarFolder = null; // Unselect -> show all
                } else {
                    this.selectedSidebarFolder = p;
                }

                this.renderFoldersList();
                this.applyFiltersAndRender();
            });
        });

        // Bind Remove Folder click
        container.querySelectorAll('.tree-folder-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                var fPath = decodeURIComponent(btn.getAttribute('data-remove-folder'));
                this.removeFolder(fPath);
            });
        });
    }

    /**
     * Initial Load with Instant Index Cache Hydration
     */
    loadInitialFolders() {
        var cachedAssets = window.cacheMgr.getScannedIndex();
        if (cachedAssets && cachedAssets.length > 0) {
            this.allAssets = cachedAssets;
            var badgeAll = document.getElementById('badge-count-all');
            if (badgeAll) badgeAll.textContent = this.allAssets.length;
            this.renderFoldersList();
            this.applyFiltersAndRender();
        }

        var folders = window.cacheMgr.getFolders();
        if (folders.length > 0) {
            this.rescanAllFolders();
        } else if (!cachedAssets || cachedAssets.length === 0) {
            this.applyFiltersAndRender();
        }
    }

    /**
     * Non-Blocking Async Folder Scanner with Progress Bar
     */
    async rescanAllFolders() {
        if (typeof require === 'undefined') return;
        if (this.isScanning) return;
        this.isScanning = true;

        var fs = require('fs');
        var path = require('path');
        var folders = window.cacheMgr.getFolders();
        
        var audioExts = ['.wav', '.mp3', '.m4a', '.aac', '.flac'];
        var videoExts = ['.mp4', '.mov', '.webm', '.avi'];

        var foundAssets = [];
        var queue = [...folders];

        // UI Progress Banner Elements
        var banner = document.getElementById('indexing-banner');
        var barFill = document.getElementById('indexing-bar-fill');
        var detailText = document.getElementById('indexing-status-detail');
        var countBadge = document.getElementById('indexing-count-badge');

        if (banner) banner.style.display = 'flex';
        if (barFill) barFill.style.width = '5%';

        var processedDirs = 0;
        var yieldCounter = 0;

        while (queue.length > 0) {
            var currentDir = queue.shift();
            processedDirs++;

            try {
                if (fs.existsSync(currentDir)) {
                    var entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

                    for (var entry of entries) {
                        var fullPath = path.join(currentDir, entry.name);
                        if (entry.isDirectory()) {
                            queue.push(fullPath);
                        } else if (entry.isFile()) {
                            var ext = path.extname(entry.name).toLowerCase();
                            var isAudio = audioExts.includes(ext);
                            var isVideo = videoExts.includes(ext);

                            if (isAudio || isVideo) {
                                var stats = fs.statSync(fullPath);
                                var relFolder = path.dirname(fullPath);

                                foundAssets.push({
                                    type: isAudio ? 'sfx' : 'overlay',
                                    path: fullPath,
                                    name: entry.name,
                                    ext: ext,
                                    dir: relFolder,
                                    mtime: stats.mtimeMs,
                                    size: stats.size
                                });
                            }
                        }
                    }
                }
            } catch (errDir) {
                console.warn("[Scanner] Error reading directory:", currentDir, errDir);
            }

            yieldCounter++;
            if (yieldCounter % 15 === 0) {
                if (countBadge) countBadge.textContent = `${foundAssets.length.toLocaleString()} arquivos`;
                if (detailText) detailText.textContent = `Lendo: ${path.basename(currentDir)}`;
                if (barFill) {
                    var progressEst = Math.min(95, Math.floor((processedDirs / (processedDirs + queue.length)) * 100));
                    barFill.style.width = `${progressEst}%`;
                }
                await new Promise(r => setTimeout(r, 0));
            }
        }

        this.allAssets = foundAssets;
        window.cacheMgr.setScannedIndex(foundAssets);

        var badgeAll = document.getElementById('badge-count-all');
        if (badgeAll) badgeAll.textContent = this.allAssets.length;

        // Refresh sidebar tree
        this.renderFoldersList();

        // Completion UI state
        if (barFill) barFill.style.width = '100%';
        if (countBadge) countBadge.textContent = `${foundAssets.length.toLocaleString()} arquivos escaneados`;
        if (detailText) detailText.textContent = `Indexação concluída!`;

        setTimeout(() => {
            if (banner) banner.style.display = 'none';
        }, 1500);

        this.isScanning = false;
        this.applyFiltersAndRender();
    }

    /**
     * Filter & Query Engine
     */
    applyFiltersAndRender() {
        var query = this.searchQuery;
        var filter = this.currentFilter;

        this.filteredAssets = this.allAssets.filter(asset => {
            // Type filter
            if (filter === 'sfx' && asset.type !== 'sfx') return false;
            if (filter === 'overlay' && asset.type !== 'overlay') return false;
            if (filter === 'favorites' && !window.cacheMgr.isFavorite(asset.path)) return false;

            // Sidebar Folder Filter
            if (this.selectedSidebarFolder) {
                if (!asset.path.startsWith(this.selectedSidebarFolder)) return false;
            }

            // Query search
            if (query) {
                var matchName = asset.name.toLowerCase().includes(query);
                var matchPath = asset.path.toLowerCase().includes(query);
                if (!matchName && !matchPath) return false;
            }

            return true;
        });

        this.renderedCount = this.pageSize;
        this.renderCurrentView();
    }

    /**
     * Main View Dispatcher
     */
    renderCurrentView() {
        var container = document.getElementById('grid-assets');
        if (!container) return;

        this.viewMode = 'folder';
        this.renderFolderView(container);
    }

    /**
     * Render Full File Tree Explorer in Main View (Estilo Premiere Composer Oficial)
     */
    renderFolderView(container) {
        container.className = 'composer-tree-view';
        var pathLib = typeof require !== 'undefined' ? require('path') : null;
        var userFolders = this.selectedSidebarFolder ? [this.selectedSidebarFolder] : window.cacheMgr.getFolders();

        if (userFolders.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:40px; text-align:center;">
                    <i class="fas fa-folder-plus" style="font-size:36px; color:#f59e0b; margin-bottom:12px; display:block;"></i>
                    <h3 style="color:#fff; font-size:15px; margin-bottom:6px;">Nenhuma pasta local vinculada</h3>
                    <p style="color:var(--text-dim); font-size:12px;">Clique em "+ Adicionar Pasta" para indexar seus efeitos sonoros e overlays.</p>
                </div>
            `;
            return;
        }

        // Expanded tree nodes set for main view
        if (!this.expandedMainTreeNodes) {
            this.expandedMainTreeNodes = new Set(userFolders);
        }

        if (this.currentFilter === 'favorites' && this.filteredAssets.length === 0) {
            container.innerHTML = `
                <div style="padding: 40px 20px; text-align: center; color: var(--text-dim);">
                    <i class="far fa-star" style="font-size: 36px; color: #f59e0b; margin-bottom: 14px; display: block;"></i>
                    <div style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px;">Nenhum favorito adicionado</div>
                    <div style="font-size: 11px;">Clique na estrela ⭐ ao lado de qualquer áudio ou overlay para salvar nos seus favoritos!</div>
                </div>
            `;
            return;
        }

        var buildComposerTreeNode = (dirPath) => {
            var name = pathLib ? pathLib.basename(dirPath) : dirPath.split(/[\/\\]/).pop();
            var isExpanded = this.expandedMainTreeNodes.has(dirPath);
            var isRootUserFolder = userFolders.includes(dirPath);

            // Find direct child subfolders & files of dirPath
            var subfolderPaths = new Set();
            var directFiles = [];

            this.filteredAssets.forEach(asset => {
                if (asset.path.startsWith(dirPath) && asset.path !== dirPath) {
                    var rel = asset.path.substring(dirPath.length).replace(/^[\/\\]/, '');
                    var parts = rel.split(/[\/\\]/);
                    if (parts.length > 1) {
                        var childSub = pathLib ? pathLib.join(dirPath, parts[0]) : dirPath + '/' + parts[0];
                        subfolderPaths.add(childSub);
                    } else {
                        directFiles.push(asset);
                    }
                }
            });

            var subfolders = Array.from(subfolderPaths).sort();
            var hasChildren = (subfolders.length > 0 || directFiles.length > 0);

            var html = `<div class="composer-tree-node">`;
            html += `
                <div class="composer-tree-row folder-row" data-main-folder="${encodeURIComponent(dirPath)}">
                    ${hasChildren ? 
                        `<span class="composer-chevron ${isExpanded ? 'expanded' : ''}">
                            <i class="fas fa-chevron-right"></i>
                        </span>` : 
                        `<span style="width:16px;"></span>`
                    }
                    <i class="fas fa-folder composer-folder-icon"></i>
                    <span class="composer-title">${name}</span>
                    ${isRootUserFolder ? `
                        <button class="btn-remove-root-folder" data-remove-folder="${encodeURIComponent(dirPath)}" title="Excluir/Remover esta pasta do Composer">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    ` : ''}
                </div>
            `;

            if (isExpanded) {
                html += `<div class="composer-tree-children">`;

                // Render Subfolders first
                subfolders.forEach(subPath => {
                    html += buildComposerTreeNode(subPath);
                });

                // Render Direct Audio/Video Files inline under this folder
                directFiles.forEach((fileAsset) => {
                    var isSelected = (this.selectedAsset && this.selectedAsset.path === fileAsset.path);
                    var isFav = window.cacheMgr.isFavorite(fileAsset.path);
                    var isAudio = fileAsset.type === 'sfx';

                    html += `
                        <div class="composer-tree-row file-row ${isSelected ? 'selected' : ''}" data-file-path="${encodeURIComponent(fileAsset.path)}">
                            <span class="composer-fav-btn ${isFav ? 'active' : ''}" data-fav-path="${encodeURIComponent(fileAsset.path)}">
                                <i class="${isFav ? 'fas' : 'far'} fa-star" style="${isFav ? 'color:#f59e0b' : ''}"></i>
                            </span>
                            <span class="composer-file-icon ${isAudio ? '' : 'overlay'}">
                                <i class="${isAudio ? 'fas fa-wave-square' : 'fas fa-film'}"></i>
                            </span>
                            <span class="composer-title">${fileAsset.name}</span>
                            ${isAudio ? `
                                <button class="btn-icon btn-cut-silence-tree" data-cut-path="${encodeURIComponent(fileAsset.path)}" title="Cortar Silêncio & Sobrescrever Arquivo Original" style="color:var(--accent-red); width:22px; height:22px; font-size:10px; border:none; background:transparent;">
                                    <i class="fas fa-scissors"></i>
                                </button>
                            ` : ''}
                        </div>
                    `;
                });

                html += `</div>`;
            }

            html += `</div>`;
            return html;
        };

        var htmlTree = `<div class="composer-tree-view">` + userFolders.map(fPath => buildComposerTreeNode(fPath)).join('');
        
        // Add Bottom Folder Management Bar
        htmlTree += `
            <div class="composer-tree-actions-bar">
                <button class="btn-tree-action" id="btn-tree-add-folder" title="Adicionar Nova Pasta de Áudio/Vídeo">
                    <i class="fas fa-folder-plus"></i> + Adicionar Pasta
                </button>
                ${userFolders.length > 0 ? `
                    <button class="btn-tree-action danger" id="btn-tree-remove-folder" title="Excluir/Remover Pasta Monitorada">
                        <i class="fas fa-trash-alt"></i> Excluir Pasta
                    </button>
                ` : ''}
            </div>
        </div>`;

        var savedScroll = container.scrollTop;
        var contentBody = document.querySelector('.content-body');
        var savedBodyScroll = contentBody ? contentBody.scrollTop : 0;

        container.innerHTML = htmlTree;

        if (savedScroll > 0) container.scrollTop = savedScroll;
        if (contentBody && savedBodyScroll > 0) contentBody.scrollTop = savedBodyScroll;
        requestAnimationFrame(() => {
            if (savedScroll > 0) container.scrollTop = savedScroll;
            if (contentBody && savedBodyScroll > 0) contentBody.scrollTop = savedBodyScroll;
        });

        // Bind Add Folder in Tree
        var btnAddFolderTree = container.querySelector('#btn-tree-add-folder');
        if (btnAddFolderTree) {
            btnAddFolderTree.addEventListener('click', () => this.promptAddFolder());
        }

        // Bind Remove Folder in Tree
        var btnRemoveFolderTree = container.querySelector('#btn-tree-remove-folder');
        if (btnRemoveFolderTree) {
            btnRemoveFolderTree.addEventListener('click', () => this.promptRemoveFolder());
        }

        // Bind Root Folder Trash Icons
        container.querySelectorAll('.btn-remove-root-folder').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                var fPath = decodeURIComponent(btn.getAttribute('data-remove-folder'));
                var fName = fPath.split(/[\/\\]/).pop();
                if (confirm(`Deseja remover a pasta "${fName}" do Premiere Composer?`)) {
                    this.removeFolder(fPath);
                }
            });
        });

        // Bind Folder Chevron/Row Toggles
        container.querySelectorAll('.composer-tree-row.folder-row').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                var dirP = decodeURIComponent(row.getAttribute('data-main-folder'));
                if (this.expandedMainTreeNodes.has(dirP)) {
                    this.expandedMainTreeNodes.delete(dirP);
                } else {
                    this.expandedMainTreeNodes.add(dirP);
                }
                this.renderFolderView(container);
            });
        });

        // Bind File Selection (Click) & Double-Click Insert
        container.querySelectorAll('.composer-tree-row.file-row').forEach(row => {
            var fPath = decodeURIComponent(row.getAttribute('data-file-path'));
            var asset = this.allAssets.find(a => a.path === fPath);

            row.addEventListener('click', (e) => {
                if (e.target.closest('.composer-fav-btn') || e.target.closest('.btn-cut-silence-tree')) return;
                if (asset) {
                    this.selectedAsset = asset;
                    container.querySelectorAll('.composer-tree-row.file-row').forEach(r => r.classList.remove('selected'));
                    row.classList.add('selected');
                    this.selectAndDrawPlayerAsset(asset);
                    if (asset.type === 'sfx') {
                        this.playAudioPreview(asset, null, null, 0);
                    }
                }
            });

            row.addEventListener('dblclick', (e) => {
                if (asset) {
                    this.insertToTimeline(asset);
                }
            });
        });

        // Bind Cut Silence in Tree View (Direct In-Place Overwrite without jumping scroll!)
        container.querySelectorAll('.btn-cut-silence-tree').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                var fPath = decodeURIComponent(btn.getAttribute('data-cut-path'));
                var asset = this.allAssets.find(a => a.path === fPath);
                if (asset && confirm(`Deseja cortar o silêncio e ajustar o Max Peak do arquivo "${asset.name}" SOBRESCREVENDO o arquivo original no disco?`)) {
                    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                    try {
                        var thresh = window.cacheMgr.getSetting('silenceThresholdDb', -45.0);
                        var targetMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
                        var selectMaxPeakPlayer = document.getElementById('select-max-peak-player');
                        if (selectMaxPeakPlayer) targetMaxPeak = parseFloat(selectMaxPeakPlayer.value);

                        window.audioEngine.stopAudioPreview();
                        var res = await window.audioEngine.cutSilenceAndReplaceFile(asset.path, thresh, targetMaxPeak);
                        
                        asset.path = res.targetPath;
                        asset.procData = res.procInfo;
                        asset.mtime = Date.now();
                        if (typeof require !== 'undefined') {
                            asset.name = require('path').basename(res.targetPath);
                        }

                        window.cacheMgr.setScannedIndex(this.allAssets);

                        // Update DOM elements in place without resetting scroll!
                        var row = btn.closest('.file-row');
                        if (row) {
                            row.setAttribute('data-file-path', encodeURIComponent(res.targetPath));
                            var titleEl = row.querySelector('.composer-title');
                            if (titleEl) titleEl.textContent = asset.name;
                            var favBtn = row.querySelector('.composer-fav-btn');
                            if (favBtn) favBtn.setAttribute('data-fav-path', encodeURIComponent(res.targetPath));
                        }
                        btn.setAttribute('data-cut-path', encodeURIComponent(res.targetPath));

                        btn.innerHTML = `<i class="fas fa-check" style="color:var(--accent-green-bright);"></i>`;
                        setTimeout(() => { btn.innerHTML = `<i class="fas fa-scissors"></i>`; }, 2000);
                        
                        this.selectAndDrawPlayerAsset(asset);
                        this.showNotification(`✨ Arquivo "${asset.name}" sobrescrito e salvo com sucesso no disco!`);
                    } catch (errCut) {
                        alert("Erro ao cortar silêncio: " + errCut.message);
                        btn.innerHTML = `<i class="fas fa-scissors"></i>`;
                    }
                }
            });
        });

        // Bind Favorite Star in Tree
        container.querySelectorAll('.composer-fav-btn[data-fav-path]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                var fPath = decodeURIComponent(btn.getAttribute('data-fav-path'));
                var isFav = window.cacheMgr.toggleFavorite(fPath);
                btn.innerHTML = `<i class="${isFav ? 'fas' : 'far'} fa-star"></i>`;
                btn.classList.toggle('active', isFav);
                this.renderFoldersList();
            });
        });
    }

    /**
     * Select Asset and Draw Waveform in Bottom Player
     */
    selectAndDrawPlayerAsset(asset) {
        this.selectedAsset = asset;
        var playerTitle = document.getElementById('player-title');
        var playerSubtitle = document.getElementById('player-subtitle');
        var mainCanvas = document.getElementById('player-waveform-canvas');
        var timeCurrent = document.getElementById('player-time-current');
        var timeTotal = document.getElementById('player-time-total');

        if (playerTitle) playerTitle.textContent = asset.name;
        if (timeCurrent) timeCurrent.textContent = "00:00.00";

        if (asset.type === 'sfx') {
            var draw = (proc) => {
                if (playerSubtitle) playerSubtitle.textContent = `Max Peak: ${proc.nativePeakDb} dB | Duração: ${this.formatTimePrecise(proc.duration)}`;
                if (timeTotal) timeTotal.textContent = this.formatTimePrecise(proc.duration);
                if (mainCanvas) {
                    window.audioEngine.drawWaveform(mainCanvas, proc.waveform, 0, proc.silenceStartSec, proc.silenceEndSec, proc.duration);
                }
            };

            if (asset.procData) {
                draw(asset.procData);
            } else {
                var cached = window.cacheMgr.getAudioCache(asset.path, asset.mtime);
                if (cached) {
                    asset.procData = cached;
                    draw(cached);
                } else {
                    window.audioEngine.decodeAudioFile(asset.path).then(audioBuf => {
                        var proc = window.audioEngine.processAudioBuffer(audioBuf);
                        window.cacheMgr.setAudioCache(asset.path, asset.mtime, proc);
                        asset.procData = proc;
                        draw(proc);
                    }).catch(() => {});
                }
            }
        } else {
            if (playerSubtitle) playerSubtitle.textContent = "Overlay de Vídeo";
            if (timeTotal) timeTotal.textContent = "--:--";
        }
    }

    /**
     * Play Audio Preview with Real-Time Needle Updates
     */
    playAudioPreview(asset, canvas, btnPlay, startPercent = 0) {
        if (!asset || asset.type !== 'sfx') return;
        this.selectedAsset = asset;

        var btnMain = document.getElementById('btn-play-main');
        var playerTitle = document.getElementById('player-title');
        var playerSubtitle = document.getElementById('player-subtitle');
        var mainCanvas = document.getElementById('player-waveform-canvas');
        var timeCurrent = document.getElementById('player-time-current');
        var timeTotal = document.getElementById('player-time-total');

        if (playerTitle) playerTitle.textContent = asset.name;
        if (playerSubtitle && asset.procData) playerSubtitle.textContent = `Max Peak: ${asset.procData.nativePeakDb} dB | Duração: ${this.formatTimePrecise(asset.procData.duration)}`;
        if (btnMain) btnMain.innerHTML = `<i class="fas fa-pause"></i>`;
        if (btnPlay) btnPlay.innerHTML = `<i class="fas fa-pause"></i>`;

        // Reset other play buttons
        document.querySelectorAll('.btn-play').forEach(b => {
            if (b !== btnPlay) b.innerHTML = `<i class="fas fa-play"></i>`;
        });

        var onProgress = (pct, currentSec, duration) => {
            if (timeCurrent) timeCurrent.textContent = this.formatTimePrecise(currentSec);
            if (timeTotal) timeTotal.textContent = this.formatTimePrecise(duration);

            if (asset.procData) {
                if (canvas) {
                    window.audioEngine.drawWaveform(canvas, asset.procData.waveform, pct, asset.procData.silenceStartSec, asset.procData.silenceEndSec, duration);
                }
                if (mainCanvas) {
                    window.audioEngine.drawWaveform(mainCanvas, asset.procData.waveform, pct, asset.procData.silenceStartSec, asset.procData.silenceEndSec, duration);
                }
            }
        };

        var onEnded = () => {
            if (btnMain) btnMain.innerHTML = `<i class="fas fa-play"></i>`;
            if (btnPlay) btnPlay.innerHTML = `<i class="fas fa-play"></i>`;
            if (timeCurrent) timeCurrent.textContent = "00:00.00";
            if (asset.procData) {
                if (canvas) {
                    window.audioEngine.drawWaveform(canvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
                }
                if (mainCanvas) {
                    window.audioEngine.drawWaveform(mainCanvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
                }
            }
        };

        // Cache check
        if (!asset.procData) {
            var cached = window.cacheMgr.getAudioCache(asset.path, asset.mtime);
            if (cached) {
                asset.procData = cached;
                if (timeTotal) timeTotal.textContent = this.formatTimePrecise(cached.duration);
            } else {
                window.audioEngine.decodeAudioFile(asset.path).then(buf => {
                    var proc = window.audioEngine.processAudioBuffer(buf);
                    window.cacheMgr.setAudioCache(asset.path, asset.mtime, proc);
                    asset.procData = proc;
                    if (timeTotal) timeTotal.textContent = this.formatTimePrecise(proc.duration);
                    if (playerSubtitle) playerSubtitle.textContent = `Max Peak: ${proc.nativePeakDb} dB | Duração: ${this.formatTimePrecise(proc.duration)}`;
                }).catch(() => {});
            }
        } else {
            if (timeTotal) timeTotal.textContent = this.formatTimePrecise(asset.procData.duration);
        }

        window.audioEngine.playAudioPreview(asset.path, this.pitchSemitones, this.isReverse, onProgress, onEnded, startPercent);
    }

    /**
     * Cut Silence, Apply Max Peak Normalization & OVERWRITE Original File on Disk
     * Completely eliminates any temporary / lost files!
     */
    async overwriteSelectedAsset() {
        var asset = this.selectedAsset;
        if (!asset || asset.type !== 'sfx') {
            alert("Selecione um efeito sonoro primeiro para cortar o silêncio e ajustar o Max Peak.");
            return;
        }

        var thresh = window.cacheMgr.getSetting('silenceThresholdDb', -45.0);
        var targetMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
        var selectMaxPeakPlayer = document.getElementById('select-max-peak-player');
        if (selectMaxPeakPlayer) {
            targetMaxPeak = parseFloat(selectMaxPeakPlayer.value);
        }

        var msg = `Deseja cortar o silêncio e normalizar o Max Peak para ${targetMaxPeak} dB SOBRESCREVENDO o arquivo original no seu disco?\n\nArquivo: ${asset.path}\n\nO arquivo original será modificado permanentemente (nenhum arquivo temporário será usado).`;
        if (!confirm(msg)) return;

        var btnOverwrite = document.getElementById('btn-overwrite-cut-peak');
        if (btnOverwrite) btnOverwrite.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Sobrescrevendo...`;

        try {
            window.audioEngine.stopAudioPreview();
            var res = await window.audioEngine.cutSilenceAndReplaceFile(asset.path, thresh, targetMaxPeak);
            
            asset.path = res.targetPath;
            asset.procData = res.procInfo;
            asset.mtime = Date.now();
            if (typeof require !== 'undefined') {
                asset.name = require('path').basename(res.targetPath);
            }

            // Update scanned index in cache
            window.cacheMgr.setScannedIndex(this.allAssets);

            this.selectAndDrawPlayerAsset(asset);
            this.renderCurrentView();
            this.showNotification(`✨ Arquivo "${asset.name}" sobrescrito e salvo com sucesso no disco!`);
        } catch (err) {
            alert("Erro ao sobrescrever arquivo: " + err.message);
        } finally {
            if (btnOverwrite) btnOverwrite.innerHTML = `<i class="fas fa-bolt"></i> Sobrescrever Arquivo Original`;
        }
    }

    /**
     * Insert asset directly to Premiere Pro Timeline (Clean Import without silence cut or peak change)
     */
    async insertToTimeline(asset) {
        if (!asset) return;

        // Call Premiere Pro ExtendScript with the real permanent file path
        var scriptCall = `ComposerHost.importAndInsertAsset(${JSON.stringify(asset.path)}, ${JSON.stringify(asset.type)})`;
        
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

    formatTimePrecise(sec) {
        if (!sec || isNaN(sec)) return "00:00.00";
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        var ms = Math.floor((sec % 1) * 100);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new ComposerApp();
});
