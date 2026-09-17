/**
 * Premiere Composer FX Studio - Cache & Persistence Manager
 * Uses Node.js `fs` in CEP environment with localStorage fallback.
 */

class CacheManager {
    constructor() {
        this.cacheFilePath = null;
        this.fs = null;
        this.path = null;
        
        this.data = {
            settings: {
                targetMaxPeakDb: -6.0,       // Max Peak Gain Target dB (Persisted!)
                silenceThresholdDb: -45.0,   // Silence detection threshold dB
                autoCutSilence: false,       // Auto cut silence on import
                minSilenceDuration: 0.05     // Safety padding seconds
            },
            folders: [],
            favorites: [],
            audioCache: {},                  // Waveform arrays, native peaks, silence bounds
            overlayCache: {},                // Video overlay thumbnails & metadata
            scannedIndex: []                 // Cached list of all scanned assets
        };

        this.initNodeModules();
        this.loadCache();
    }

    initNodeModules() {
        try {
            if (typeof require !== 'undefined') {
                this.fs = require('fs');
                this.path = require('path');

                var appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME);
                var cacheDir = this.path.join(appData, 'Adobe', 'CEP', 'extensions', 'com.composer.fxstudio', 'cache');
                
                if (!this.fs.existsSync(cacheDir)) {
                    this.fs.mkdirSync(cacheDir, { recursive: true });
                }

                this.cacheFilePath = this.path.join(cacheDir, 'composer_cache.json');
            }
        } catch (e) {
            console.warn("[CacheManager] Running in web mode (Node.js fs unavailable), using localStorage.");
        }
    }

    loadCache() {
        if (this.fs && this.cacheFilePath && this.fs.existsSync(this.cacheFilePath)) {
            try {
                var raw = this.fs.readFileSync(this.cacheFilePath, 'utf8');
                var parsed = JSON.parse(raw);
                this.data = Object.assign({}, this.data, parsed);
                // Ensure sub-objects exist
                if (!this.data.settings) this.data.settings = { targetMaxPeakDb: -6.0, silenceThresholdDb: -45.0 };
                if (!this.data.audioCache) this.data.audioCache = {};
                if (!this.data.overlayCache) this.data.overlayCache = {};
                if (!this.data.folders) this.data.folders = [];
                if (!this.data.favorites) this.data.favorites = [];
                console.log("[CacheManager] Loaded cache from disk:", this.cacheFilePath);
                return;
            } catch (err) {
                console.error("[CacheManager] Error reading cache file from disk:", err);
            }
        }

        // LocalStorage fallback
        try {
            var localData = localStorage.getItem('composer_fx_cache');
            if (localData) {
                var parsedLS = JSON.parse(localData);
                this.data = Object.assign({}, this.data, parsedLS);
            }
        } catch (eLS) {}
    }

    saveCache() {
        // Debounced save
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.forceSave();
        }, 300);
    }

    forceSave() {
        var jsonStr = JSON.stringify(this.data, null, 2);
        
        if (this.fs && this.cacheFilePath) {
            try {
                this.fs.writeFileSync(this.cacheFilePath, jsonStr, 'utf8');
                console.log("[CacheManager] Cache saved to disk.");
            } catch (err) {
                console.error("[CacheManager] Error writing cache file to disk:", err);
            }
        }

        try {
            localStorage.setItem('composer_fx_cache', jsonStr);
        } catch (eLS) {}
    }

    // Settings Getters & Setters
    getSetting(key, defaultValue) {
        if (this.data.settings && this.data.settings[key] !== undefined) {
            return this.data.settings[key];
        }
        return defaultValue;
    }

    setSetting(key, value) {
        if (!this.data.settings) this.data.settings = {};
        this.data.settings[key] = value;
        this.saveCache();
    }

    // Helper
    normalizePath(p) {
        if (!p) return '';
        return p.replace(/\\/g, '/').replace(/\/+$/, '');
    }

    // Folders
    getFolders() {
        return (this.data.folders || []).map(f => this.normalizePath(f));
    }

    addFolder(folderPath) {
        if (!folderPath) return false;
        var norm = this.normalizePath(folderPath);
        if (!this.data.folders) this.data.folders = [];
        var exists = this.data.folders.some(f => this.normalizePath(f).toLowerCase() === norm.toLowerCase());
        if (!exists) {
            this.data.folders.push(norm);
            this.saveCache();
            return true;
        }
        return false;
    }

    removeFolder(folderPath) {
        if (!folderPath || !this.data.folders) return;
        var norm = this.normalizePath(folderPath).toLowerCase();
        this.data.folders = this.data.folders.filter(f => this.normalizePath(f).toLowerCase() !== norm);
        this.saveCache();
    }

    // Favorites
    isFavorite(filePath) {
        if (!filePath || !this.data.favorites) return false;
        var norm = this.normalizePath(filePath).toLowerCase();
        return this.data.favorites.some(f => this.normalizePath(f).toLowerCase() === norm);
    }

    toggleFavorite(filePath) {
        if (!filePath) return false;
        if (!this.data.favorites) this.data.favorites = [];
        var norm = this.normalizePath(filePath);
        var normLower = norm.toLowerCase();
        var idx = this.data.favorites.findIndex(f => this.normalizePath(f).toLowerCase() === normLower);
        if (idx >= 0) {
            this.data.favorites.splice(idx, 1);
        } else {
            this.data.favorites.push(norm);
        }
        this.saveCache();
        return this.isFavorite(filePath);
    }

    // Audio Cache
    getAudioCache(filePath, mtime) {
        if (!filePath || !this.data.audioCache) return null;
        var norm = this.normalizePath(filePath);
        var entry = this.data.audioCache[norm] || this.data.audioCache[filePath];
        if (entry && entry.mtime === mtime) {
            return entry;
        }
        return null;
    }

    setAudioCache(filePath, mtime, cacheData) {
        if (!filePath) return;
        if (!this.data.audioCache) this.data.audioCache = {};
        var norm = this.normalizePath(filePath);
        this.data.audioCache[norm] = Object.assign({ mtime: mtime }, cacheData);
        this.saveCache();
    }

    invalidateAudioCache(filePath) {
        if (!filePath || !this.data.audioCache) return;
        var norm = this.normalizePath(filePath);
        delete this.data.audioCache[norm];
        delete this.data.audioCache[filePath];
        this.saveCache();
    }

    // Overlay Cache
    getOverlayCache(filePath, mtime) {
        if (!filePath || !this.data.overlayCache) return null;
        var norm = this.normalizePath(filePath);
        var entry = this.data.overlayCache[norm] || this.data.overlayCache[filePath];
        if (entry && entry.mtime === mtime) {
            return entry;
        }
        return null;
    }

    setOverlayCache(filePath, mtime, cacheData) {
        if (!filePath) return;
        if (!this.data.overlayCache) this.data.overlayCache = {};
        var norm = this.normalizePath(filePath);
        this.data.overlayCache[norm] = Object.assign({ mtime: mtime }, cacheData);
        this.saveCache();
    }

    // Scanned Index Cache
    getScannedIndex() {
        return this.data.scannedIndex || [];
    }

    setScannedIndex(assets) {
        this.data.scannedIndex = assets || [];
        this.saveCache();
    }
}

// Global Singleton Instance
window.cacheMgr = new CacheManager();
