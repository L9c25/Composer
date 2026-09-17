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

        // Initialize GitHub Auto-Updater
        if (typeof UpdaterManager !== 'undefined') {
            window.updaterMgr = new UpdaterManager(this);
            window.updaterMgr.init();
        }
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

        // Add Folder Buttons (Sidebar and Header)
        var addFolderBtn = document.getElementById('btn-add-folder');
        if (addFolderBtn) {
            addFolderBtn.addEventListener('click', () => this.promptAddFolder());
        }

        var btnHeaderAdd = document.getElementById('btn-header-add-folder');
        if (btnHeaderAdd) {
            btnHeaderAdd.addEventListener('click', () => this.promptAddFolder());
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

        // Infinite Scroll Handler for Large Asset Libraries
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
     * Helpers for Clean Path Normalization
     */
    normalizePath(p) {
        if (!p) return '';
        return p.replace(/\\/g, '/').replace(/\/+$/, '');
    }

    getPathBasename(p) {
        if (!p) return '';
        var norm = this.normalizePath(p);
        var parts = norm.split('/');
        return parts[parts.length - 1] || norm;
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
            this.playAudioPreview(targetAsset, null, null, 0);
        }
    }

    /**
     * Folder Selection via Native Dialog / File Picker
     */
    promptAddFolder() {
        if (this.csInterface && typeof this.csInterface.evalScript === 'function') {
            this.csInterface.evalScript("ComposerHost.selectFolderDialog()", (folderPath) => {
                if (folderPath === "CANCELLED") {
                    return;
                }
                if (folderPath && folderPath.length > 1 && !folderPath.startsWith("ERROR:") && folderPath !== "undefined" && folderPath !== "null") {
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
            var fName = this.getPathBasename(userFolders[0]);
            if (confirm(`Deseja remover a pasta "${fName}" (${userFolders[0]}) do Premiere Composer?`)) {
                this.removeFolder(userFolders[0]);
            }
            return;
        }

        var folderListStr = userFolders.map((f, i) => `${i + 1}. ${this.getPathBasename(f)} (${f})`).join('\n');
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
        if (!folderPath) return;
        var norm = this.normalizePath(folderPath);
        if (window.cacheMgr.addFolder(norm)) {
            if (!this.expandedMainTreeNodes) this.expandedMainTreeNodes = new Set();
            this.expandedMainTreeNodes.add(norm);
            this.renderFoldersList();
            this.rescanAllFolders();
        }
    }

    removeFolder(folderPath) {
        if (!folderPath) return;
        var norm = this.normalizePath(folderPath);
        window.cacheMgr.removeFolder(norm);
        if (this.selectedSidebarFolder && this.normalizePath(this.selectedSidebarFolder).toLowerCase() === norm.toLowerCase()) {
            this.selectedSidebarFolder = null;
        }
        if (this.expandedMainTreeNodes) {
            this.expandedMainTreeNodes.delete(norm);
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

        var rootFolders = window.cacheMgr.getFolders().map(f => this.normalizePath(f));
        if (rootFolders.length === 0) {
            container.innerHTML = `<div style="font-size:11px; color:var(--text-dim); padding:6px;">Nenhuma pasta adicionada.</div>`;
            return;
        }

        var buildFolderTreeNode = (dirPath, level = 0) => {
            var normDir = this.normalizePath(dirPath);
            var normDirLower = normDir.toLowerCase();
            var normDirLowerWithSlash = normDirLower + '/';
            var name = this.getPathBasename(normDir);

            var totalCount = this.allAssets.filter(a => {
                var aPath = this.normalizePath(a.path).toLowerCase();
                return aPath.startsWith(normDirLowerWithSlash) || aPath === normDirLower;
            }).length;

            // Find direct child subfolders
            var subfolderMap = new Map();
            this.allAssets.forEach(asset => {
                var assetPath = this.normalizePath(asset.path);
                var assetPathLower = assetPath.toLowerCase();
                if (assetPathLower.startsWith(normDirLowerWithSlash)) {
                    var rel = assetPath.substring(normDir.length + 1);
                    var parts = rel.split('/');
                    if (parts.length > 1) {
                        var subName = parts[0];
                        var subPath = normDir + '/' + subName;
                        if (!subfolderMap.has(subName.toLowerCase())) {
                            subfolderMap.set(subName.toLowerCase(), subPath);
                        }
                    }
                }
            });

            var subfolders = Array.from(subfolderMap.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            var hasChildren = subfolders.length > 0;
            var isExpanded = this.expandedSidebarNodes.has(normDir);
            var isActive = (this.selectedSidebarFolder && this.normalizePath(this.selectedSidebarFolder).toLowerCase() === normDirLower);

            var html = `<div class="tree-node">`;
            html += `
                <div class="tree-row ${isActive ? 'active' : ''}" data-tree-path="${encodeURIComponent(normDir)}">
                    ${hasChildren ? 
                        `<span class="tree-expander ${isExpanded ? 'expanded' : ''}" data-expand-path="${encodeURIComponent(normDir)}">
                            <i class="fas fa-chevron-right"></i>
                        </span>` : 
                        `<span style="width:14px; display:inline-block;"></span>`
                    }
                    <i class="fas ${isExpanded ? 'fa-folder-open' : 'fa-folder'} tree-folder-icon"></i>
                    <span class="tree-folder-name" title="${normDir}">${name}</span>
                    <span class="tree-folder-badge">${totalCount.toLocaleString()}</span>
                    ${level === 0 ? `<i class="fas fa-times tree-folder-remove" title="Remover Pasta" data-remove-folder="${encodeURIComponent(normDir)}"></i>` : ''}
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
                var p = this.normalizePath(decodeURIComponent(exp.getAttribute('data-expand-path')));
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
                var p = this.normalizePath(decodeURIComponent(row.getAttribute('data-tree-path')));
                
                if (this.selectedSidebarFolder && this.normalizePath(this.selectedSidebarFolder).toLowerCase() === p.toLowerCase()) {
                    this.selectedSidebarFolder = null;
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
        }

        var folders = window.cacheMgr.getFolders().map(f => this.normalizePath(f));
        this.expandedMainTreeNodes = new Set(folders);

        if (folders.length > 0) {
            this.renderFoldersList();
            this.applyFiltersAndRender();
            this.rescanAllFolders();
        } else {
            this.renderFoldersList();
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
        var folders = window.cacheMgr.getFolders().map(f => this.normalizePath(f));
        
        var audioExts = ['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.aiff'];
        var videoExts = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];

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
                        var normFullPath = this.normalizePath(fullPath);
                        if (entry.isDirectory()) {
                            queue.push(normFullPath);
                        } else if (entry.isFile()) {
                            var ext = path.extname(entry.name).toLowerCase();
                            var isAudio = audioExts.includes(ext);
                            var isVideo = videoExts.includes(ext);

                            if (isAudio || isVideo) {
                                var stats = fs.statSync(fullPath);
                                var relFolder = this.normalizePath(path.dirname(fullPath));

                                foundAssets.push({
                                    type: isAudio ? 'sfx' : 'overlay',
                                    path: normFullPath,
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
            
            var normAssetPath = this.normalizePath(asset.path);
            if (filter === 'favorites' && !window.cacheMgr.isFavorite(asset.path) && !window.cacheMgr.isFavorite(normAssetPath)) return false;

            // Sidebar Folder Filter
            if (this.selectedSidebarFolder) {
                var normSelFolder = this.normalizePath(this.selectedSidebarFolder).toLowerCase();
                var normAPath = normAssetPath.toLowerCase();
                if (!normAPath.startsWith(normSelFolder + '/') && normAPath !== normSelFolder) return false;
            }

            // Query search
            if (query) {
                var matchName = asset.name.toLowerCase().includes(query);
                var matchPath = normAssetPath.toLowerCase().includes(query);
                if (!matchName && !matchPath) return false;
            }

            return true;
        });

        // If search query is present, auto-expand nodes matching results
        if (query) {
            if (!this._preSearchExpandedNodes) {
                this._preSearchExpandedNodes = new Set(this.expandedMainTreeNodes || []);
            }
            if (!this.expandedMainTreeNodes) {
                this.expandedMainTreeNodes = new Set();
            }
            this.filteredAssets.forEach(asset => {
                var normDir = this.normalizePath(asset.dir);
                var parts = normDir.split('/');
                var curr = '';
                parts.forEach((p, idx) => {
                    curr = idx === 0 ? p : curr + '/' + p;
                    if (curr.length > 2) {
                        this.expandedMainTreeNodes.add(curr);
                    }
                });
            });
        } else {
            // When search is empty or cleared, restore original folder expanded state
            if (this._preSearchExpandedNodes) {
                this.expandedMainTreeNodes = new Set(this._preSearchExpandedNodes);
                this._preSearchExpandedNodes = null;
            }
        }

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
        var userFolders = window.cacheMgr.getFolders().map(f => this.normalizePath(f));

        if (this.selectedSidebarFolder) {
            userFolders = [this.normalizePath(this.selectedSidebarFolder)];
        }

        // Expanded tree nodes set for main view
        if (!this.expandedMainTreeNodes) {
            this.expandedMainTreeNodes = new Set(userFolders);
        }

        // Ensure newly added root folders are expanded
        userFolders.forEach(rf => {
            if (!this._userToggledNodes || !this._userToggledNodes.has(rf)) {
                this.expandedMainTreeNodes.add(rf);
            }
        });

        // Empty state: No folders linked
        if (userFolders.length === 0) {
            container.innerHTML = `
                <div class="composer-empty-wrapper" style="display:flex; flex-direction:column; align-items:center; justify-content:center; flex:1; width:100%; text-align:center; padding:40px 20px;">
                    <div style="width:68px; height:68px; border-radius:50%; background:rgba(245, 158, 11, 0.12); display:flex; align-items:center; justify-content:center; margin-bottom:16px; border:1px solid rgba(245, 158, 11, 0.3);">
                        <i class="fas fa-folder-plus" style="font-size:30px; color:#f59e0b;"></i>
                    </div>
                    <h3 style="color:#fff; font-size:16px; font-weight:700; margin-bottom:8px;">Nenhuma pasta vinculada</h3>
                    <p style="color:var(--text-dim); font-size:12px; max-width:380px; line-height:1.5; margin-bottom:20px;">
                        Vincule suas pastas locais com efeitos sonoros (.wav, .mp3, .m4a, .aac, .flac) ou overlays de vídeo (.mp4, .mov, .webm) para navegar e usar no Premiere Pro.
                    </p>
                    <button class="btn-tree-action" id="btn-empty-add-folder" style="padding:10px 24px; font-size:13px; font-weight:700; background:linear-gradient(135deg, var(--accent-emerald), #059669); color:#000; border:none; box-shadow:0 0 16px var(--accent-emerald-glow); border-radius:var(--radius-full); cursor:pointer;">
                        <i class="fas fa-folder-plus"></i> + Adicionar Pasta
                    </button>
                </div>
                <div class="composer-tree-actions-bar">
                    <button class="btn-tree-action" id="btn-tree-add-folder" title="Adicionar Nova Pasta de Áudio/Vídeo">
                        <i class="fas fa-folder-plus"></i> + Adicionar Pasta
                    </button>
                </div>
            `;

            var btnEmpty = container.querySelector('#btn-empty-add-folder');
            if (btnEmpty) btnEmpty.addEventListener('click', () => this.promptAddFolder());
            var btnTree = container.querySelector('#btn-tree-add-folder');
            if (btnTree) btnTree.addEventListener('click', () => this.promptAddFolder());
            return;
        }

        // Empty favorites state
        if (this.currentFilter === 'favorites' && this.filteredAssets.length === 0) {
            container.innerHTML = `
                <div class="composer-empty-wrapper" style="display:flex; flex-direction:column; align-items:center; justify-content:center; flex:1; width:100%; text-align:center; padding:40px 20px;">
                    <i class="far fa-star" style="font-size: 38px; color: #f59e0b; margin-bottom: 14px; display: block;"></i>
                    <div style="font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 6px;">Nenhum favorito adicionado</div>
                    <div style="font-size: 12px; color: var(--text-dim); max-width: 360px;">Clique na estrela ⭐ ao lado de qualquer áudio ou overlay para salvar nos seus favoritos!</div>
                </div>
                <div class="composer-tree-actions-bar">
                    <button class="btn-tree-action" id="btn-tree-add-folder" title="Adicionar Nova Pasta de Áudio/Vídeo">
                        <i class="fas fa-folder-plus"></i> + Adicionar Pasta
                    </button>
                    <button class="btn-tree-action danger" id="btn-tree-remove-folder" title="Excluir/Remover Pasta Monitorada">
                        <i class="fas fa-trash-alt"></i> Excluir Pasta
                    </button>
                </div>
            `;
            var btnTreeAddFav = container.querySelector('#btn-tree-add-folder');
            if (btnTreeAddFav) btnTreeAddFav.addEventListener('click', () => this.promptAddFolder());
            var btnTreeRemFav = container.querySelector('#btn-tree-remove-folder');
            if (btnTreeRemFav) btnTreeRemFav.addEventListener('click', () => this.promptRemoveFolder());
            return;
        }

        var anyFolderRenderedExpanded = false;

        var buildComposerTreeNode = (dirPath, level = 0) => {
            var normDir = this.normalizePath(dirPath);
            var normDirLower = normDir.toLowerCase();
            var normDirLowerWithSlash = normDirLower + '/';
            var name = this.getPathBasename(normDir);
            var isExpanded = this.expandedMainTreeNodes.has(normDir);
            var isRootUserFolder = userFolders.some(rf => rf.toLowerCase() === normDirLower);

            var subfolderMap = new Map();
            var directFiles = [];

            this.filteredAssets.forEach(asset => {
                var assetPath = this.normalizePath(asset.path);
                var assetPathLower = assetPath.toLowerCase();

                if (assetPathLower.startsWith(normDirLowerWithSlash)) {
                    var rel = assetPath.substring(normDir.length + 1);
                    var parts = rel.split('/');
                    if (parts.length > 1) {
                        var directSubName = parts[0];
                        var subFullPath = normDir + '/' + directSubName;
                        if (!subfolderMap.has(directSubName.toLowerCase())) {
                            subfolderMap.set(directSubName.toLowerCase(), subFullPath);
                        }
                    } else {
                        directFiles.push(asset);
                    }
                }
            });

            var subfolders = Array.from(subfolderMap.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            directFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

            var totalFilesInBranch = this.filteredAssets.filter(asset => {
                var aPathLower = this.normalizePath(asset.path).toLowerCase();
                return aPathLower.startsWith(normDirLowerWithSlash);
            }).length;

            var hasChildren = (subfolders.length > 0 || directFiles.length > 0);
            var indent = level * 16 + 8;

            var html = `<div class="composer-tree-node">`;
            html += `
                <div class="composer-tree-row folder-row ${isExpanded ? 'is-expanded' : ''}" data-main-folder="${encodeURIComponent(normDir)}" style="padding-left: ${indent}px;">
                    <span class="composer-chevron ${isExpanded ? 'expanded' : ''}" data-chevron-folder="${encodeURIComponent(normDir)}">
                        <i class="fas ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                    </span>
                    <i class="fas ${isExpanded ? 'fa-folder-open' : 'fa-folder'} composer-folder-icon"></i>
                    <span class="composer-title" title="${normDir}">${name}</span>
                    <span class="composer-count-badge" title="${totalFilesInBranch} arquivo(s)">${totalFilesInBranch}</span>
                    ${isRootUserFolder ? `
                        <button class="btn-remove-root-folder" data-remove-folder="${encodeURIComponent(normDir)}" title="Excluir/Remover pasta '${name}' do Composer">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    ` : ''}
                </div>
            `;

            if (isExpanded) {
                anyFolderRenderedExpanded = true;
                html += `<div class="composer-tree-children">`;

                if (!hasChildren) {
                    html += `<div style="font-size:11px; color:var(--text-dim); padding:6px 0 6px ${indent + 24}px; font-style:italic;">Pasta vazia ou sem arquivos compatíveis</div>`;
                } else {
                    // Subfolders
                    subfolders.forEach(subPath => {
                        html += buildComposerTreeNode(subPath, level + 1);
                    });

                    // Direct Files
                    directFiles.forEach(fileAsset => {
                        var normFilePath = this.normalizePath(fileAsset.path);
                        var isSelected = (this.selectedAsset && this.normalizePath(this.selectedAsset.path).toLowerCase() === normFilePath.toLowerCase());
                        var isFav = window.cacheMgr.isFavorite(fileAsset.path) || window.cacheMgr.isFavorite(normFilePath);
                        var isAudio = fileAsset.type === 'sfx';
                        var fileIndent = (level + 1) * 16 + 8;

                        html += `
                            <div class="composer-tree-row file-row ${isSelected ? 'selected' : ''}" data-file-path="${encodeURIComponent(normFilePath)}" style="padding-left: ${fileIndent}px;">
                                <span class="composer-fav-btn ${isFav ? 'active' : ''}" data-fav-path="${encodeURIComponent(normFilePath)}" title="${isFav ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos'}">
                                    <i class="${isFav ? 'fas' : 'far'} fa-star" style="${isFav ? 'color:#f59e0b;' : ''}"></i>
                                </span>
                                <span class="composer-file-icon ${isAudio ? '' : 'overlay'}">
                                    <i class="${isAudio ? 'fas fa-wave-square' : 'fas fa-film'}"></i>
                                </span>
                                <span class="composer-title" title="${fileAsset.name}">${fileAsset.name}</span>
                                ${isAudio ? `
                                    <button class="btn-icon btn-cut-silence-tree" data-cut-path="${encodeURIComponent(normFilePath)}" title="Cortar Silêncio & Sobrescrever Arquivo Original" style="color:var(--accent-red); width:22px; height:22px; font-size:10px; border:none; background:transparent;">
                                        <i class="fas fa-scissors"></i>
                                    </button>
                                ` : ''}
                            </div>
                        `;
                    });
                }

                html += `</div>`;
            }

            html += `</div>`;
            return html;
        };

        var htmlTreeNodes = userFolders.map(fPath => buildComposerTreeNode(fPath, 0)).join('');
        var htmlTree = `<div class="composer-tree-inner">` + htmlTreeNodes + `</div>`;
        
        // Add Bottom Folder Management Bar: Only shows when all folders are minimized
        var isAllMinimized = !anyFolderRenderedExpanded;
        if (isAllMinimized) {
            htmlTree += `
                <div class="composer-tree-actions-bar">
                    <button class="btn-tree-action" id="btn-tree-add-folder" title="Adicionar Nova Pasta de Áudio/Vídeo">
                        <i class="fas fa-folder-plus"></i> + Adicionar Pasta
                    </button>
                    <button class="btn-tree-action danger" id="btn-tree-remove-folder" title="Excluir/Remover Pasta Monitorada">
                        <i class="fas fa-trash-alt"></i> Excluir Pasta
                    </button>
                </div>
            `;
        }

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
                var fName = this.getPathBasename(fPath);
                if (confirm(`Deseja remover a pasta "${fName}" do Premiere Composer?`)) {
                    this.removeFolder(fPath);
                }
            });
        });

        // Bind Folder Row and Chevron Toggles
        container.querySelectorAll('.composer-tree-row.folder-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.btn-remove-root-folder')) return;
                var dirP = decodeURIComponent(row.getAttribute('data-main-folder'));
                var normDir = this.normalizePath(dirP);
                if (!this._userToggledNodes) this._userToggledNodes = new Set();
                this._userToggledNodes.add(normDir);

                if (this.expandedMainTreeNodes.has(normDir)) {
                    var normDirLower = normDir.toLowerCase();
                    var normDirPrefix = normDirLower + '/';
                    for (let node of Array.from(this.expandedMainTreeNodes)) {
                        var nodeLower = node.toLowerCase();
                        if (nodeLower === normDirLower || nodeLower.startsWith(normDirPrefix)) {
                            this.expandedMainTreeNodes.delete(node);
                            if (this._preSearchExpandedNodes) {
                                this._preSearchExpandedNodes.delete(node);
                            }
                        }
                    }
                } else {
                    this.expandedMainTreeNodes.add(normDir);
                    if (this._preSearchExpandedNodes) {
                        this._preSearchExpandedNodes.add(normDir);
                    }
                }
                this.renderFolderView(container);
            });
        });

        // Bind File Selection (Click) & Double-Click Insert
        container.querySelectorAll('.composer-tree-row.file-row').forEach(row => {
            var fPath = decodeURIComponent(row.getAttribute('data-file-path'));
            var normFPath = this.normalizePath(fPath).toLowerCase();
            var asset = this.allAssets.find(a => this.normalizePath(a.path).toLowerCase() === normFPath);

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

        // Bind Cut Silence in Tree View
        container.querySelectorAll('.btn-cut-silence-tree').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                var fPath = decodeURIComponent(btn.getAttribute('data-cut-path'));
                var normFPath = this.normalizePath(fPath).toLowerCase();
                var asset = this.allAssets.find(a => this.normalizePath(a.path).toLowerCase() === normFPath);
                if (asset && confirm(`Deseja cortar o silêncio e ajustar o Max Peak do arquivo "${asset.name}" SOBRESCREVENDO o arquivo original no disco?`)) {
                    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                    try {
                        var thresh = window.cacheMgr.getSetting('silenceThresholdDb', -45.0);
                        var targetMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
                        var selectMaxPeakPlayer = document.getElementById('select-max-peak-player');
                        if (selectMaxPeakPlayer) targetMaxPeak = parseFloat(selectMaxPeakPlayer.value);

                        window.audioEngine.stopAudioPreview();
                        var res = await window.audioEngine.cutSilenceAndReplaceFile(asset.path, thresh, targetMaxPeak);
                        
                        asset.path = this.normalizePath(res.targetPath);
                        asset.procData = res.procInfo;
                        asset.mtime = Date.now();
                        asset.name = this.getPathBasename(res.targetPath);

                        window.cacheMgr.setScannedIndex(this.allAssets);

                        // Update DOM elements in place
                        var row = btn.closest('.file-row');
                        if (row) {
                            row.setAttribute('data-file-path', encodeURIComponent(asset.path));
                            var titleEl = row.querySelector('.composer-title');
                            if (titleEl) titleEl.textContent = asset.name;
                            var favBtn = row.querySelector('.composer-fav-btn');
                            if (favBtn) favBtn.setAttribute('data-fav-path', encodeURIComponent(asset.path));
                        }
                        btn.setAttribute('data-cut-path', encodeURIComponent(asset.path));

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
     * Insert asset directly to Premiere Pro Timeline (Clean Import and Multi-Strategy Insertion)
     */
    async insertToTimeline(asset) {
        if (!asset || !asset.path) {
            this.showNotification("⚠️ Nenhum arquivo selecionado.");
            return;
        }

        // Normalize path slashes to prevent ExtendScript backslash escape character corruption
        var normalizedPath = asset.path.replace(/\\/g, '/');
        var assetType = asset.type || (normalizedPath.match(/\.(wav|mp3|m4a|aac|flac|ogg|aiff)$/i) ? 'sfx' : 'overlay');

        // Extract duration from procData or cache
        var assetDuration = 0;
        if (asset.procData && typeof asset.procData.duration === 'number' && asset.procData.duration > 0) {
            assetDuration = asset.procData.duration;
        } else {
            var cached = window.cacheMgr.getAudioCache(asset.path);
            if (cached && typeof cached.duration === 'number' && cached.duration > 0) {
                assetDuration = cached.duration;
            } else {
                var overlayCached = window.cacheMgr.getOverlayCache(asset.path);
                if (overlayCached && typeof overlayCached.duration === 'number' && overlayCached.duration > 0) {
                    assetDuration = overlayCached.duration;
                }
            }
        }

        var encodedPath = encodeURIComponent(normalizedPath);
        var scriptCall = `ComposerHost.importAndInsertAsset(decodeURIComponent("${encodedPath}"), "${assetType}", ${assetDuration || 0})`;
        
        this.csInterface.evalScript(scriptCall, (resultStr) => {
            try {
                if (!resultStr || resultStr === "undefined" || resultStr === "null") {
                    this.showNotification("⚠️ Sem resposta do Premiere Pro.");
                    return;
                }
                var res = JSON.parse(resultStr);
                if (res.success) {
                    this.showNotification("✨ " + (res.message || "Inserido na timeline!"));
                } else {
                    alert("Aviso Premiere: " + (res.error || "Não foi possível inserir o clipe."));
                }
            } catch (e) {
                console.log("Response from Premiere:", resultStr);
                if (resultStr && resultStr.indexOf("true") !== -1) {
                    this.showNotification("✨ Inserido na timeline com sucesso!");
                } else {
                    alert("Aviso Premiere: " + resultStr);
                }
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
