/**
 * Premiere Composer FX Studio - Audio Processing Engine
 * Web Audio API Waveform Generator, Native Max Peak (dBFS) Calculator,
 * Silence Cutting & File Overwriting Engine.
 */

class AudioEngine {
    constructor() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.currentSound = null;
        this.currentSoundPath = null;
        this.onProgressCallback = null;
        this.onEndedCallback = null;
    }

    /**
     * Decode audio file from path using Node fs or fetch
     */
    async decodeAudioFile(filePath) {
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

        return await this.audioCtx.decodeAudioData(arrayBuffer);
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
        for (var i = 0; i < totalSamples; i += 4) { // stride 4 for speed
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

        // 3. Detect Silence Cut Points
        var thresholdAmp = Math.pow(10, silenceThresholdDb / 20.0);
        var firstActiveSample = 0;
        var lastActiveSample = totalSamples - 1;

        // Scan forward
        for (var i = 0; i < totalSamples; i += 1) {
            var isSilent = true;
            for (var c = 0; c < numChannels; c++) {
                if (Math.abs(channelsData[c][i]) >= thresholdAmp) {
                    isSilent = false;
                    break;
                }
            }
            if (!isSilent) {
                firstActiveSample = i;
                break;
            }
        }

        // Scan backward
        for (var i = totalSamples - 1; i >= firstActiveSample; i -= 1) {
            var isSilent = true;
            for (var c = 0; c < numChannels; c++) {
                if (Math.abs(channelsData[c][i]) >= thresholdAmp) {
                    isSilent = false;
                    break;
                }
            }
            if (!isSilent) {
                lastActiveSample = i;
                break;
            }
        }

        // Safety padding (30ms)
        var paddingSamples = Math.floor(sampleRate * 0.03);
        var trimmedStartSample = Math.max(0, firstActiveSample - paddingSamples);
        var trimmedEndSample = Math.min(totalSamples - 1, lastActiveSample + paddingSamples);

        var silenceStartSec = trimmedStartSample / sampleRate;
        var silenceEndSec = trimmedEndSample / sampleRate;
        var hasSilence = (silenceStartSec > 0.02) || (silenceEndSec < duration - 0.02);

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
     * CUT SILENCE AND OVERWRITE ORIGINAL FILE ON DISK
     * Encodes sliced PCM Float32 audio into a 16-bit WAV file buffer
     * and overwrites `filePath`.
     */
    async cutSilenceAndReplaceFile(filePath, silenceThresholdDb = -45.0) {
        if (typeof require === 'undefined') {
            throw new Error("Substituição de arquivo no disco requer suporte Node.js.");
        }

        var fs = require('fs');
        var path = require('path');
        
        // 1. Decode original file
        var audioBuffer = await this.decodeAudioFile(filePath);
        var numChannels = audioBuffer.numberOfChannels;
        var sampleRate = audioBuffer.sampleRate;
        
        // 2. Compute cut points
        var procInfo = this.processAudioBuffer(audioBuffer, silenceThresholdDb);
        
        var startSample = Math.floor(procInfo.silenceStartSec * sampleRate);
        var endSample = Math.ceil(procInfo.silenceEndSec * sampleRate);
        var trimmedLength = Math.max(0, endSample - startSample);

        if (trimmedLength <= 0 || trimmedLength >= audioBuffer.length - 100) {
            console.log("[AudioEngine] Nenhum silêncio significativo detectado para cortar.");
            return { procInfo: procInfo, targetPath: filePath }; // Nothing to trim
        }

        // 3. Extract trimmed PCM arrays
        var trimmedChannels = [];
        for (var c = 0; c < numChannels; c++) {
            var fullData = audioBuffer.getChannelData(c);
            trimmedChannels.push(fullData.subarray(startSample, endSample));
        }

        // 4. Encode to 16-bit PCM WAV Buffer
        var wavBuffer = this.encodeWAV(trimmedChannels, sampleRate);

        // 5. Target path: ensure valid .wav output format for Premiere compatibility
        var targetPath = filePath;
        var ext = path.extname(filePath).toLowerCase();
        if (ext !== '.wav') {
            targetPath = filePath.substring(0, filePath.length - ext.length) + '.wav';
        }

        // Write WAV buffer to disk
        fs.writeFileSync(targetPath, wavBuffer);
        console.log(`[AudioEngine] Arquivo WAV substituído/gerado com sucesso no disco (${targetPath}).`);

        // If converted from MP3 to WAV, remove old MP3 if targetPath is different
        if (targetPath !== filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (eUnlink) {}
        }

        // 6. Decode updated file to update cache & UI
        var updatedAudioBuffer = await this.decodeAudioFile(targetPath);
        var newProcInfo = this.processAudioBuffer(updatedAudioBuffer, silenceThresholdDb);

        // Update Cache
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

    /**
     * Draw Waveform on HTML5 Canvas
     */
    drawWaveform(canvas, waveformArray, playbackPercent = 0, silenceStartSec = 0, silenceEndSec = 0, duration = 1) {
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var width = canvas.clientWidth || canvas.width;
        var height = canvas.clientHeight || canvas.height;
        
        canvas.width = width * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        // Clear Background
        ctx.fillStyle = '#0b0e12';
        ctx.fillRect(0, 0, width, height);

        if (!waveformArray || waveformArray.length === 0) return;

        var numBars = waveformArray.length;
        var barWidth = width / numBars;
        var centerY = height / 2;

        // Draw Bars
        for (var b = 0; b < numBars; b++) {
            var val = waveformArray[b] || 0.05;
            var barHeight = Math.max(3, val * (height * 0.85));
            var x = b * barWidth;
            var y = centerY - barHeight / 2;

            var barProgress = b / numBars;
            
            // Color Logic
            if (barProgress <= playbackPercent) {
                // Active played color (Bright Emerald)
                ctx.fillStyle = '#00e699';
            } else {
                // Unplayed color
                ctx.fillStyle = '#10b981';
            }

            ctx.fillRect(x, y, Math.max(1.5, barWidth - 1), barHeight);
        }

        // Draw Silence Cut Markers if present
        if (silenceStartSec > 0.02 || (silenceEndSec < duration - 0.02 && silenceEndSec > 0)) {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.25)'; // Semi-transparent red overlay for cut silence
            
            // Start silence region
            if (silenceStartSec > 0.02) {
                var startX = (silenceStartSec / duration) * width;
                ctx.fillRect(0, 0, startX, height);
            }
            // End silence region
            if (silenceEndSec < duration - 0.02 && silenceEndSec > 0) {
                var endX = (silenceEndSec / duration) * width;
                ctx.fillRect(endX, 0, width - endX, height);
            }
        }
    }

    /**
     * Preview Audio Playback in Extension Panel
     */
    async playAudioPreview(filePath, onProgress, onEnded) {
        this.stopAudioPreview();

        try {
            var audioBuffer = await this.decodeAudioFile(filePath);
            var source = this.audioCtx.createBufferSource();
            source.buffer = audioBuffer;

            var gainNode = this.audioCtx.createGain();
            source.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);

            this.currentSound = {
                source: source,
                gainNode: gainNode,
                buffer: audioBuffer,
                startTime: this.audioCtx.currentTime,
                duration: audioBuffer.duration
            };
            this.currentSoundPath = filePath;

            source.start(0);

            // Progress Loop
            var updateLoop = () => {
                if (!this.currentSound) return;
                var elapsed = this.audioCtx.currentTime - this.currentSound.startTime;
                var pct = Math.min(1, elapsed / this.currentSound.duration);
                if (onProgress) onProgress(pct, elapsed, this.currentSound.duration);

                if (pct < 1 && this.currentSound) {
                    requestAnimationFrame(updateLoop);
                } else {
                    this.stopAudioPreview();
                    if (onEnded) onEnded();
                }
            };
            requestAnimationFrame(updateLoop);

            source.onended = () => {
                if (onEnded) onEnded();
            };

        } catch (err) {
            console.error("[AudioEngine] Error playing preview audio:", err);
        }
    }

    stopAudioPreview() {
        if (this.currentSound && this.currentSound.source) {
            try {
                this.currentSound.source.stop();
            } catch (e) {}
        }
        this.currentSound = null;
        this.currentSoundPath = null;
    }
}

// Global Singleton Instance
window.audioEngine = new AudioEngine();
