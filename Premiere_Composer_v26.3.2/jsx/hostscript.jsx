/**
 * Premiere Composer FX Studio - ExtendScript Host Script
 * Highly Optimized for Adobe Premiere Pro 2026 (v26.3.2), 2025, 2024 & CC
 */

var ComposerHost = {
    /**
     * Test connection to Premiere Pro
     */
    ping: function() {
        try {
            return "PPRO_OK:" + (app.version || "Unknown");
        } catch (e) {
            return "PPRO_ERROR:" + e.toString();
        }
    },

    /**
     * Open native folder picker dialog
     */
    selectFolderDialog: function() {
        try {
            var folder = Folder.selectDialog("Selecione uma pasta de áudio/vídeo para o Premiere Composer");
            if (folder) {
                return folder.fsName.replace(/\\/g, '/');
            } else {
                return "CANCELLED";
            }
        } catch (e) {
            return "ERROR:" + e.toString();
        }
    },

    /**
     * Robust Project Item Finder
     * Searches recursively across bins by mediaPath, treePath, or fileName
     */
    findProjectItem: function(parentBin, targetPath, targetFileName) {
        if (!parentBin || !parentBin.children) return null;

        var normTarget = targetPath ? targetPath.replace(/\\/g, '/').toLowerCase() : "";
        var normFileName = targetFileName ? targetFileName.toLowerCase() : "";

        for (var i = 0; i < parentBin.children.numItems; i++) {
            var item = parentBin.children[i];
            if (!item) continue;

            // Check if item is a Bin (Folder in Project Panel)
            var isBin = false;
            try {
                if (typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN) {
                    isBin = true;
                } else if (item.type === 2) {
                    isBin = true;
                } else if (item.children && item.children.numItems > 0 && typeof item.getMediaPath !== "function") {
                    isBin = true;
                }
            } catch (eBin) {}

            if (isBin) {
                var foundInSub = this.findProjectItem(item, targetPath, targetFileName);
                if (foundInSub) return foundInSub;
            } else {
                // 1. Match by Media Path
                try {
                    if (typeof item.getMediaPath === "function") {
                        var mediaP = item.getMediaPath();
                        if (mediaP && mediaP.replace(/\\/g, '/').toLowerCase() === normTarget) {
                            return item;
                        }
                    }
                } catch (eMed) {}

                // 2. Match by Tree Path
                try {
                    if (item.treePath && item.treePath.replace(/\\/g, '/').toLowerCase() === normTarget) {
                        return item;
                    }
                } catch (eTree) {}

                // 3. Match by item name (exact file name)
                try {
                    if (normFileName && item.name && item.name.toLowerCase() === normFileName) {
                        return item;
                    }
                } catch (eName) {}
            }
        }
        return null;
    },

    /**
     * Find best target track or create a new one
     */
    findOrCreateTargetTrack: function(activeSeq, isAudio, cti) {
        var tracks = isAudio ? activeSeq.audioTracks : activeSeq.videoTracks;
        if (!tracks || tracks.numTracks === 0) return { track: null, index: 0 };

        var numTracks = tracks.numTracks;
        var ctiSec = (cti && typeof cti.seconds === "number") ? cti.seconds : 0;

        // 1. Scan tracks top-down (0 to numTracks - 1) to find the first unlocked track
        // that is free (no clip overlapping) at the current playhead (CTI) position.
        for (var j = 0; j < numTracks; j++) {
            var tCandidate = tracks[j];
            var isCandidateLocked = false;
            try { isCandidateLocked = tCandidate.isLocked(); } catch (eLock) {}
            if (isCandidateLocked) continue;

            var isOccupied = false;
            var clips = tCandidate.clips;
            if (clips && clips.numItems > 0) {
                for (var c = 0; c < clips.numItems; c++) {
                    var clip = clips[c];
                    if (clip && clip.start && clip.end) {
                        var startSec = clip.start.seconds;
                        var endSec = clip.end.seconds;
                        // If playhead falls within this clip's range
                        if (ctiSec >= startSec && ctiSec < (endSec - 0.001)) {
                            isOccupied = true;
                            break;
                        }
                    }
                }
            }

            // Found highest available track free at CTI
            if (!isOccupied) {
                return { track: tCandidate, index: j };
            }
        }

        // 2. If all existing unlocked tracks are occupied at CTI, create a NEW track
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

        // Re-read tracks and use the newly added bottom track
        tracks = isAudio ? activeSeq.audioTracks : activeSeq.videoTracks;
        var lastIdx = tracks.numTracks - 1;
        if (lastIdx < 0) lastIdx = 0;
        return { track: tracks[lastIdx], index: lastIdx };
    },

    /**
     * Import asset to Project Bin and insert into Active Sequence at Playhead (CTI)
     * Resilient multi-strategy insertion for Premiere Pro v26.3.2 (2026)
     */
    importAndInsertAsset: function(rawFilePath, mediaType) {
        try {
            if (!app.project) {
                return JSON.stringify({ success: false, error: "Nenhum projeto aberto no Premiere Pro." });
            }

            if (!rawFilePath) {
                return JSON.stringify({ success: false, error: "Caminho do arquivo não informado." });
            }

            // 1. Clean and normalize file path
            var cleanPath = rawFilePath;
            try {
                cleanPath = decodeURIComponent(cleanPath);
            } catch (eDec) {}
            cleanPath = cleanPath.replace(/\\/g, '/');

            var fileObj = new File(cleanPath);
            if (!fileObj.exists) {
                // Try with native filesystem name
                fileObj = new File(rawFilePath);
                if (!fileObj.exists) {
                    return JSON.stringify({ success: false, error: "Arquivo não encontrado no disco: " + cleanPath });
                }
            }

            var nativeFsPath = fileObj.fsName;
            var fileName = fileObj.name;

            // Determine if asset is audio or video
            var isAudio = true;
            var ext = fileName.substr(fileName.lastIndexOf('.')).toLowerCase();
            if (ext === '.mp4' || ext === '.mov' || ext === '.webm' || ext === '.avi' || ext === '.mkv' || ext === '.m4v' || ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
                isAudio = false;
            } else if (mediaType === 'overlay' || mediaType === 'video') {
                isAudio = false;
            }

            // 2. Locate or Open Active Sequence
            var activeSeq = app.project.activeSequence;
            if (!activeSeq) {
                // If there are sequences in the project, try to activate the first one
                if (app.project.sequences && app.project.sequences.numSequences > 0) {
                    try {
                        app.project.openSequence(app.project.sequences[0].sequenceID);
                        activeSeq = app.project.activeSequence;
                    } catch (eSeqOpen) {}
                }
            }

            // 3. Find or Import ProjectItem in Bin
            var rootItem = app.project.rootItem;
            var projectItem = this.findProjectItem(rootItem, cleanPath, fileName);

            if (!projectItem) {
                // Import file into Premiere Project
                var importSuccess = false;
                try {
                    importSuccess = app.project.importFiles([nativeFsPath], true, rootItem, false);
                } catch (eImp1) {
                    try {
                        importSuccess = app.project.importFiles([fileObj.absoluteURI], true, rootItem, false);
                    } catch (eImp2) {
                        try {
                            importSuccess = app.project.importFiles([cleanPath], true, rootItem, false);
                        } catch (eImp3) {}
                    }
                }

                // Locate newly imported item
                projectItem = this.findProjectItem(rootItem, cleanPath, fileName);
                if (!projectItem && rootItem.children && rootItem.children.numItems > 0) {
                    // Check the most recently added item in rootItem
                    var lastItem = rootItem.children[rootItem.children.numItems - 1];
                    if (lastItem) projectItem = lastItem;
                }
            }

            if (!projectItem) {
                return JSON.stringify({ success: false, error: "Não foi possível importar o arquivo no painel de Projeto do Premiere." });
            }

            // Refresh media metadata if available
            try {
                if (typeof projectItem.refreshMedia === "function") {
                    projectItem.refreshMedia();
                }
            } catch (eRef) {}

            // If no active sequence is open, inform user that it was added to Project Bin
            if (!activeSeq) {
                return JSON.stringify({
                    success: true,
                    insertedToSequence: false,
                    message: "Arquivo importado para o painel Projeto! (Abra uma Sequência na timeline para inserir na agulha CTI)."
                });
            }

            // 4. Get Current Playhead (CTI) Position
            var cti = activeSeq.getPlayerPosition();
            var ctiSec = (cti && typeof cti.seconds === "number") ? cti.seconds : 0;

            // 5. Select Best Available Track
            var targetTrackInfo = this.findOrCreateTargetTrack(activeSeq, isAudio, cti);
            var targetTrack = targetTrackInfo.track;
            var targetIndex = targetTrackInfo.index;

            var tracksList = isAudio ? activeSeq.audioTracks : activeSeq.videoTracks;
            if (!targetTrack && tracksList && tracksList.numTracks > 0) {
                targetTrack = tracksList[0];
                targetIndex = 0;
            }

            if (!targetTrack) {
                return JSON.stringify({ success: false, error: "Nenhuma faixa de " + (isAudio ? "áudio" : "vídeo") + " disponível na sequência." });
            }

            // Unlock track if locked
            try {
                if (typeof targetTrack.setLocked === "function" && targetTrack.isLocked()) {
                    targetTrack.setLocked(0);
                }
            } catch (eUnlock) {}

            // 6. Multi-Strategy Timeline Insertion Engine
            var inserted = false;
            var lastError = "";

            // Method 1: targetTrack.overwriteClip with Time object (cti)
            if (!inserted) {
                try {
                    targetTrack.overwriteClip(projectItem, cti);
                    inserted = true;
                } catch (eM1) { lastError = eM1.toString(); }
            }

            // Method 2: targetTrack.insertClip with Time object (cti)
            if (!inserted) {
                try {
                    targetTrack.insertClip(projectItem, cti);
                    inserted = true;
                } catch (eM2) { lastError = eM2.toString(); }
            }

            // Method 3: targetTrack.overwriteClip with seconds (float)
            if (!inserted) {
                try {
                    targetTrack.overwriteClip(projectItem, ctiSec);
                    inserted = true;
                } catch (eM3) { lastError = eM3.toString(); }
            }

            // Method 4: targetTrack.insertClip with seconds (float)
            if (!inserted) {
                try {
                    targetTrack.insertClip(projectItem, ctiSec);
                    inserted = true;
                } catch (eM4) { lastError = eM4.toString(); }
            }

            // Method 5: targetTrack.overwriteClip with ticks
            if (!inserted && cti && cti.ticks) {
                try {
                    targetTrack.overwriteClip(projectItem, cti.ticks);
                    inserted = true;
                } catch (eM5) { lastError = eM5.toString(); }
            }

            // Method 6: Sequence-level insertClip / overwriteClip
            if (!inserted) {
                try {
                    if (isAudio) {
                        activeSeq.insertClip(projectItem, cti, 0, targetIndex);
                    } else {
                        activeSeq.insertClip(projectItem, cti, targetIndex, 0);
                    }
                    inserted = true;
                } catch (eM6) {
                    try {
                        if (isAudio) {
                            activeSeq.overwriteClip(projectItem, cti, 0, targetIndex);
                        } else {
                            activeSeq.overwriteClip(projectItem, cti, targetIndex, 0);
                        }
                        inserted = true;
                    } catch (eM6b) { lastError = eM6b.toString(); }
                }
            }

            // Method 7: Try all other unlocked tracks
            if (!inserted && tracksList && tracksList.numTracks > 0) {
                for (var t = 0; t < tracksList.numTracks; t++) {
                    var candidate = tracksList[t];
                    if (!candidate) continue;
                    try {
                        candidate.overwriteClip(projectItem, cti);
                        inserted = true;
                        break;
                    } catch (eT1) {
                        try {
                            candidate.insertClip(projectItem, cti);
                            inserted = true;
                            break;
                        } catch (eT2) {
                            try {
                                candidate.overwriteClip(projectItem, ctiSec);
                                inserted = true;
                                break;
                            } catch (eT3) {}
                        }
                    }
                }
            }

            // Method 8: QE DOM Fallback Insertion
            if (!inserted) {
                try {
                    app.enableQE();
                    if (typeof qe !== "undefined" && qe.project) {
                        var qeActiveSeq = qe.project.getActiveSequence();
                        if (qeActiveSeq) {
                            if (isAudio && typeof qeActiveSeq.getAudioTrackAt === "function") {
                                var qeTrackA = qeActiveSeq.getAudioTrackAt(targetIndex);
                                if (qeTrackA && typeof qeTrackA.insert === "function") {
                                    qeTrackA.insert(nativeFsPath, ctiSec);
                                    inserted = true;
                                }
                            } else if (!isAudio && typeof qeActiveSeq.getVideoTrackAt === "function") {
                                var qeTrackV = qeActiveSeq.getVideoTrackAt(targetIndex);
                                if (qeTrackV && typeof qeTrackV.insert === "function") {
                                    qeTrackV.insert(nativeFsPath, ctiSec);
                                    inserted = true;
                                }
                            }
                        }
                    }
                } catch (eQEIns) {
                    lastError = eQEIns.toString();
                }
            }

            if (!inserted) {
                return JSON.stringify({
                    success: false,
                    error: "Não foi possível posicionar o clipe na timeline. Detalhes: " + lastError
                });
            }

            return JSON.stringify({
                success: true,
                insertedToSequence: true,
                message: "Inserido com sucesso na timeline na posição da agulha (CTI)!"
            });

        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Erro inesperado: " + err.toString()
            });
        }
    }
};
