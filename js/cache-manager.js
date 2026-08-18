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
            overlayCache: {}                 // Video overlay thumbnails & metadata
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

    // Folders
    getFolders() {
        return this.data.folders || [];
    }

    addFolder(folderPath) {
        if (!this.data.folders.includes(folderPath)) {
            this.data.folders.push(folderPath);
            this.saveCache();
            return true;
        }
        return false;
    }

    removeFolder(folderPath) {
        this.data.folders = this.data.folders.filter(f => f !== folderPath);
        this.saveCache();
    }

    // Favorites
    isFavorite(filePath) {
        return (this.data.favorites || []).includes(filePath);
    }

    toggleFavorite(filePath) {
        if (!this.data.favorites) this.data.favorites = [];
        var idx = this.data.favorites.indexOf(filePath);
        if (idx >= 0) {
            this.data.favorites.splice(idx, 1);
        } else {
            this.data.favorites.push(filePath);
        }
        this.saveCache();
        return this.isFavorite(filePath);
    }

    // Audio Cache
    getAudioCache(filePath, mtime) {
        var entry = this.data.audioCache[filePath];
        if (entry && entry.mtime === mtime) {
            return entry;
        }
        return null;
    }

    setAudioCache(filePath, mtime, cacheData) {
        this.data.audioCache[filePath] = Object.assign({ mtime: mtime }, cacheData);
        this.saveCache();
    }

    invalidateAudioCache(filePath) {
        delete this.data.audioCache[filePath];
        this.saveCache();
    }

    // Overlay Cache
    getOverlayCache(filePath, mtime) {
        var entry = this.data.overlayCache[filePath];
        if (entry && entry.mtime === mtime) {
            return entry;
        }
        return null;
    }

    setOverlayCache(filePath, mtime, cacheData) {
        this.data.overlayCache[filePath] = Object.assign({ mtime: mtime }, cacheData);
        this.saveCache();
    }
}

// Global Singleton Instance
window.cacheMgr = new CacheManager();
