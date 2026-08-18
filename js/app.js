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
    renderCurrentView(isAppend = false) {
        var container = document.getElementById('grid-assets');
        var breadcrumbBox = document.getElementById('breadcrumb-container');
        var sectionTitle = document.getElementById('section-title');
        var countDisplay = document.getElementById('asset-count-display');

        if (!container) return;

        if (countDisplay) {
            countDisplay.textContent = `${this.filteredAssets.length.toLocaleString()} itens`;
        }

        // Handle Folder Navigation Header & Breadcrumbs
        if (this.viewMode === 'folder') {
            if (breadcrumbBox) {
                breadcrumbBox.style.display = 'flex';
                this.renderBreadcrumbs();
            }
            if (sectionTitle) sectionTitle.textContent = "Navegador por Pastas";
            
            this.renderFolderView(container);
            return;
        } else {
            if (breadcrumbBox) breadcrumbBox.style.display = 'none';
            if (sectionTitle) {
                if (this.selectedSidebarFolder) {
                    var pathLib = typeof require !== 'undefined' ? require('path') : null;
                    var folderName = pathLib ? pathLib.basename(this.selectedSidebarFolder) : this.selectedSidebarFolder.split(/[\/\\]/).pop();
                    sectionTitle.textContent = `Pasta: ${folderName}`;
                } else {
                    sectionTitle.textContent = this.viewMode === 'list' ? "Lista de Assets" : "Navegador de Assets";
                }
            }
        }

        var visibleSlice = this.filteredAssets.slice(0, this.renderedCount);

        if (visibleSlice.length === 0) {
            container.className = 'grid-assets';
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="fas fa-folder-open empty-icon"></i>
                    <h3>Nenhum efeito ou overlay encontrado</h3>
                    <p>Adicione pastas de áudios ou mude os filtros de pesquisa.</p>
                </div>
            `;
            return;
        }

        if (this.viewMode === 'list') {
            container.className = 'asset-list-container';
            this.renderAssetList(visibleSlice, container);
        } else {
            container.className = 'grid-assets';
            this.renderAssetGrid(visibleSlice, container);
        }
    }

    /**
     * Render Full File Tree Explorer in Main View (Estilo Premiere Composer Oficial)
     */
    renderFolderView(container) {
        container.className = 'composer-tree-view';
        var pathLib = typeof require !== 'undefined' ? require('path') : null;
        var userFolders = window.cacheMgr.getFolders();

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
                                <i class="${isFav ? 'fas' : 'far'} fa-star"></i>
                            </span>
                            <span class="composer-file-icon ${isAudio ? '' : 'overlay'}">
                                <i class="${isAudio ? 'fas fa-wave-square' : 'fas fa-film'}"></i>
                            </span>
                            <span class="composer-title">${fileAsset.name}</span>
                            <button class="btn-insert" style="padding: 3px 10px; font-size:10px;" data-insert-path="${encodeURIComponent(fileAsset.path)}">
                                <i class="fas fa-plus"></i> Inserir
                            </button>
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

        // Bind File Selection & Insert
        container.querySelectorAll('.composer-tree-row.file-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.composer-fav-btn') || e.target.closest('.btn-insert')) return;
                var fPath = decodeURIComponent(row.getAttribute('data-file-path'));
                var asset = this.allAssets.find(a => a.path === fPath);
                if (asset) {
                    this.selectedAsset = asset;
                    // Highlight selected row
                    container.querySelectorAll('.composer-tree-row.file-row').forEach(r => r.classList.remove('selected'));
                    row.classList.add('selected');
                    // Play preview & update player bar
                    this.playAudioPreview(asset, null, null);
                }
            });
        });

        // Bind Insert Button in Tree
        container.querySelectorAll('.btn-insert[data-insert-path]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                var fPath = decodeURIComponent(btn.getAttribute('data-insert-path'));
                var asset = this.allAssets.find(a => a.path === fPath);
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
     */
    renderAssetList(assets, container) {
        container.innerHTML = assets.map((asset, idx) => {
            var isFav = window.cacheMgr.isFavorite(asset.path);
            var isAudio = asset.type === 'sfx';

            return `
                <div class="asset-list-row" data-index="${idx}" data-path="${encodeURIComponent(asset.path)}">
                    <div class="list-col-type">
                        <i class="${isAudio ? 'fas fa-music' : 'fas fa-film'}" style="color:${isAudio ? 'var(--accent-emerald)' : 'var(--accent-cyan)'}"></i>
                    </div>

                    <div class="list-col-play">
                        ${isAudio ? `
                            <button class="btn-icon btn-play" title="Ouvir Preview">
                                <i class="fas fa-play"></i>
                            </button>
                        ` : ''}
                    </div>

                    <div class="list-col-info">
                        <span class="list-asset-name" title="${asset.name}">${asset.name}</span>
                        <span class="list-asset-path" title="${asset.path}">${asset.path}</span>
                    </div>

                    <div class="list-col-meta">
                        <span class="list-dur-badge" id="dur-list-${idx}">--:--</span>
                        ${isAudio ? `<span class="list-peak-badge" id="peak-list-${idx}">-.- dB</span>` : ''}
                    </div>

                    <div class="list-col-actions">
                        <button class="btn-icon btn-fav ${isFav ? 'active' : ''}" title="Favorito">
                            <i class="${isFav ? 'fas' : 'far'} fa-star" style="${isFav ? 'color:#f59e0b' : ''}"></i>
                        </button>
                        
                        ${isAudio ? `
                            <button class="btn-icon btn-cut-silence" title="Cortar Silêncio e Substituir Arquivo" style="color:var(--accent-red);">
                                <i class="fas fa-scissors"></i>
                            </button>
                        ` : ''}

                        <button class="btn-insert" title="Inserir na Timeline do Premiere">
                            <i class="fas fa-plus"></i> Inserir
                        </button>
                    </div>
                </div>
            `;
        }).join('');

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
                                var res = await window.audioEngine.cutSilenceAndReplaceFile(asset.path, thresh);
                                
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
    }

    playAudioPreview(asset, canvas, btnPlay) {
        var btnMain = document.getElementById('btn-play-main');
        var playerTitle = document.getElementById('player-title');
        
        // If clicking on the asset that is CURRENTLY playing, pause/stop it!
        if (window.audioEngine.currentSoundPath === asset.path) {
            window.audioEngine.stopAudioPreview();
            if (btnPlay) btnPlay.innerHTML = `<i class="fas fa-play"></i>`;
            if (btnMain) btnMain.innerHTML = `<i class="fas fa-play"></i>`;
            if (canvas && asset.procData) {
                window.audioEngine.drawWaveform(canvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
            }
            return;
        }

        // Reset previous buttons if another sound was playing
        document.querySelectorAll('.btn-play').forEach(btn => {
            btn.innerHTML = `<i class="fas fa-play"></i>`;
        });

        if (playerTitle) playerTitle.textContent = asset.name;
        if (btnMain) btnMain.innerHTML = `<i class="fas fa-stop"></i>`;
        if (btnPlay) btnPlay.innerHTML = `<i class="fas fa-stop"></i>`;

        window.audioEngine.playAudioPreview(asset.path, (pct, elapsed, duration) => {
            if (canvas && asset.procData) {
                window.audioEngine.drawWaveform(canvas, asset.procData.waveform, pct, asset.procData.silenceStartSec, asset.procData.silenceEndSec, duration);
            }
        }, () => {
            if (btnPlay) btnPlay.innerHTML = `<i class="fas fa-play"></i>`;
            if (btnMain) btnMain.innerHTML = `<i class="fas fa-play"></i>`;
            if (canvas && asset.procData) {
                window.audioEngine.drawWaveform(canvas, asset.procData.waveform, 0, asset.procData.silenceStartSec, asset.procData.silenceEndSec, asset.procData.duration);
            }
        });
    }

    async insertToTimeline(asset) {
        var targetMaxPeak = window.cacheMgr.getSetting('targetMaxPeakDb', -6.0);

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

document.addEventListener('DOMContentLoaded', () => {
    window.app = new ComposerApp();
});
