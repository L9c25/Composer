/**
 * Premiere Composer FX Studio - Overlay Video Processing Engine
 * Generates low-resolution video thumbnail previews and handles interactive mouse hover scrubbing.
 */

class OverlayEngine {
    constructor() {}

    /**
     * Generate low-res thumbnail preview for video overlay file
     */
    generateLowResThumbnail(filePath) {
        return new Promise((resolve, reject) => {
            var video = document.createElement('video');
            video.preload = 'metadata';
            video.src = filePath.startsWith('file://') ? filePath : 'file:///' + filePath.replace(/\\/g, '/');
            video.muted = true;
            video.playsInline = true;

            var timeout = setTimeout(() => {
                cleanup();
                resolve(null); // Fallback if video loading hangs
            }, 4000);

            var cleanup = () => {
                clearTimeout(timeout);
                video.pause();
                video.src = '';
                video.remove();
            };

            video.onloadedmetadata = () => {
                // Seek to 25% duration
                video.currentTime = Math.min(1.0, video.duration * 0.25);
            };

            video.onseeked = () => {
                try {
                    var canvas = document.createElement('canvas');
                    // Low-res preview dimensions (240x135)
                    canvas.width = 240;
                    canvas.height = 135;

                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                    var dataUrl = canvas.toDataURL('image/jpeg', 0.6); // Low-res compressed JPEG

                    var info = {
                        duration: parseFloat(video.duration.toFixed(2)),
                        width: video.videoWidth,
                        height: video.videoHeight,
                        thumbnailDataUrl: dataUrl
                    };

                    cleanup();
                    resolve(info);
                } catch (e) {
                    cleanup();
                    resolve(null);
                }
            };

            video.onerror = () => {
                cleanup();
                resolve(null);
            };
        });
    }

    /**
     * Setup Interactive Hover Scrubbing for Overlay Cards
     */
    setupHoverScrub(cardElem, videoPath) {
        var videoElem = cardElem.querySelector('.overlay-hover-video');
        if (!videoElem) return;

        var isLoaded = false;

        cardElem.addEventListener('mouseenter', () => {
            if (!isLoaded) {
                videoElem.src = videoPath.startsWith('file://') ? videoPath : 'file:///' + videoPath.replace(/\\/g, '/');
                videoElem.muted = true;
                isLoaded = true;
            }
            videoElem.play().catch(() => {});
        });

        cardElem.addEventListener('mousemove', (e) => {
            if (!videoElem.duration) return;
            var rect = cardElem.getBoundingClientRect();
            var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            videoElem.currentTime = pct * videoElem.duration;
        });

        cardElem.addEventListener('mouseleave', () => {
            videoElem.pause();
        });
    }
}

// Global Singleton Instance
window.overlayEngine = new OverlayEngine();
