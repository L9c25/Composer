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
        var btnPlayMain = document.getElementById('btn-play-main');

        if (sliderPitch && valPitch) {
            sliderPitch.addEventListener('input', (e) => {
                this.pitchSemitones = parseInt(e.target.value, 10) || 0;
                valPitch.textContent = this.pitchSemitones > 0 ? `+${this.pitchSemitones}` : `${this.pitchSemitones}`;
                if (this.selectedAsset && window.audioEngine.currentSoundPath === this.selectedAsset.path) {
                    this.playAudioPreview(this.selectedAsset, null, null);
                }
            });
        }

        if (btnResetPitch) {
            btnResetPitch.addEventListener('click', () => {
                this.pitchSemitones = 0;
                if (sliderPitch) sliderPitch.value = 0;
                if (valPitch) valPitch.textContent = "0";
                if (this.selectedAsset && window.audioEngine.currentSoundPath === this.selectedAsset.path) {
                    this.playAudioPreview(this.selectedAsset, null, null);
                }
            });
        }

        if (chkReverse) {
            chkReverse.addEventListener('change', (e) => {
                this.isReverse = e.target.checked;
                if (this.selectedAsset && window.audioEngine.currentSoundPath === this.selectedAsset.path) {
                    this.playAudioPreview(this.selectedAsset, null, null);
                }
            });
        }

        if (btnPlayMain) {
            btnPlayMain.addEventListener('click', () => {
                if (this.selectedAsset) {
                    this.playAudioPreview(this.selectedAsset, null, null);
                } else if (this.allAssets.length > 0) {
                    this.playAudioPreview(this.allAssets[0], null, null);
                }
            });
        }

        this.renderFoldersList();
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

        // Navigation Category Tabs (All, SFX, Overlays, Favorites)
        var tabBtns = document.querySelectorAll('.nav-item[data-filter]');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                tabBtns.forEach(b => b.classList.remove('active'));
                var target = e.currentTarget;
                target.classList.add('active');
                this.currentFilter = target.getAttribute('data-filter');
                this.selectedSidebarFolder = null; // Clear sidebar folder selection to view category across all folders
                this.renderFoldersList();
                this.applyFiltersAndRender();
            });
        });

        // View Mode Switcher (Grid, List, Folder)
        var viewBtns = document.querySelectorAll('.btn-view-mode[data-view]');
        viewBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                viewBtns.forEach(b => b.classList.remove('active'));
                var target = e.currentTarget;
                target.classList.add('active');
                this.viewMode = target.getAttribute('data-view');
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

        // Global Audio Play/Pause Button in Player
        var btnPlayMain = document.getElementById('btn-play-main');
        if (btnPlayMain && !btnPlayMain._boundPlay) {
            btnPlayMain._boundPlay = true;
            btnPlayMain.addEventListener('click', () => {
                var targetAsset = this.selectedAsset || (this.allAssets.length > 0 ? this.allAssets[0] : null);
                if (targetAsset) {
                    this.playAudioPreview(targetAsset, null, null, 0);
                }
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
     * Folder Selection via File Dialog / Node fs
     */
    promptAddFolder() {
        if (typeof require !== 'undefined') {
            try {
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
     * Non-Blocking Async Folder Scanner with Progress Bar for +10GB / Thousands of Audios
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

        // Refresh sidebar tree to populate subfolder structure and item counts
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

            // Sidebar Folder Filter (Subfolder Tree Selection)
            if (this.selectedSidebarFolder) {
                if (!asset.path.startsWith(this.selectedSidebarFolder)) return false;
            }

            // Query search
            if (query) {
                var matchName = asset.name.toLowerCase().includes(query);
                var matchPath = asset.path.toLowerCase().includes(query);
                if (!matchName && !matchPath) return false;
            }

            // Subfolder Navigation Filter (for Folder View in main content)
            if (this.currentFolderNav && !query && !this.selectedSidebarFolder) {
                var pathLib = typeof require !== 'undefined' ? require('path') : null;
                if (pathLib) {
                    if (!asset.path.startsWith(this.currentFolderNav)) return false;
                }
            }

            return true;
        });

        this.renderedCount = this.pageSize;
        this.renderCurrentView();
    }

    /**
     * Main View Dispatcher (Grid, List, Folder Tree)
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
                <div class="empty-state" style="padding:40px;">
                    <i class="fas fa-folder-plus empty-icon"></i>
                    <h3>Nenhuma pasta local vinculada</h3>
                    <p>Clique em "+ Adicionar Pasta" na barra lateral para começar.</p>
                </div>
            `;
            return;
        }

        // Expanded tree nodes set for main view
        if (!this.expandedMainTreeNodes) {
            this.expandedMainTreeNodes = new Set(userFolders);
        }

        var buildComposerTreeNode = (dirPath) => {
            var name = pathLib ? pathLib.basename(dirPath) : dirPath.split(/[\/\\]/).pop();
            var isExpanded = this.expandedMainTreeNodes.has(dirPath);

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
                                <button class="btn-icon btn-cut-silence-tree" data-cut-path="${encodeURIComponent(fileAsset.path)}" title="Cortar Silêncio" style="color:var(--accent-red); width:22px; height:22px; font-size:10px; border:none; background:transparent;">
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

        var htmlTree = userFolders.map(fPath => buildComposerTreeNode(fPath)).join('');
        container.innerHTML = htmlTree;

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
                    // Highlight selected row
                    container.querySelectorAll('.composer-tree-row.file-row').forEach(r => r.classList.remove('selected'));
                    row.classList.add('selected');
                    // Autoplay & draw waveform canvas in bottom player bar
                    this.playAudioPreview(asset, null, null, 0);
                }
            });

            row.addEventListener('dblclick', (e) => {
                if (asset) {
                    this.insertToTimeline(asset);
                }
            });
        });

        // Bind Cut Silence in Tree View
        container.querySelectorAll('.btn-cut-silence-tree').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                var fPath = decodeURIComponent(btn.getAttribute('data-cut-path'));
                var asset = this.allAssets.find(a => a.path === fPath);
                if (asset && confirm(`Deseja cortar o silêncio do arquivo "${asset.name}" e salvar em formato WAV limpo?`)) {
                    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                    try {
                        var thresh = window.cacheMgr.getSetting('silenceThresholdDb', -45.0);
                        var targetMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
                        var res = await window.audioEngine.cutSilenceAndReplaceFile(asset.path, thresh, targetMaxPeak);
                        asset.path = res.targetPath;
                        asset.procData = res.procInfo;
                        asset.mtime = Date.now();
                        btn.innerHTML = `<i class="fas fa-check" style="color:var(--accent-green-bright);"></i>`;
                        setTimeout(() => { btn.innerHTML = `<i class="fas fa-scissors"></i>`; }, 2000);
                        this.renderFolderView(container);
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

    renderBreadcrumbs() {
        var box = document.getElementById('breadcrumb-container');
        if (!box) return;

        var pathLib = typeof require !== 'undefined' ? require('path') : null;
        var activePath = this.currentFolderNav || this.selectedSidebarFolder;
        var html = `<span class="breadcrumb-item ${!activePath ? 'active' : ''}" id="bc-root"><i class="fas fa-home"></i> Raiz</span>`;

        if (activePath) {
            var parts = activePath.split(/[\/\\]/).filter(Boolean);
            var accumPath = "";

            parts.forEach((part, idx) => {
                if (idx === 0 && activePath.includes(':')) {
                    accumPath = part + '\\';
                } else {
                    accumPath = pathLib ? pathLib.join(accumPath, part) : accumPath + '/' + part;
                }

                var isLast = (idx === parts.length - 1);
                html += ` <span class="breadcrumb-sep"><i class="fas fa-chevron-right"></i></span> `;
                html += `<span class="breadcrumb-item ${isLast ? 'active' : ''}" data-bc-path="${encodeURIComponent(accumPath)}">${part}</span>`;
            });
        }

        box.innerHTML = html;

        var bcRoot = document.getElementById('bc-root');
        if (bcRoot) {
            bcRoot.addEventListener('click', () => {
                this.currentFolderNav = null;
                this.selectedSidebarFolder = null;
                this.renderFoldersList();
                this.applyFiltersAndRender();
            });
        }

        box.querySelectorAll('.breadcrumb-item[data-bc-path]').forEach(item => {
            item.addEventListener('click', () => {
                var targetPath = decodeURIComponent(item.getAttribute('data-bc-path'));
                this.currentFolderNav = targetPath;
                this.selectedSidebarFolder = targetPath;
                this.renderFoldersList();
                this.applyFiltersAndRender();
            });
        });
    }

    /**
     * Render Compact List View (Estilo Premiere Composer)
     * Inclui exibição de pastas e subpastas no topo da lista
     */
    renderAssetList(assets, container) {
        var pathLib = typeof require !== 'undefined' ? require('path') : null;
        var activeFolder = this.selectedSidebarFolder || this.currentFolderNav;
        var subfolderPaths = new Set();

        if (activeFolder) {
            this.allAssets.forEach(a => {
                if (a.path.startsWith(activeFolder) && a.path !== activeFolder) {
                    var rel = a.path.substring(activeFolder.length).replace(/^[\/\\]/, '');
                    var parts = rel.split(/[\/\\]/);
                    if (parts.length > 1) {
                        var childSub = pathLib ? pathLib.join(activeFolder, parts[0]) : activeFolder + '/' + parts[0];
                        subfolderPaths.add(childSub);
                    }
                }
            });
        } else {
            // Render root user folders if no specific sidebar folder is selected
            var rootFolders = window.cacheMgr.getFolders();
            rootFolders.forEach(fP => subfolderPaths.add(fP));
        }

        var subfolders = Array.from(subfolderPaths).sort();
        var html = "";

        // Render Subfolders at top of List View if present
        subfolders.forEach(subP => {
            var fName = pathLib ? pathLib.basename(subP) : subP.split(/[\/\\]/).pop();
            var count = this.allAssets.filter(a => a.path.startsWith(subP)).length;

            html += `
                <div class="asset-list-row folder-list-row" data-subfolder-path="${encodeURIComponent(subP)}" style="cursor:pointer; background:rgba(245, 158, 11, 0.08); border-left: 3px solid #f59e0b;">
                    <span style="width:14px;"></span>
                    <div class="list-col-type">
                        <i class="fas fa-folder" style="color:#f59e0b;"></i>
                    </div>
                    <div class="list-col-info">
                        <span class="list-asset-name" style="font-weight:600; color:#fff;">${fName}</span>
                    </div>
                    <div class="list-col-meta">
                        <span class="composer-count-badge" style="color:#f59e0b; background:rgba(245, 158, 11, 0.12);">${count} itens</span>
                    </div>
                </div>
            `;
        });

        // Render Files
        html += assets.map((asset, idx) => {
            var isFav = window.cacheMgr.isFavorite(asset.path);
            var isAudio = asset.type === 'sfx';

            return `
                <div class="asset-list-row" data-index="${idx}" data-path="${encodeURIComponent(asset.path)}">
                    <span class="composer-fav-btn btn-fav ${isFav ? 'active' : ''}" data-fav-path="${encodeURIComponent(asset.path)}">
                        <i class="${isFav ? 'fas' : 'far'} fa-star" style="${isFav ? 'color:#f59e0b' : ''}"></i>
                    </span>

                    <div class="list-col-type">
                        <i class="${isAudio ? 'fas fa-wave-square' : 'fas fa-film'}" style="color:${isAudio ? 'var(--accent-emerald)' : 'var(--accent-cyan)'}"></i>
                    </div>

                    <div class="list-col-info">
                        <span class="list-asset-name" title="${asset.name}">${asset.name}</span>
                    </div>

                    <div class="list-col-meta">
                        <span class="list-dur-badge" id="dur-list-${idx}">--:--</span>
                        ${isAudio ? `<span class="list-peak-badge" id="peak-list-${idx}">-.- dB</span>` : ''}
                    </div>

                    <div class="list-col-actions">
                        ${isAudio ? `
                            <button class="btn-icon btn-cut-silence" title="Cortar Silêncio e Substituir Arquivo" style="color:var(--accent-red); width:24px; height:24px; font-size:11px; border:none; background:transparent;">
                                <i class="fas fa-scissors"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // Bind Subfolder click navigation
        container.querySelectorAll('.folder-list-row[data-subfolder-path]').forEach(row => {
            row.addEventListener('click', () => {
                var subP = decodeURIComponent(row.getAttribute('data-subfolder-path'));
                this.selectedSidebarFolder = subP;
                this.currentFolderNav = subP;
                this.renderFoldersList();
                this.applyFiltersAndRender();
            });
        });

        this.bindAssetInteractions(assets, container, true);
    }

    /**
     * Render Asset Grid Cards View (Current Visual Mode)
     */
    renderAssetGrid(assets, container) {
        container.innerHTML = assets.map((asset, idx) => {
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

        this.bindAssetInteractions(assets, container, false);
    }

    /**
     * Event & Waveform Handler Binding for Grid & List Elements
     */
    bindAssetInteractions(assets, container, isList = false) {
        assets.forEach((asset, idx) => {
            var itemEl = container.children[idx];
            if (!itemEl) return;

            var btnFav = itemEl.querySelector('.btn-fav');
            if (btnFav) {
                btnFav.addEventListener('click', (e) => {
                    e.stopPropagation();
                    var isNowFav = window.cacheMgr.toggleFavorite(asset.path);
                    btnFav.innerHTML = `<i class="${isNowFav ? 'fas' : 'far'} fa-star" style="${isNowFav ? 'color:#f59e0b' : ''}"></i>`;
                });
            }

            var btnInsert = itemEl.querySelector('.btn-insert');
            if (btnInsert) {
                btnInsert.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.insertToTimeline(asset);
                });
            }

            if (asset.type === 'sfx') {
                var durTag = itemEl.querySelector(isList ? `#dur-list-${idx}` : `#dur-${idx}`);
                var peakTag = itemEl.querySelector(isList ? `#peak-list-${idx}` : `#peak-${idx}`);
                var btnPlay = itemEl.querySelector('.btn-play');
                var btnCutSilence = itemEl.querySelector('.btn-cut-silence');
                var canvas = isList ? null : itemEl.querySelector(`#canvas-${idx}`);

                var cached = window.cacheMgr.getAudioCache(asset.path, asset.mtime);
                if (cached) {
                    if (durTag) durTag.textContent = this.formatTime(cached.duration);
                    if (peakTag) peakTag.textContent = `${cached.nativePeakDb} dB`;
                    if (canvas) window.audioEngine.drawWaveform(canvas, cached.waveform, 0, cached.silenceStartSec, cached.silenceEndSec, cached.duration);
                    asset.procData = cached;
                } else {
                    window.audioEngine.decodeAudioFile(asset.path).then(audioBuf => {
                        var proc = window.audioEngine.processAudioBuffer(audioBuf);
                        window.cacheMgr.setAudioCache(asset.path, asset.mtime, proc);
                        if (durTag) durTag.textContent = this.formatTime(proc.duration);
                        if (peakTag) peakTag.textContent = `${proc.nativePeakDb} dB`;
                        if (canvas) window.audioEngine.drawWaveform(canvas, proc.waveform, 0, proc.silenceStartSec, proc.silenceEndSec, proc.duration);
                        asset.procData = proc;
                    }).catch(() => {});
                }

                if (btnPlay) {
                    btnPlay.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.playAudioPreview(asset, canvas, btnPlay);
                    });
                }

                if (btnCutSilence) {
                    btnCutSilence.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (confirm(`Deseja cortar o silêncio do arquivo "${asset.name}" e salvar em formato WAV limpo?`)) {
                            btnCutSilence.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                            try {
                                var thresh = window.cacheMgr.getSetting('silenceThresholdDb', -45.0);
                                var targetMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
                                var res = await window.audioEngine.cutSilenceAndReplaceFile(asset.path, thresh, targetMaxPeak);
                                
                                asset.path = res.targetPath;
                                asset.procData = res.procInfo;
                                asset.mtime = Date.now();
                                if (typeof require !== 'undefined') {
                                    asset.name = require('path').basename(res.targetPath);
                                }

                                if (durTag) durTag.textContent = this.formatTime(res.procInfo.duration);
                                if (peakTag) peakTag.textContent = `${res.procInfo.nativePeakDb} dB`;
                                if (canvas) window.audioEngine.drawWaveform(canvas, res.procInfo.waveform, 0, res.procInfo.silenceStartSec, res.procInfo.silenceEndSec, res.procInfo.duration);
                                
                                btnCutSilence.innerHTML = `<i class="fas fa-check" style="color:var(--accent-green-bright);"></i>`;
                                setTimeout(() => { btnCutSilence.innerHTML = `<i class="fas fa-scissors"></i>`; }, 2000);
                            } catch (errCut) {
                                alert("Erro ao cortar silêncio: " + errCut.message);
                                btnCutSilence.innerHTML = `<i class="fas fa-scissors"></i>`;
                            }
                        }
                    });
                }
            } else if (!isList) {
                var thumbImg = itemEl.querySelector(`#thumb-${idx}`);
                var durTagVideo = itemEl.querySelector(`#dur-${idx}`);
                
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

                window.overlayEngine.setupHoverScrub(itemEl, asset.path);
            }
        });

        var mainCanvas = document.getElementById('player-waveform-canvas');
        if (mainCanvas && !mainCanvas._boundSeek) {
            mainCanvas._boundSeek = true;
            
            var isDraggingSeek = false;
            var performSeek = (e) => {
                if (this.selectedAsset && this.selectedAsset.type === 'sfx') {
                    var rect = mainCanvas.getBoundingClientRect();
                    var clickX = e.clientX - rect.left;
                    var pct = Math.max(0, Math.min(0.99, clickX / rect.width));
                    this.playAudioPreview(this.selectedAsset, null, null, pct);
                }
            };

            mainCanvas.addEventListener('pointerdown', (e) => {
                isDraggingSeek = true;
                try { mainCanvas.setPointerCapture(e.pointerId); } catch (errP) {}
                performSeek(e);
            });

            mainCanvas.addEventListener('pointermove', (e) => {
                if (isDraggingSeek) {
                    performSeek(e);
                }
            });

            var stopSeek = (e) => {
                if (isDraggingSeek) {
                    isDraggingSeek = false;
                    try { mainCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
                }
            };

            mainCanvas.addEventListener('pointerup', stopSeek);
            mainCanvas.addEventListener('pointercancel', stopSeek);
        }

        this.renderFoldersList();
    }

    selectAndDrawPlayerAsset(asset) {
        this.selectedAsset = asset;
        var playerTitle = document.getElementById('player-title');
        var mainCanvas = document.getElementById('player-waveform-canvas');

        if (playerTitle) playerTitle.textContent = asset.name;

        if (mainCanvas && asset.type === 'sfx') {
            if (asset.procData) {
                window.audioEngine.drawWaveform(mainCanvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
            } else {
                var cached = window.cacheMgr.getAudioCache(asset.path, asset.mtime);
                if (cached) {
                    asset.procData = cached;
                    window.audioEngine.drawWaveform(mainCanvas, cached.waveform, 0, cached.silenceStartSec, cached.silenceEndSec, cached.duration);
                } else {
                    window.audioEngine.decodeAudioFile(asset.path).then(audioBuf => {
                        var proc = window.audioEngine.processAudioBuffer(audioBuf);
                        window.cacheMgr.setAudioCache(asset.path, asset.mtime, proc);
                        asset.procData = proc;
                        window.audioEngine.drawWaveform(mainCanvas, proc.waveform, 0, proc.silenceStartSec, proc.silenceEndSec, proc.duration);
                    }).catch(() => {});
                }
            }
        }
    }

    playAudioPreview(asset, canvas, btnPlay, startPercent = 0) {
        var btnMain = document.getElementById('btn-play-main');
        var playerTitle = document.getElementById('player-title');
        var mainCanvas = document.getElementById('player-waveform-canvas');

        var isCurrentlyPlaying = false;
        if (window.audioEngine.currentSound && window.audioEngine.currentSoundPath && asset && asset.path) {
            var path1 = window.audioEngine.currentSoundPath.replace(/\\/g, '/').toLowerCase();
            var path2 = asset.path.replace(/\\/g, '/').toLowerCase();
            if (path1 === path2) {
                isCurrentlyPlaying = true;
            }
        }

        this.selectAndDrawPlayerAsset(asset);

        // If clicking on the asset that is CURRENTLY playing (and not seeking), pause/stop it!
        if (isCurrentlyPlaying && startPercent === 0) {
            window.audioEngine.stopAudioPreview();
            if (btnPlay) btnPlay.innerHTML = `<i class="fas fa-play"></i>`;
            if (btnMain) btnMain.innerHTML = `<i class="fas fa-play"></i>`;
            if (canvas && asset.procData) {
                window.audioEngine.drawWaveform(canvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
            }
            if (mainCanvas && asset.procData) {
                window.audioEngine.drawWaveform(mainCanvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
            }
            return;
        }

        // Reset previous buttons if another sound was playing
        document.querySelectorAll('.btn-play').forEach(btn => {
            btn.innerHTML = `<i class="fas fa-play"></i>`;
        });

        if (playerTitle) playerTitle.textContent = asset.name;
        if (btnMain) btnMain.innerHTML = `<i class="fas fa-pause"></i>`;
        if (btnPlay) btnPlay.innerHTML = `<i class="fas fa-pause"></i>`;

        window.audioEngine.playAudioPreview(asset.path, this.pitchSemitones, this.isReverse, (pct, elapsed, duration) => {
            if (canvas && asset.procData) {
                window.audioEngine.drawWaveform(canvas, asset.procData.waveform, pct, asset.procData.silenceStartSec, asset.procData.silenceEndSec, duration);
            }
            if (mainCanvas && asset.procData) {
                window.audioEngine.drawWaveform(mainCanvas, asset.procData.waveform, pct, asset.procData.silenceStartSec, asset.procData.silenceEndSec, duration);
            }
        }, () => {
            if (btnPlay) btnPlay.innerHTML = `<i class="fas fa-play"></i>`;
            if (btnMain) btnMain.innerHTML = `<i class="fas fa-play"></i>`;
            if (canvas && asset.procData) {
                window.audioEngine.drawWaveform(canvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
            }
            if (mainCanvas && asset.procData) {
                window.audioEngine.drawWaveform(mainCanvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
            }
        }, startPercent);
    }

    async insertToTimeline(asset) {
        var targetMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);
        var selectMaxPeakPlayer = document.getElementById('select-max-peak-player');
        if (selectMaxPeakPlayer) {
            targetMaxPeak = parseFloat(selectMaxPeakPlayer.value);
        }

        // Ensure procData and nativePeakDb are computed prior to script call
        if (!asset.procData && asset.type === 'sfx') {
            var cached = window.cacheMgr.getAudioCache(asset.path, asset.mtime);
            if (cached) {
                asset.procData = cached;
            } else {
                try {
                    var audioBuf = await window.audioEngine.decodeAudioFile(asset.path);
                    var proc = window.audioEngine.processAudioBuffer(audioBuf);
                    window.cacheMgr.setAudioCache(asset.path, asset.mtime, proc);
                    asset.procData = proc;
                } catch (e) {}
            }
        }

        var nativePeak = (asset.procData && asset.procData.nativePeakDb !== undefined) ? asset.procData.nativePeakDb : -6.0;

        // Generate audio file with Pitch, Reverse & Max Peak PCM Normalization applied
        var insertPath = asset.path;
        if (asset.type === 'sfx') {
            try {
                insertPath = await window.audioEngine.generateProcessedWAV(asset.path, this.pitchSemitones, this.isReverse, targetMaxPeak);
            } catch (eProc) {
                console.error("Error generating processed WAV:", eProc);
            }
        }

        var scriptCall = `ComposerHost.importAndInsertAsset(${JSON.stringify(insertPath)}, ${JSON.stringify(asset.type)}, ${targetMaxPeak}, ${nativePeak}, 0, false)`;
        
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

document.addEventListener('DOMContentLoaded', () => {
    window.app = new ComposerApp();
});
