/**
 * Premiere Composer FX Studio - ExtendScript Host Script
 * Targeted for Adobe Premiere Pro 2025 (v25.4.0) and CC 2022+
 */

var ComposerHost = {
    /**
     * Test connection to Premiere Pro
     */
    ping: function() {
        return "PPRO_OK:" + app.version;
    },

    /**
     * Find project item by file path
     */
    findProjectItemByPath: function(parentItem, filePath) {
        for (var i = 0; i < parentItem.children.numItems; i++) {
            var item = parentItem.children[i];
            if (item.type === ProjectItemType.BIN) {
                var found = this.findProjectItemByPath(item, filePath);
                if (found) return found;
            } else if (item.getMediaPath() === filePath) {
                return item;
            }
        }
        return null;
    },

    /**
     * Import asset to Project Bin and insert into Active Sequence at Playhead (CTI)
     * Applies Audio Gain Normalization automatically if audio.
     */
    importAndInsertAsset: function(filePath, mediaType, targetMaxPeakDb, nativePeakDb) {
        try {
            if (!app.project) {
                return JSON.stringify({ success: false, error: "Nenhum projeto aberto no Premiere Pro." });
            }

            var activeSeq = app.project.activeSequence;
            if (!activeSeq) {
                // If no sequence is active, import into Project panel bin
                app.project.importFiles([filePath], true, app.project.rootItem, false);
                return JSON.stringify({ success: true, insertedToSequence: false, message: "Importado para o painel Projeto (Nenhuma sequência ativa)." });
            }

            // Check if item is already in project, otherwise import it
            var projectItem = this.findProjectItemByPath(app.project.rootItem, filePath);
            if (!projectItem) {
                var importSuccess = app.project.importFiles([filePath], true, app.project.rootItem, false);
                if (importSuccess) {
                    projectItem = this.findProjectItemByPath(app.project.rootItem, filePath);
                }
            }

            if (!projectItem) {
                return JSON.stringify({ success: false, error: "Falha ao importar arquivo no Premiere Pro." });
            }

            // Calculate gain offset if target gain is specified
            var gainOffsetDb = 0;
            var applyGain = false;
            if (mediaType === "sfx" && targetMaxPeakDb !== null && nativePeakDb !== null && !isNaN(targetMaxPeakDb) && !isNaN(nativePeakDb)) {
                gainOffsetDb = parseFloat(targetMaxPeakDb) - parseFloat(nativePeakDb);
                applyGain = true;
            }

            // Apply gain to project item if supported
            if (applyGain && typeof projectItem.setGain === "function") {
                try {
                    projectItem.setGain(gainOffsetDb);
                } catch (eGain) {
                    // Fail gracefully if projectItem.setGain isn't supported on current track item
                }
            }

            // Get Current Time Indicator (Playhead position)
            var cti = activeSeq.getPlayerPosition();

            if (mediaType === "overlay") {
                // Insert into Video Track 1 (or top available video track)
                var videoTrack = activeSeq.videoTracks[0];
                if (videoTrack) {
                    videoTrack.insertClip(projectItem, cti);
                } else {
                    return JSON.stringify({ success: false, error: "Nenhuma faixa de vídeo encontrada na sequência." });
                }
            } else {
                // Insert into Audio Track 1
                var audioTrack = activeSeq.audioTracks[0];
                if (audioTrack) {
                    audioTrack.insertClip(projectItem, cti);
                    
                    // Also try applying audio gain to the sequence clip item if supported
                    if (applyGain) {
                        try {
                            var clips = audioTrack.clips;
                            for (var c = 0; c < clips.numItems; c++) {
                                var clip = clips[c];
                                if (clip.projectItem && clip.projectItem.getMediaPath() === filePath) {
                                    if (typeof clip.setAudioGain === "function") {
                                        clip.setAudioGain(gainOffsetDb);
                                    }
                                }
                            }
                        } catch (eClipGain) {}
                    }
                } else {
                    return JSON.stringify({ success: false, error: "Nenhuma faixa de áudio encontrada na sequência." });
                }
            }

            return JSON.stringify({
                success: true,
                insertedToSequence: true,
                gainAppliedDb: applyGain ? gainOffsetDb.toFixed(2) : 0,
                message: "Inserido com sucesso na timeline!"
            });

        } catch (err) {
            return JSON.stringify({ success: false, error: err.toString() });
        }
    }
};
