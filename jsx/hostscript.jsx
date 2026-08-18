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
        if (!filePath) return null;
        var targetNorm = filePath.replace(/\\/g, '/').toLowerCase();
        for (var i = 0; i < parentItem.children.numItems; i++) {
            var item = parentItem.children[i];
            if (item.type === ProjectItemType.BIN) {
                var found = this.findProjectItemByPath(item, filePath);
                if (found) return found;
            } else if (typeof item.getMediaPath === "function" && item.getMediaPath()) {
                var mediaNorm = item.getMediaPath().replace(/\\/g, '/').toLowerCase();
                if (mediaNorm === targetNorm) {
                    return item;
                }
            }
        }
        return null;
    },

    /**
     * Find a track that is completely free at CTI position, or create a new track
     */
    findOrCreateTargetTrack: function(activeSeq, mediaType, cti) {
        var isAudio = (mediaType !== "overlay");
        var tracks = isAudio ? activeSeq.audioTracks : activeSeq.videoTracks;
        if (!tracks || tracks.numTracks === 0) return null;
        var numTracks = tracks.numTracks;

        // 1. Check for a completely empty track (0 clips)
        for (var i = 0; i < numTracks; i++) {
            if (tracks[i].clips.numItems === 0) {
                return tracks[i];
            }
        }

        // 2. Check for a track that has NO clips overlapping the CTI position
        for (var j = 0; j < numTracks; j++) {
            var trackCandidate = tracks[j];
            var isOccupiedAtCti = false;
            var clips = trackCandidate.clips;
            for (var c = 0; c < clips.numItems; c++) {
                var clip = clips[c];
                var startSec = clip.start.seconds;
                var endSec = clip.end.seconds;
                if (cti.seconds >= startSec - 0.05 && cti.seconds < endSec) {
                    isOccupiedAtCti = true;
                    break;
                }
            }
            if (!isOccupiedAtCti) {
                return trackCandidate;
            }
        }

        // 3. If all existing tracks are occupied at CTI, try creating a NEW track in Premiere
        try {
            app.enableQE();
            if (typeof qe !== "undefined" && qe.project) {
                var qeSeq = qe.project.getActiveSequence();
                if (qeSeq) {
                    if (isAudio) {
                        if (typeof qeSeq.addAudioTrack === "function") {
                            qeSeq.addAudioTrack();
                        }
                    } else {
                        if (typeof qeSeq.addVideoTrack === "function") {
                            qeSeq.addVideoTrack();
                        }
                    }
                }
            }
        } catch (eQE) {}

        // Return top track (or newly added track)
        tracks = isAudio ? activeSeq.audioTracks : activeSeq.videoTracks;
        return tracks[tracks.numTracks - 1];
    },

    /**
     * Import asset to Project Bin and insert into Active Sequence at Playhead (CTI)
     * Applies Audio Gain Normalization automatically if audio.
     */
    importAndInsertAsset: function(filePath, mediaType, targetMaxPeakDb, nativePeakDb, pitchSemitones, isReverse) {
        try {
            if (!app.project) {
                return JSON.stringify({ success: false, error: "Nenhum projeto aberto no Premiere Pro." });
            }

            var activeSeq = app.project.activeSequence;
            if (!activeSeq) {
                app.project.importFiles([filePath], true, app.project.rootItem, false);
                return JSON.stringify({ success: true, insertedToSequence: false, message: "Importado para o painel Projeto (Nenhuma sequência ativa)." });
            }

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

            var gainOffsetDb = 0;
            var applyGain = false;
            if (mediaType === "sfx" && targetMaxPeakDb !== null && nativePeakDb !== null && !isNaN(targetMaxPeakDb) && !isNaN(nativePeakDb)) {
                gainOffsetDb = parseFloat(targetMaxPeakDb) - parseFloat(nativePeakDb);
                applyGain = true;
            }

            // Force Premiere Pro to refresh media cache for this item
            if (typeof projectItem.refreshMedia === "function") {
                try { projectItem.refreshMedia(); } catch (eRef) {}
            }

            // Apply gain to project item if supported
            if (applyGain) {
                try {
                    if (typeof projectItem.setAudioGain === "function") {
                        projectItem.setAudioGain(gainOffsetDb, 0);
                    } else if (typeof projectItem.setGain === "function") {
                        projectItem.setGain(gainOffsetDb);
                    }
                } catch (eGain) {}
            }

            // Get Current Time Indicator (Playhead position)
            var cti = activeSeq.getPlayerPosition();

            // Find an empty/unoccupied track at CTI or create a new track
            var targetTrack = this.findOrCreateTargetTrack(activeSeq, mediaType, cti);
            if (!targetTrack) {
                return JSON.stringify({ success: false, error: "Nenhuma faixa livre disponível na sequência." });
            }

            // Use overwriteClip / insertClip to place media at CTI position
            var insertedSuccess = false;
            try {
                targetTrack.overwriteClip(projectItem, cti);
                insertedSuccess = true;
            } catch (eOver1) {
                try {
                    targetTrack.insertClip(projectItem, cti);
                    insertedSuccess = true;
                } catch (eIns1) {
                    try {
                        targetTrack.overwriteClip(projectItem, cti.seconds);
                        insertedSuccess = true;
                    } catch (eOver2) {
                        try {
                            targetTrack.insertClip(projectItem, cti.seconds);
                            insertedSuccess = true;
                        } catch (eIns2) {}
                    }
                }
            }

            if (!insertedSuccess) {
                return JSON.stringify({ success: false, error: "Não foi possível posicionar o clipe na timeline do Premiere Pro." });
            }

            // Apply Volume Gain Normalization to inserted track clip item in timeline
            if (mediaType === "sfx" && applyGain) {
                try {
                    var targetPathNorm = (filePath || "").replace(/\\/g, '/').toLowerCase();
                    var clips = targetTrack.clips;

                    for (var c = 0; c < clips.numItems; c++) {
                        var clipItem = clips[c];
                        var isMatch = false;

                        if (clipItem.projectItem && typeof clipItem.projectItem.getMediaPath === "function") {
                            var mediaP = (clipItem.projectItem.getMediaPath() || "").replace(/\\/g, '/').toLowerCase();
                            if (mediaP === targetPathNorm) {
                                isMatch = true;
                            }
                        }

                        if (!isMatch && clipItem.start && Math.abs(clipItem.start.seconds - cti.seconds) < 0.3) {
                            isMatch = true;
                        }

                        if (isMatch) {
                            try {
                                if (typeof clipItem.setAudioGain === "function") {
                                    clipItem.setAudioGain(gainOffsetDb);
                                }
                            } catch (eAudioGain) {}

                            try {
                                if (clipItem.components) {
                                    for (var compIdx = 0; compIdx < clipItem.components.numItems; compIdx++) {
                                        var comp = clipItem.components[compIdx];
                                        if (comp.matchName === "AE.ADBE Volume" || comp.displayName === "Volume" || comp.displayName === "Áudio Volume") {
                                            if (comp.properties && comp.properties.numItems > 0) {
                                                var volProp = comp.properties[0];
                                                if (volProp) {
                                                    volProp.setValue(gainOffsetDb, true);
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (eVolComp) {}
                            
                            break; // Stop after updating the inserted clip!
                        }
                    }
                } catch (eClipGain) {}
            }

            return JSON.stringify({
                success: true,
                insertedToSequence: true,
                gainAppliedDb: applyGain ? gainOffsetDb.toFixed(2) : 0,
                message: applyGain ? "Inserido com sucesso! Ganho aplicado: " + gainOffsetDb.toFixed(1) + " dB" : "Inserido com sucesso na timeline!"
            });

        } catch (err) {
            return JSON.stringify({ success: false, error: err.toString() });
        }
    }
};
