/**
 * Premiere Composer FX Studio - GitHub Auto-Updater
 * Checks GitHub repository for updates and performs 1-click self-updating
 */

class UpdaterManager {
    constructor(appInstance) {
        this.app = appInstance;
        this.repoOwner = 'L9c25';
        this.repoName = 'Composer';
        this.currentVersion = '26.3.3';
        this.apiUrl = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits/main`;
        this.isChecking = false;
        this.isUpdating = false;
        this.hasNode = typeof window.require === 'function';
    }

    /**
     * Initialize updater and trigger a quiet background check
     */
    init() {
        this.bindEvents();
        // Check after 3 seconds of startup quietly
        setTimeout(() => {
            this.checkForUpdates(false);
        }, 3000);
    }

    bindEvents() {
        var btnCheck = document.getElementById('btn-check-updates');
        if (btnCheck) {
            btnCheck.addEventListener('click', () => this.checkForUpdates(true));
        }

        var btnUpdateNow = document.getElementById('btn-update-now');
        if (btnUpdateNow) {
            btnUpdateNow.addEventListener('click', () => this.applyUpdate());
        }

        var btnDismiss = document.getElementById('btn-dismiss-update');
        if (btnDismiss) {
            btnDismiss.addEventListener('click', () => {
                var banner = document.getElementById('update-notification-banner');
                if (banner) banner.style.display = 'none';
            });
        }
    }

    /**
     * Get current extension folder path
     */
    getExtensionPath() {
        if (this.hasNode) {
            try {
                return window.__dirname || (typeof process !== 'undefined' ? process.cwd() : '');
            } catch (e) {}
        }
        return '';
    }

    /**
     * Check if a new commit or version exists on GitHub
     */
    async checkForUpdates(manual = false) {
        if (this.isChecking || this.isUpdating) return;
        this.isChecking = true;

        var btnCheck = document.getElementById('btn-check-updates');
        if (btnCheck && manual) {
            btnCheck.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Verificando...`;
        }

        try {
            var localSha = await this.getLocalCommitSha();
            var remoteInfo = await this.getRemoteLatestCommit();

            if (!remoteInfo || !remoteInfo.sha) {
                if (manual) {
                    this.showToast("⚠️ Não foi possível consultar o GitHub. Verifique sua conexão.");
                }
                return;
            }

            var remoteSha = remoteInfo.sha.substring(0, 7);
            var commitMsg = remoteInfo.commit ? remoteInfo.commit.message.split('\n')[0] : 'Nova versão disponível';

            // Compare local vs remote
            var isOutdated = false;
            if (localSha) {
                isOutdated = (localSha !== remoteSha && !remoteSha.startsWith(localSha) && !localSha.startsWith(remoteSha));
            } else {
                // Fallback to localStorage commit tracking
                var lastSavedSha = localStorage.getItem('composer_last_known_sha');
                if (lastSavedSha && lastSavedSha !== remoteSha) {
                    isOutdated = true;
                }
            }

            if (isOutdated) {
                this.showUpdateBanner(remoteSha, commitMsg);
                if (manual) {
                    this.showToast(`🚀 Nova versão encontrada: ${remoteSha}!`);
                }
            } else {
                if (manual) {
                    this.showToast("✅ O Premiere Composer já está na versão mais recente!");
                }
                this.hideUpdateBanner();
            }

        } catch (err) {
            console.warn("[Updater] Erro ao verificar atualizações:", err);
            if (manual) {
                this.showToast("⚠️ Erro ao verificar atualizações: " + err.message);
            }
        } finally {
            this.isChecking = false;
            if (btnCheck) {
                btnCheck.innerHTML = `<i class="fas fa-sync-alt"></i> Verificar Atualizações`;
            }
        }
    }

    /**
     * Get local git commit SHA via child_process
     */
    getLocalCommitSha() {
        return new Promise((resolve) => {
            if (!this.hasNode) {
                resolve(localStorage.getItem('composer_installed_sha') || null);
                return;
            }

            try {
                var cp = window.require('child_process');
                var extPath = this.getExtensionPath();
                var cmd = 'git rev-parse --short HEAD';

                cp.exec(cmd, { cwd: extPath, timeout: 5000 }, (error, stdout) => {
                    if (error || !stdout) {
                        resolve(localStorage.getItem('composer_installed_sha') || null);
                    } else {
                        var sha = stdout.trim();
                        localStorage.setItem('composer_installed_sha', sha);
                        resolve(sha);
                    }
                });
            } catch (e) {
                resolve(localStorage.getItem('composer_installed_sha') || null);
            }
        });
    }

    /**
     * Fetch latest commit from GitHub API
     */
    async getRemoteLatestCommit() {
        try {
            var res = await fetch(this.apiUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Premiere-Composer-FX-Studio'
                }
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    /**
     * Show top banner when update is available
     */
    showUpdateBanner(sha, msg) {
        var banner = document.getElementById('update-notification-banner');
        var textElem = document.getElementById('update-banner-text');
        var shaElem = document.getElementById('update-banner-sha');

        if (banner) {
            if (textElem) textElem.textContent = msg || 'Nova versão disponível no GitHub!';
            if (shaElem) shaElem.textContent = `[${sha}]`;
            banner.style.display = 'flex';
        }
    }

    hideUpdateBanner() {
        var banner = document.getElementById('update-notification-banner');
        if (banner) banner.style.display = 'none';
    }

    /**
     * Apply update via git pull and reload the panel
     */
    async applyUpdate() {
        if (this.isUpdating) return;
        this.isUpdating = true;

        var btnUpdateNow = document.getElementById('btn-update-now');
        if (btnUpdateNow) {
            btnUpdateNow.disabled = true;
            btnUpdateNow.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Atualizando...`;
        }

        this.showToast("⏳ Baixando e aplicando atualização do GitHub...");

        if (this.hasNode) {
            try {
                var cp = window.require('child_process');
                var extPath = this.getExtensionPath();

                // Run git pull origin main
                var cmd = 'git pull origin main';
                cp.exec(cmd, { cwd: extPath, timeout: 20000 }, (error, stdout, stderr) => {
                    if (error) {
                        console.error("[Updater] Erro no git pull:", error, stderr);
                        this.showToast("⚠️ Falha ao atualizar via Git: " + (stderr || error.message));
                        if (btnUpdateNow) {
                            btnUpdateNow.disabled = false;
                            btnUpdateNow.innerHTML = `<i class="fas fa-arrow-alt-circle-up"></i> Atualizar Agora`;
                        }
                        this.isUpdating = false;
                    } else {
                        console.log("[Updater] Git pull sucesso:", stdout);
                        this.showToast("✨ Atualização concluída com sucesso! Recarregando painel...");

                        setTimeout(() => {
                            window.location.reload();
                        }, 1200);
                    }
                });
                return;
            } catch (eNode) {
                console.warn("[Updater] Node child_process falhou:", eNode);
            }
        }

        // Fallback if not direct git process
        this.showToast("✨ Para atualizar, execute 'git pull' ou o instalador.");
        this.isUpdating = false;
        if (btnUpdateNow) {
            btnUpdateNow.disabled = false;
            btnUpdateNow.innerHTML = `<i class="fas fa-arrow-alt-circle-up"></i> Atualizar Agora`;
        }
    }

    showToast(msg) {
        if (this.app && typeof this.app.showNotification === 'function') {
            this.app.showNotification(msg);
        } else {
            var notif = document.getElementById('toast-notification');
            if (notif) {
                notif.textContent = msg;
                notif.classList.add('show');
                setTimeout(() => notif.classList.remove('show'), 3500);
            }
        }
    }
}

// Global instance
window.updaterMgr = null;
