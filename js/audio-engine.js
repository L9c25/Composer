/**
 * Premiere Composer FX Studio - Audio Processing Engine
 * Web Audio API Waveform Generator, Native Max Peak (dBFS) Calculator,
 * Clean Play/Pause/Resume/Seek State Machine, & Direct File Overwrite Engine.
 */

class AudioEngine {
    constructor() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Playback State
        this.state = 'stopped'; // 'stopped' | 'playing' | 'paused'
        this.currentSoundPath = null;
        this.currentBuffer = null;
        this.currentSourceNode = null;
        this.currentGainNode = null;
        
        this.currentOffsetSec = 0;
        this.playbackStartCtxTime = 0;
        this.playbackRate = 1;
        this.pitchSemitones = 0;
        this.isReverse = false;
        
        this.onProgressCallback = null;
        this.onEndedCallback = null;
        this.animFrameId = null;

        // In-memory decoded buffer cache by file path
        this.bufferCache = new Map();
        this.currentPlaySessionId = 0;
    }

    /**
     * Decode audio file from path using Node fs or fetch
     */
    async decodeAudioFile(filePath) {
        // Return from memory cache if already decoded and available
        if (this.bufferCache.has(filePath)) {
            return this.bufferCache.get(filePath);
        }

        var arrayBuffer;
        if (typeof require !== 'undefined') {
            var fs = require('fs');
            var buf = fs.readFileSync(filePath);
            arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        } else {
            var response = await fetch(filePath);
            arrayBuffer = await response.arrayBuffer();
        }

        // Resume AudioContext if suspended
        if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }

        var decodedBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
        
        // Keep in cache (limit to last 30 sounds to avoid memory bloat)
        if (this.bufferCache.size > 30) {
            var firstKey = this.bufferCache.keys().next().value;
            this.bufferCache.delete(firstKey);
        }
        this.bufferCache.set(filePath, decodedBuffer);

        return decodedBuffer;
    }

    /**
     * Clear buffer cache for a specific file (e.g. after overwriting on disk)
     */
    invalidateBufferCache(filePath) {
        if (filePath) {
            this.bufferCache.delete(filePath);
        } else {
            this.bufferCache.clear();
        }
    }

    /**
     * Process audio buffer: extract 150 waveform peaks, native Max Peak dBFS,
     * and silence trim boundaries.
     */
    processAudioBuffer(audioBuffer, silenceThresholdDb = -45.0) {
        var numChannels = audioBuffer.numberOfChannels;
        var totalSamples = audioBuffer.length;
        var sampleRate = audioBuffer.sampleRate;
        var duration = audioBuffer.duration;

        var channelsData = [];
        for (var c = 0; c < numChannels; c++) {
            channelsData.push(audioBuffer.getChannelData(c));
        }

        // 1. Calculate True Native Max Peak in dBFS
        var maxAmp = 0;
        for (var i = 0; i < totalSamples; i += 4) { // stride 4 for high speed
            for (var c = 0; c < numChannels; c++) {
                var absVal = Math.abs(channelsData[c][i]);
                if (absVal > maxAmp) maxAmp = absVal;
            }
        }
        var nativePeakDb = maxAmp > 0 ? 20 * Math.log10(maxAmp) : -96.0;

        // 2. Extract Downsampled Waveform (150 bars)
        var numBars = 150;
        var samplesPerBar = Math.floor(totalSamples / numBars);
        var waveform = new Float32Array(numBars);

        for (var b = 0; b < numBars; b++) {
            var barStart = b * samplesPerBar;
            var barEnd = Math.min(barStart + samplesPerBar, totalSamples);
            var barMax = 0;
            for (var j = barStart; j < barEnd; j += 2) {
                for (var c = 0; c < numChannels; c++) {
                    var v = Math.abs(channelsData[c][j]);
                    if (v > barMax) barMax = v;
                }
            }
            waveform[b] = barMax;
        }

        // Normalize waveform relative to maxAmp for beautiful display
        if (maxAmp > 0) {
            for (var b = 0; b < numBars; b++) {
                waveform[b] = waveform[b] / maxAmp;
            }
        }

        // 3. Detect Silence Cut Points with 5ms window precision
        var thresholdAmp = Math.pow(10, silenceThresholdDb / 20.0);
        var windowSize = Math.max(1, Math.floor(sampleRate * 0.005)); // 5ms window
        var firstActiveSample = 0;
        var lastActiveSample = totalSamples - 1;

        // Scan forward in 5ms windows
        for (var i = 0; i < totalSamples; i += windowSize) {
            var windowEnd = Math.min(i + windowSize, totalSamples);
            var isSilent = true;
            for (var j = i; j < windowEnd; j++) {
                for (var c = 0; c < numChannels; c++) {
                    if (Math.abs(channelsData[c][j]) >= thresholdAmp) {
                        isSilent = false;
                        break;
                    }
                }
                if (!isSilent) break;
            }
            if (!isSilent) {
                firstActiveSample = i;
                break;
            }
        }

        // Scan backward in 5ms windows
        for (var i = totalSamples - windowSize; i >= firstActiveSample; i -= windowSize) {
            var windowEnd = Math.min(i + windowSize, totalSamples);
            var isSilent = true;
            for (var j = i; j < windowEnd; j++) {
                for (var c = 0; c < numChannels; c++) {
                    if (Math.abs(channelsData[c][j]) >= thresholdAmp) {
                        isSilent = false;
                        break;
                    }
                }
                if (!isSilent) break;
            }
            if (!isSilent) {
                lastActiveSample = Math.min(totalSamples - 1, i + windowSize);
                break;
            }
        }

        // Safety padding (5ms)
        var paddingSamples = Math.floor(sampleRate * 0.005);
        var trimmedStartSample = Math.max(0, firstActiveSample - paddingSamples);
        var trimmedEndSample = Math.min(totalSamples - 1, lastActiveSample + paddingSamples);

        var silenceStartSec = trimmedStartSample / sampleRate;
        var silenceEndSec = trimmedEndSample / sampleRate;
        var hasSilence = (silenceStartSec > 0.01) || (silenceEndSec < duration - 0.01);

        return {
            duration: duration,
            nativePeakDb: parseFloat(nativePeakDb.toFixed(2)),
            waveform: Array.from(waveform),
            silenceStartSec: parseFloat(silenceStartSec.toFixed(3)),
            silenceEndSec: parseFloat(silenceEndSec.toFixed(3)),
            hasSilence: hasSilence
        };
    }

    /**
     * Stop any currently running Web Audio source node
     */
    _stopCurrentSourceNode() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        if (this.currentSourceNode) {
            try {
                this.currentSourceNode.onended = null;
                this.currentSourceNode.stop();
                this.currentSourceNode.disconnect();
            } catch (e) {}
            this.currentSourceNode = null;
        }
    }

    /**
     * PLAY audio preview
     */
    async playAudioPreview(filePath, pitchSemitones = 0, isReverse = false, onProgress = null, onEnded = null, startPercent = 0) {
        this.currentPlaySessionId++;
        var sessionId = this.currentPlaySessionId;

        this._stopCurrentSourceNode();

        if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }

        try {
            var rawBuffer = await this.decodeAudioFile(filePath);
            if (this.currentPlaySessionId !== sessionId) return;

            var audioBuffer = rawBuffer;
            if (isReverse) {
                var numChannels = rawBuffer.numberOfChannels;
                var totalLen = rawBuffer.length;
                var reversedBuffer = this.audioCtx.createBuffer(numChannels, totalLen, rawBuffer.sampleRate);
                for (var c = 0; c < numChannels; c++) {
                    var origData = rawBuffer.getChannelData(c);
                    var revData = reversedBuffer.getChannelData(c);
                    for (var i = 0; i < totalLen; i++) {
                        revData[i] = origData[totalLen - 1 - i];
                    }
                }
                audioBuffer = reversedBuffer;
            }

            this.currentSoundPath = filePath;
            this.currentBuffer = audioBuffer;
            this.pitchSemitones = pitchSemitones;
            this.isReverse = isReverse;
            this.onProgressCallback = onProgress;
            this.onEndedCallback = onEnded;

            var rate = pitchSemitones !== 0 ? Math.pow(2, pitchSemitones / 12) : 1;
            this.playbackRate = rate;

            var safeStartPct = Math.max(0, Math.min(0.999, startPercent));
            this.currentOffsetSec = safeStartPct * audioBuffer.duration;

            this._startSourceNodeAtOffset(this.currentOffsetSec, sessionId);
        } catch (err) {
            console.error("[AudioEngine] Error loading/playing audio:", err);
            this.state = 'stopped';
            if (onEnded) onEnded();
        }
    }

    /**
     * Internal helper to start source node at a given offset in seconds
     */
    _startSourceNodeAtOffset(offsetSec, sessionId) {
        if (!this.currentBuffer) return;

        this._stopCurrentSourceNode();

        var source = this.audioCtx.createBufferSource();
        source.buffer = this.currentBuffer;
        source.playbackRate.value = this.playbackRate;

        var gainNode = this.audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        this.currentSourceNode = source;
        this.currentGainNode = gainNode;
        this.currentOffsetSec = offsetSec;
        this.playbackStartCtxTime = this.audioCtx.currentTime;
        this.state = 'playing';

        var bufferOffsetSec = Math.max(0, Math.min(this.currentBuffer.duration - 0.01, offsetSec));
        source.start(0, bufferOffsetSec);

        // Progress Loop via requestAnimationFrame
        var updateLoop = () => {
            if (this.state !== 'playing' || this.currentPlaySessionId !== sessionId || !this.currentBuffer) {
                return;
            }

            var elapsedSinceStart = (this.audioCtx.currentTime - this.playbackStartCtxTime) * this.playbackRate;
            var currentPosSec = this.currentOffsetSec + elapsedSinceStart;
            var duration = this.currentBuffer.duration;
            var pct = Math.max(0, Math.min(1.0, currentPosSec / duration));

            if (this.onProgressCallback) {
                this.onProgressCallback(pct, currentPosSec, duration);
            }

            if (pct >= 1.0 || currentPosSec >= duration) {
                this.state = 'stopped';
                this.currentOffsetSec = 0;
                this._stopCurrentSourceNode();
                if (this.onEndedCallback) this.onEndedCallback();
                return;
            }

            this.animFrameId = requestAnimationFrame(updateLoop);
        };

        this.animFrameId = requestAnimationFrame(updateLoop);

        source.onended = () => {
            if (this.state === 'playing' && this.currentPlaySessionId === sessionId) {
                this.state = 'stopped';
                this.currentOffsetSec = 0;
                if (this.animFrameId) {
                    cancelAnimationFrame(this.animFrameId);
                    this.animFrameId = null;
                }
                if (this.onEndedCallback) this.onEndedCallback();
            }
        };
    }

    /**
     * PAUSE audio playback at current position
     */
    pauseAudioPreview() {
        if (this.state !== 'playing') return;

        if (this.currentBuffer) {
            var elapsedSinceStart = (this.audioCtx.currentTime - this.playbackStartCtxTime) * this.playbackRate;
            this.currentOffsetSec = Math.min(this.currentBuffer.duration, this.currentOffsetSec + elapsedSinceStart);
        }

        this.state = 'paused';
        this._stopCurrentSourceNode();
    }

    /**
     * RESUME audio playback from paused position
     */
    resumeAudioPreview() {
        if (this.state !== 'paused' || !this.currentBuffer || !this.currentSoundPath) {
            return false;
        }

        if (this.currentOffsetSec >= this.currentBuffer.duration - 0.05) {
            this.currentOffsetSec = 0;
        }

        this.currentPlaySessionId++;
        this._startSourceNodeAtOffset(this.currentOffsetSec, this.currentPlaySessionId);
        return true;
    }

    /**
     * STOP audio playback completely and reset playhead to 0
     */
    stopAudioPreview() {
        this.currentPlaySessionId++;
        this.state = 'stopped';
        this.currentOffsetSec = 0;
        this._stopCurrentSourceNode();
    }

    /**
     * SEEK audio playhead to a specific percentage (0.0 to 1.0)
     */
    seekAudioPreview(percent) {
        if (!this.currentBuffer) return;

        var safePct = Math.max(0, Math.min(0.999, percent));
        var targetOffsetSec = safePct * this.currentBuffer.duration;
        this.currentOffsetSec = targetOffsetSec;

        if (this.state === 'playing') {
            this.currentPlaySessionId++;
            this._startSourceNodeAtOffset(targetOffsetSec, this.currentPlaySessionId);
        } else {
            // In paused/stopped state, update progress callback once to reposition needle
            if (this.onProgressCallback) {
                this.onProgressCallback(safePct, targetOffsetSec, this.currentBuffer.duration);
            }
        }
    }

    /**
     * Get current playback position info
     */
    getPlaybackInfo() {
        if (!this.currentBuffer) {
            return { state: this.state, percent: 0, currentSec: 0, duration: 0 };
        }
        var duration = this.currentBuffer.duration;
        var currentSec = this.currentOffsetSec;
        if (this.state === 'playing') {
            var elapsed = (this.audioCtx.currentTime - this.playbackStartCtxTime) * this.playbackRate;
            currentSec = Math.min(duration, this.currentOffsetSec + elapsed);
        }
        return {
            state: this.state,
            percent: duration > 0 ? Math.min(1.0, currentSec / duration) : 0,
            currentSec: currentSec,
            duration: duration
        };
    }

    /**
     * Draw Waveform on HTML5 Canvas with needle scrubber, hover line, and silence markers
     */
    drawWaveform(canvas, waveformArray, playbackPercent = 0, silenceStartSec = 0, silenceEndSec = 0, duration = 1, hoverPercent = -1) {
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var width = canvas.clientWidth || canvas.width || 300;
        var height = canvas.clientHeight || canvas.height || 54;
        
        var dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
        }
        
        ctx.save();
        ctx.scale(dpr, dpr);

        // Clear Background with rich dark gradient
        var bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#0c1015');
        bgGrad.addColorStop(1, '#07090c');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Subtle Center Guideline
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        if (!waveformArray || waveformArray.length === 0) {
            ctx.restore();
            return;
        }

        var numBars = waveformArray.length;
        var barWidth = width / numBars;
        var centerY = height / 2;
        var safeDuration = duration > 0 ? duration : 1;

        // Draw Silence Region Backgrounds if present
        if (silenceStartSec > 0.02 || (silenceEndSec < safeDuration - 0.02 && silenceEndSec > 0)) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.18)'; // Subtle red overlay for cut silence
            
            // Start silence region
            if (silenceStartSec > 0.02) {
                var startX = (silenceStartSec / safeDuration) * width;
                ctx.fillRect(0, 0, startX, height);
                // Silence boundary line
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(startX, 0);
                ctx.lineTo(startX, height);
                ctx.stroke();
            }
            // End silence region
            if (silenceEndSec < safeDuration - 0.02 && silenceEndSec > 0) {
                var endX = (silenceEndSec / safeDuration) * width;
                ctx.fillRect(endX, 0, width - endX, height);
                // Silence boundary line
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(endX, 0);
                ctx.lineTo(endX, height);
                ctx.stroke();
            }
        }

        // Draw Waveform Bars
        for (var b = 0; b < numBars; b++) {
            var val = waveformArray[b] || 0.04;
            var barHeight = Math.max(3, val * (height * 0.82));
            var x = b * barWidth;
            var y = centerY - barHeight / 2;
            var barProgress = b / numBars;

            // Color: Played area vs Unplayed area
            if (barProgress <= playbackPercent) {
                ctx.fillStyle = '#00e699'; // Bright Emerald Played
            } else {
                ctx.fillStyle = '#10b981'; // Unplayed Emerald
            }

            var drawW = Math.max(1.5, barWidth - 1);
            var rad = Math.min(2, drawW / 2);
            
            // Draw rounded bar
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x, y, drawW, barHeight, rad) : ctx.rect(x, y, drawW, barHeight);
            ctx.fill();
        }

        // Draw Hover Ghost Needle
        if (hoverPercent >= 0 && hoverPercent <= 1 && Math.abs(hoverPercent - playbackPercent) > 0.01) {
            var hoverX = Math.floor(hoverPercent * width);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(hoverX, 0);
            ctx.lineTo(hoverX, height);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw Interactive Playhead Needle
        if (playbackPercent >= 0 && playbackPercent <= 1) {
            var playheadX = Math.floor(playbackPercent * width);

            // Needle Glow
            ctx.shadowColor = '#00e699';
            ctx.shadowBlur = 8;

            // Vertical Needle Line
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(Math.max(0, playheadX - 1), 0, 2, height);

            // Playhead Top Handle (Diamond/Triangle Scrubber)
            ctx.fillStyle = '#00e699';
            ctx.beginPath();
            ctx.moveTo(playheadX - 4, 0);
            ctx.lineTo(playheadX + 4, 0);
            ctx.lineTo(playheadX, 6);
            ctx.closePath();
            ctx.fill();

            // Playhead Bottom Handle
            ctx.beginPath();
            ctx.moveTo(playheadX - 4, height);
            ctx.lineTo(playheadX + 4, height);
            ctx.lineTo(playheadX, height - 6);
            ctx.closePath();
            ctx.fill();

            ctx.shadowBlur = 0;
        }

        ctx.restore();
    }

    /**
     * CUT SILENCE AND OVERWRITE ORIGINAL FILE ON DISK
     * Trims silent boundaries, applies Max Peak target, and overwrites source file directly in its folder.
     * NEVER saves to temporary folders!
     */
    async cutSilenceAndReplaceFile(filePath, silenceThresholdDb = -45.0, targetMaxPeakDb = -6.0) {
        if (typeof require === 'undefined') {
            throw new Error("A substituição de arquivos no disco requer o ambiente Node.js do Adobe CEP.");
        }

        var fs = require('fs');
        var path = require('path');
        
        // Invalidate memory cache before processing
        this.invalidateBufferCache(filePath);

        // 1. Decode original file
        var audioBuffer = await this.decodeAudioFile(filePath);
        var numChannels = audioBuffer.numberOfChannels;
        var sampleRate = audioBuffer.sampleRate;
        
        // 2. Compute cut points
        var procInfo = this.processAudioBuffer(audioBuffer, silenceThresholdDb);
        
        var startSample = Math.floor(procInfo.silenceStartSec * sampleRate);
        var endSample = Math.ceil(procInfo.silenceEndSec * sampleRate);
        var trimmedLength = Math.max(0, endSample - startSample);

        var sliceLength = trimmedLength > 0 ? trimmedLength : audioBuffer.length;
        var sliceStart = trimmedLength > 0 ? startSample : 0;
        var sliceEnd = trimmedLength > 0 ? endSample : audioBuffer.length;

        // 3. Extract trimmed PCM arrays & apply 3ms micro fade-in/fade-out anti-click
        var trimmedChannels = [];
        var maxAmp = 0;
        var fadeLength = Math.min(Math.floor(sampleRate * 0.003), sliceLength); // 3ms micro fade

        for (var c = 0; c < numChannels; c++) {
            var fullData = audioBuffer.getChannelData(c);
            var sliced = new Float32Array(fullData.subarray(sliceStart, sliceEnd));

            // Apply 3ms micro fade-in
            for (var f = 0; f < fadeLength; f++) {
                sliced[f] *= (f / fadeLength);
            }
            // Apply 3ms micro fade-out
            for (var f = 0; f < fadeLength; f++) {
                var idx = sliced.length - 1 - f;
                if (idx >= 0) sliced[idx] *= (f / fadeLength);
            }

            for (var i = 0; i < sliced.length; i++) {
                var absV = Math.abs(sliced[i]);
                if (absV > maxAmp) maxAmp = absV;
            }
            trimmedChannels.push(sliced);
        }

        // Apply Max Peak Normalization to trimmed samples if targetMaxPeakDb is provided
        if (targetMaxPeakDb !== null && targetMaxPeakDb !== undefined && !isNaN(targetMaxPeakDb) && maxAmp > 0) {
            var targetAmp = Math.pow(10, parseFloat(targetMaxPeakDb) / 20.0);
            var gainRatio = targetAmp / maxAmp;
            for (var c = 0; c < numChannels; c++) {
                var chArr = trimmedChannels[c];
                for (var i = 0; i < chArr.length; i++) {
                    var normV = chArr[i] * gainRatio;
                    chArr[i] = Math.max(-1.0, Math.min(1.0, normV));
                }
            }
        }

        // 4. Encode to 16-bit PCM WAV Buffer
        var wavBuffer = this.encodeWAV(trimmedChannels, sampleRate);

        // 5. Target path: ensure valid .wav output format in the SAME folder (Overwriting original!)
        var targetPath = filePath;
        var ext = path.extname(filePath).toLowerCase();
        if (ext !== '.wav') {
            targetPath = filePath.substring(0, filePath.length - ext.length) + '.wav';
        }

        // Write WAV buffer directly to the user's permanent file path
        fs.writeFileSync(targetPath, wavBuffer);
        console.log(`[AudioEngine] Arquivo original sobrescrito com sucesso: ${targetPath}`);

        // If converted from MP3/AAC to WAV, remove old compressed file if path changed
        if (targetPath !== filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (eUnlink) {}
        }

        // Invalidate memory cache for both paths
        this.invalidateBufferCache(filePath);
        this.invalidateBufferCache(targetPath);

        // 6. Decode updated file to refresh cache & UI
        var updatedAudioBuffer = await this.decodeAudioFile(targetPath);
        var newProcInfo = this.processAudioBuffer(updatedAudioBuffer, silenceThresholdDb);

        // Update Cache Manager
        var stats = fs.statSync(targetPath);
        window.cacheMgr.setAudioCache(targetPath, stats.mtimeMs, newProcInfo);

        return { procInfo: newProcInfo, targetPath: targetPath };
    }

    /**
     * NORMALIZE MAX PEAK AND OVERWRITE ORIGINAL FILE ON DISK
     * Applies target Max Peak directly to PCM samples and saves in-place.
     */
    async normalizeAndReplaceFile(filePath, targetMaxPeakDb = -6.0) {
        if (typeof require === 'undefined') {
            throw new Error("A substituição de arquivos no disco requer o ambiente Node.js do Adobe CEP.");
        }

        var fs = require('fs');
        var path = require('path');
        
        this.invalidateBufferCache(filePath);

        var audioBuffer = await this.decodeAudioFile(filePath);
        var numChannels = audioBuffer.numberOfChannels;
        var sampleRate = audioBuffer.sampleRate;
        var totalSamples = audioBuffer.length;

        var channelsData = [];
        var maxAmp = 0;
        for (var c = 0; c < numChannels; c++) {
            var ch = new Float32Array(audioBuffer.getChannelData(c));
            for (var i = 0; i < totalSamples; i++) {
                var absV = Math.abs(ch[i]);
                if (absV > maxAmp) maxAmp = absV;
            }
            channelsData.push(ch);
        }

        if (maxAmp > 0) {
            var targetAmp = Math.pow(10, parseFloat(targetMaxPeakDb) / 20.0);
            var gainRatio = targetAmp / maxAmp;
            for (var c = 0; c < numChannels; c++) {
                for (var i = 0; i < totalSamples; i++) {
                    channelsData[c][i] = Math.max(-1.0, Math.min(1.0, channelsData[c][i] * gainRatio));
                }
            }
        }

        var wavBuffer = this.encodeWAV(channelsData, sampleRate);

        var targetPath = filePath;
        var ext = path.extname(filePath).toLowerCase();
        if (ext !== '.wav') {
            targetPath = filePath.substring(0, filePath.length - ext.length) + '.wav';
        }

        fs.writeFileSync(targetPath, wavBuffer);

        if (targetPath !== filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (eUnlink) {}
        }

        this.invalidateBufferCache(filePath);
        this.invalidateBufferCache(targetPath);

        var updatedAudioBuffer = await this.decodeAudioFile(targetPath);
        var newProcInfo = this.processAudioBuffer(updatedAudioBuffer);

        var stats = fs.statSync(targetPath);
        window.cacheMgr.setAudioCache(targetPath, stats.mtimeMs, newProcInfo);

        return { procInfo: newProcInfo, targetPath: targetPath };
    }

    /**
     * Helper: Encode Float32 Channel Arrays into 16-bit PCM WAV Buffer
     */
    encodeWAV(channels, sampleRate) {
        var numChannels = channels.length;
        var numSamples = channels[0].length;
        var bytesPerSample = 2; // 16-bit
        var blockAlign = numChannels * bytesPerSample;
        var byteRate = sampleRate * blockAlign;
        var dataSize = numSamples * blockAlign;

        var buffer = new ArrayBuffer(44 + dataSize);
        var view = new DataView(buffer);

        /* RIFF identifier */
        this.writeString(view, 0, 'RIFF');
        /* RIFF chunk length */
        view.setUint32(4, 36 + dataSize, true);
        /* RIFF type */
        this.writeString(view, 8, 'WAVE');
        /* format chunk identifier */
        this.writeString(view, 12, 'fmt ');
        /* format chunk length */
        view.setUint32(16, 16, true);
        /* sample format (1 = PCM) */
        view.setUint16(20, 1, true);
        /* channel count */
        view.setUint16(22, numChannels, true);
        /* sample rate */
        view.setUint32(24, sampleRate, true);
        /* byte rate (sample rate * block align) */
        view.setUint32(28, byteRate, true);
        /* block align (channel count * bytes per sample) */
        view.setUint16(32, blockAlign, true);
        /* bits per sample */
        view.setUint16(34, 16, true);
        /* data chunk identifier */
        this.writeString(view, 36, 'data');
        /* data chunk length */
        view.setUint32(40, dataSize, true);

        // Write Interleaved 16-bit PCM samples
        var offset = 44;
        for (var i = 0; i < numSamples; i++) {
            for (var c = 0; c < numChannels; c++) {
                var s = Math.max(-1, Math.min(1, channels[c][i]));
                // Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
                var rawVal = s < 0 ? s * 0x8000 : s * 0x7FFF;
                var val = Math.floor(rawVal);
                view.setInt16(offset, val, true);
                offset += 2;
            }
        }

        return Buffer.from(buffer);
    }

    writeString(view, offset, string) {
        for (var i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}

// Global Singleton Instance
window.audioEngine = new AudioEngine();
