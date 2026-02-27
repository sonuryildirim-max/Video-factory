// video-upload.js — Folder, URL and single-file upload with UploadQueue

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
    API_BASE: '',
    USE_MOCK: false,
    MAX_CONCURRENCY: 2,
    MAX_FILE_SIZE: 5_368_709_120,
    ALLOWED_EXTENSIONS: ['.mp4', '.mov', '.avi', '.mkv', '.webm'],
    ALLOWED_MIME_TYPES: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'],
    POLL_BASE_MS: 3000,   // Exponential backoff: 3s, 6s, 9s, 12s, 15s, then 15s
    POLL_MAX_MS: 15000,
    POLL_MAX_ATTEMPTS: 72,     // ~10 min max with backoff
};

// ─── STYLES (injected once) ───────────────────────────────────────────────────
(function injectStyles() {
    if (document.getElementById('bk-upload-styles')) return;
    const s = document.createElement('style');
    s.id = 'bk-upload-styles';
    s.textContent = `
        .bk-inline-error {
            background:#fef2f2;border:1.5px solid #fca5a5;border-radius:6px;
            padding:12px 14px;display:flex;align-items:flex-start;gap:10px;
            margin-bottom:14px;animation:bk-fade-up .2s ease;
        }
        .bk-inline-error-body { flex:1; }
        .bk-inline-error-title { font-weight:700;color:#dc2626;margin-bottom:2px;font-size:12.5px; }
        .bk-inline-error-msg   { font-size:.85rem;color:#b91c1c; }
        .bk-inline-error-close {
            background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;padding:0;
        }
        .bk-inline-error-close:hover { color:#dc2626; }
        .bk-toast {
            position:fixed;bottom:24px;right:24px;padding:12px 16px;
            border-radius:8px;color:white;font-weight:500;z-index:9999;
            box-shadow:0 6px 20px rgba(0,0,0,.15);display:flex;align-items:center;
            gap:8px;max-width:340px;animation:bk-slide-up .25s ease;font-size:13px;
        }
        .bk-toast-success { background:linear-gradient(135deg,#16a34a,#22c55e); }
        .bk-toast-error   { background:linear-gradient(135deg,#dc2626,#ef4444); }
        .bk-toast-info    { background:linear-gradient(135deg,#09090b,#3f3f46); }
        .bk-toast-warning { background:linear-gradient(135deg,#d97706,#f59e0b); }
        @keyframes bk-fade-up  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes bk-slide-up { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        @keyframes bk-slide-out-down { from{opacity:1;transform:none} to{opacity:0;transform:translateY(12px)} }
        .bk-progress-phase { font-weight:600; }
    `;
    document.head.appendChild(s);
})();

// ─── STATE ────────────────────────────────────────────────────────────────────
const UploadState = {
    mode: 'file',  // 'file' | 'folder' | 'url'
    selectedFile: null,
    selectedPreset: (localStorage.getItem('bk_upload_quality') || '720p'),
    singlePollId: null,
    singleVideoId: null,
    uploadInProgress: false,
    queue: null,    // UploadQueue instance (folder/url modes)
};

// ─── THEME ────────────────────────────────────────────────────────────────────
function getTheme() {
    var stored = localStorage.getItem('bk_theme');
    if (stored) return stored;
    if (typeof window.matchMedia !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
}
function setTheme(theme) {
    theme = theme === 'light' ? 'light' : 'dark';
    localStorage.setItem('bk_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcons();
}
function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }
function updateThemeIcons() {
    const useEl = document.getElementById('themeIconUse');
    if (useEl) useEl.setAttribute('href', getTheme() === 'dark' ? '#u-sun' : '#u-moon');
}

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
let els = {};

document.addEventListener('DOMContentLoaded', async () => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/6fc158cb-e1f3-47a7-948e-99419562fa3d', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'video-upload.js:DOMContentLoaded', 'message': 'Auth check start', data: { path: '/api/videos/statistics?date_range=1d' }, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => { });
    // #endregion
    try {
        await apiFetch('/api/videos/statistics?date_range=1d');
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/6fc158cb-e1f3-47a7-948e-99419562fa3d', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'video-upload.js:authSuccess', 'message': 'Auth ok, removing bk-auth-pending', data: {}, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => { });
        // #endregion
        document.documentElement.classList.remove('bk-auth-pending');
    } catch (e) {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/6fc158cb-e1f3-47a7-948e-99419562fa3d', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'video-upload.js:authCatch', 'message': 'Auth failed', data: { error: String(e?.message || e), name: String(e?.name || '') }, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => { });
        // #endregion
        document.documentElement.classList.remove('bk-auth-pending');
        const msg = document.createElement('div');
        msg.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.85);color:#f4f4f5;font-family:system-ui;text-align:center;padding:24px;';
        msg.innerHTML = '<div><p style="margin-bottom:16px;font-size:15px;">Oturum kontrolü başarısız. Giriş yapmanız gerekiyor.</p><a href="/login" style="color:#00ffff;text-decoration:none;font-weight:600;">Giriş sayfasına git →</a></div>';
        document.body.appendChild(msg);
        return;
    }
    els = {
        uploadArea: document.getElementById('uploadArea'),
        fileInput: document.getElementById('fileInput'),
        browseBtn: document.getElementById('browseBtn'),
        folderArea: document.getElementById('folderArea'),
        folderInput: document.getElementById('folderInput'),
        folderBrowseBtn: document.getElementById('folderBrowseBtn'),
        folderSummary: document.getElementById('folderSummary'),
        urlQueueInput: document.getElementById('urlQueueInput'),
        urlPlatformHint: document.getElementById('urlPlatformHint'),
        fileInfo: document.getElementById('fileInfo'),
        fileDetails: document.getElementById('fileDetails'),
        presetBtns: document.querySelectorAll('.preset-btn'),
        modeTabs: document.querySelectorAll('.mode-tab'),
        videoName: document.getElementById('videoName'),
        tags: document.getElementById('tags'),
        projectName: document.getElementById('projectName'),
        notes: document.getElementById('notes'),
        progressContainer: document.getElementById('progressContainer'),
        progressFill: document.getElementById('progressFill'),
        progressPercent: document.getElementById('progressPercent'),
        progressLabel: document.getElementById('progressLabel'),
        progressMetrics: document.getElementById('progressMetrics'),
        resultContainer: document.getElementById('resultContainer'),
        resultContent: document.getElementById('resultContent'),
        uploadBtn: document.getElementById('uploadBtn'),
        startQueueBtn: document.getElementById('startQueueBtn'),
        queueSection: document.getElementById('queueSection'),
        queueList: document.getElementById('uploadQueue'),
        queueCount: document.getElementById('queueCount'),
        queueSummaryText: document.getElementById('queueSummaryText'),
        concurrentInput: document.getElementById('concurrentInput'),
        processingProfile: document.getElementById('processingProfile'),
        presetResolutionSection: document.getElementById('presetResolutionSection'),
        folderSelect: document.getElementById('folderId'),
    };

    setupListeners();
    restoreUploadPreferences();
    updatePresetVisibility();
    updateThemeIcons();
    await loadFolders();
    switchMode('file');
});

async function loadFolders() {
    try {
        const res = await apiFetch('/api/folders');
        const folders = (res?.folders || []).filter(f => !f.is_system);
        if (els.folderSelect) {
            els.folderSelect.innerHTML = '<option value="">Klasör Seçin (Opsiyonel)...</option>' +
                folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
        }
    } catch (_) { }
}

const VALID_PROCESSING_PROFILES = ['6', '8', '10', '12', '14', 'web_opt'];
function restoreUploadPreferences() {
    const raw = localStorage.getItem('bk_upload_processing_profile') || 'crf_14';
    const profile = VALID_PROCESSING_PROFILES.includes(raw) ? raw : '12';
    const quality = localStorage.getItem('bk_upload_quality') || '720p';
    if (els.processingProfile) els.processingProfile.value = profile;
    UploadState.selectedPreset = quality;
    els.presetBtns?.forEach(b => {
        if (b.dataset.preset === quality) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
}

// Expose for onclick
if (typeof window !== 'undefined') window.toggleTheme = toggleTheme;

// ─── PROCESSING MODE / PRESET LOGIC SHIELD ─────────────────────────────────────
/** Web Optimize: resolution preset hidden; quality sent as original (no scale). Native: preset visible. */
function isResolutionLocked() {
    const profile = els.processingProfile?.value || '12';
    return profile === 'web_opt' || profile === 'web_optimize';
}

function getEffectiveQuality() {
    if (isResolutionLocked()) return 'original';
    return UploadState.selectedPreset || '720p';
}

function updatePresetVisibility() {
    const section = els.presetResolutionSection;
    if (!section) return;
    const hide = isResolutionLocked();
    section.style.display = hide ? 'none' : 'block';
    els.presetBtns?.forEach(b => {
        b.style.pointerEvents = hide ? 'none' : '';
        b.style.opacity = hide ? '0.5' : '';
        b.setAttribute('aria-disabled', hide ? 'true' : 'false');
    });
}

// ─── CONCURRENCY ───────────────────────────────────────────────────────────────
function getConcurrentUploads() {
    const n = parseInt(els.concurrentInput?.value, 10) || 2;
    return Math.max(1, Math.min(8, n));
}

// ─── MODE SWITCHING ───────────────────────────────────────────────────────────
function switchMode(mode) {
    UploadState.mode = mode;

    els.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    document.querySelectorAll('.mode-panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${mode}`);
    });

    if (mode === 'file') {
        els.uploadBtn.style.display = '';
        els.startQueueBtn.style.display = 'none';
    } else {
        els.uploadBtn.style.display = 'none';
        els.startQueueBtn.style.display = '';
        // Init queue if not already
        if (!UploadState.queue) {
            UploadState.queue = new UploadQueue(getConcurrentUploads());
            UploadState.queue
                .on('item-added', () => renderQueue())
                .on('item-updated', () => renderQueue())
                .on('queue-done', () => onQueueDone());
        }
        syncStartBtn();
    }
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
function setupListeners() {
    // Mode tabs
    els.modeTabs.forEach(t => {
        t.addEventListener('click', () => switchMode(t.dataset.mode));
    });

    // Preset buttons
    els.presetBtns.forEach(b => {
        b.addEventListener('click', () => {
            els.presetBtns.forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            UploadState.selectedPreset = b.dataset.preset;
            localStorage.setItem('bk_upload_quality', b.dataset.preset);
        });
    });

    // File mode
    els.browseBtn?.addEventListener('click', e => { e.stopPropagation(); els.fileInput.click(); });
    els.fileInput?.addEventListener('change', e => {
        const files = Array.from(e.target.files || []);
        if (files.length) handleFileSelection(files);
        e.target.value = '';
    });
    els.uploadArea?.addEventListener('click', () => { if (!UploadState.uploadInProgress) els.fileInput.click(); });
    setupDragDrop(els.uploadArea, files => { if (files.length) handleFileSelection(files); });

    // Folder mode
    els.folderBrowseBtn?.addEventListener('click', e => { e.stopPropagation(); els.folderInput.click(); });
    els.folderArea?.addEventListener('click', () => els.folderInput.click());
    els.folderInput?.addEventListener('change', e => handleFolderSelect(e.target.files));
    setupDragDrop(els.folderArea, files => handleFolderSelect(files));

    // URL mode
    els.urlQueueInput?.addEventListener('input', () => {
        const hint = detectUrlPlatform(els.urlQueueInput.value.trim());
        if (els.urlPlatformHint) els.urlPlatformHint.textContent = hint ? `Tespit: ${hint}` : '';
    });
    els.urlQueueInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') addUrlToQueue();
    });

    els.processingProfile?.addEventListener('change', () => {
        const profile = els.processingProfile?.value || '12';
        localStorage.setItem('bk_upload_processing_profile', profile);
        updatePresetVisibility();
    });
}

function setupDragDrop(el, onDrop) {
    if (!el) return;
    const prevent = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => el.addEventListener(ev, prevent));
    ['dragenter', 'dragover'].forEach(ev => el.addEventListener(ev, () => el.classList.add('dragover')));
    ['dragleave', 'drop'].forEach(ev => el.addEventListener(ev, () => el.classList.remove('dragover')));
    el.addEventListener('drop', e => {
        const items = e.dataTransfer?.items;
        if (items) {
            const files = [];
            for (const item of items) {
                if (item.kind === 'file') files.push(item.getAsFile());
            }
            onDrop(files);
        } else {
            onDrop(Array.from(e.dataTransfer?.files || []));
        }
    });
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────
function validateFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const mimeOk = CONFIG.ALLOWED_MIME_TYPES.some(m => file.type === m);
    const extOk = CONFIG.ALLOWED_EXTENSIONS.includes(ext);
    if (!mimeOk && !extOk)
        return { ok: false, error: `Desteklenmeyen format: .${ext}. İzin verilenler: ${CONFIG.ALLOWED_EXTENSIONS.join(', ')}` };
    if (file.size > CONFIG.MAX_FILE_SIZE)
        return { ok: false, error: `Dosya çok büyük (${formatBytes(file.size)}). Maks. 5 GB.` };
    if (file.size === 0)
        return { ok: false, error: 'Dosya boş.' };
    return { ok: true };
}

function isVideoFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return CONFIG.ALLOWED_EXTENSIONS.includes(ext)
        || CONFIG.ALLOWED_MIME_TYPES.some(m => file.type === m);
}

// ─── SINGLE FILE MODE ─────────────────────────────────────────────────────────
function handleFileSelection(files) {
    if (!files || files.length === 0) return;
    clearErrors();
    if (files.length === 1) {
        const v = validateFile(files[0]);
        if (!v.ok) { showError('Geçersiz Dosya', v.error); return; }
        handleSingleFile(files[0]);
        return;
    }
    // Multiple files: use queue (same as folder mode)
    const videoFiles = Array.from(files).filter(isVideoFile);
    const invalid = Array.from(files).filter(f => !isVideoFile(f));
    if (invalid.length) {
        showToast(`${invalid.length} dosya atlandı (video formatı değil).`, 'warning');
    }
    if (!videoFiles.length) {
        showError('Geçersiz Dosyalar', 'Seçilen dosyalarda geçerli video bulunamadı. MP4, MOV, AVI, MKV, WEBM desteklenir.');
        return;
    }
    const preset = getEffectiveQuality();
    const tags = els.tags?.value?.trim() || '';
    const project = els.projectName?.value?.trim() || '';
    const notes = els.notes?.value?.trim() || '';
    if (!UploadState.queue) {
        UploadState.queue = new UploadQueue(getConcurrentUploads());
        UploadState.queue
            .on('item-added', () => renderQueue())
            .on('item-updated', () => renderQueue())
            .on('queue-done', () => onQueueDone());
    }
    const processingProfile = els.processingProfile?.value || '12';
    const folderId = els.folderSelect?.value || null;
    videoFiles.forEach(f => {
        const v = validateFile(f);
        if (!v.ok) { showToast(`${f.name}: ${v.error}`, 'error'); return; }
        UploadState.queue.add({ type: 'file', file: f, preset, tags, project, notes, processingProfile, folderId, name: f.name, size: f.size });
    });
    renderQueue();
    els.fileInfo?.classList.remove('show');
    els.uploadBtn?.style.setProperty('display', 'none');
    els.startQueueBtn?.style.setProperty('display', '');
    syncStartBtn();
}

function handleSingleFile(file) {
    clearErrors();
    const v = validateFile(file);
    if (!v.ok) { showError('Geçersiz Dosya', v.error); return; }
    UploadState.selectedFile = file;
    renderFileInfo(file);
    applyAntiUpscale(file);
    els.uploadBtn.disabled = false;
    els.uploadBtn?.style.setProperty('display', '');
    els.startQueueBtn?.style.setProperty('display', 'none');
}

/** Anti-upscale: disable preset buttons that would upscale (height < target). File mode only. */
function applyAntiUpscale(file) {
    if (!els.presetBtns || isResolutionLocked()) return;
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.muted = true;
    vid.playsInline = true;
    vid.onloadedmetadata = () => {
        const h = vid.videoHeight || 0;
        const maxHeight = { original: 99999, '720p': 720, '1080p': 1080, '2k': 1440, '4k': 2160 };
        els.presetBtns.forEach(b => {
            const preset = b.dataset.preset;
            const max = maxHeight[preset] ?? 720;
            const disabled = h > 0 && h < max;
            b.style.pointerEvents = disabled ? 'none' : '';
            b.style.opacity = disabled ? '0.5' : '';
            b.setAttribute('aria-disabled', disabled ? 'true' : 'false');
            b.title = disabled ? `Kaynak ${h}px, ${preset} en az ${max}px gerektirir` : '';
        });
        URL.revokeObjectURL(vid.src);
    };
    vid.onerror = () => { URL.revokeObjectURL(vid.src); };
    vid.src = URL.createObjectURL(file);
}

function renderFileInfo(file) {
    if (!els.fileInfo || !els.fileDetails) return;
    els.fileDetails.innerHTML = `
        <div class="detail-item"><div class="detail-label">Dosya Adı</div><div class="detail-value">${escapeHtml(file.name)}</div></div>
        <div class="detail-item"><div class="detail-label">Boyut</div><div class="detail-value">${formatBytes(file.size)}</div></div>
        <div class="detail-item"><div class="detail-label">Tür</div><div class="detail-value">${file.type || '—'}</div></div>
        <div class="detail-item"><div class="detail-label">Son Değişiklik</div><div class="detail-value">${new Date(file.lastModified).toLocaleDateString('tr-TR')}</div></div>
    `;
    els.fileInfo.classList.add('show');
}

async function uploadSingle() {
    if (!UploadState.selectedFile || UploadState.uploadInProgress) return;
    clearErrors();
    els.resultContainer?.classList.remove('show');

    UploadState.uploadInProgress = true;
    if (els.uploadBtn) { els.uploadBtn.disabled = true; els.uploadBtn.textContent = 'Yükleniyor…'; }
    els.progressContainer?.classList.add('show');
    setProgressPhase('Sunucuya bağlanılıyor…', 0);

    if (CONFIG.USE_MOCK) {
        await runMockSingleUpload();
        return;
    }

    try {
        const presigned = await apiFetch('/api/videos/upload/presigned', {
            method: 'POST',
            body: JSON.stringify({
                fileName: UploadState.selectedFile.name,
                fileSize: UploadState.selectedFile.size,
                quality: getEffectiveQuality(),
                processingProfile: els.processingProfile?.value || '12',
                displayName: els.videoName?.value.trim() || null,
                tags: els.tags?.value.trim() || '',
                projectName: els.projectName?.value.trim() || '',
                notes: els.notes?.value.trim() || '',
                folder_id: els.folderSelect?.value || null,
            }),
        });

        UploadState.singleVideoId = presigned.video_id;
        setProgressPhase("R2'ye yükleniyor…", 5);

        await uploadToR2(presigned.upload.upload_link, UploadState.selectedFile, (pct, metrics) => {
            setProgressPhase("R2'ye yükleniyor…", 5 + pct * 0.85, metrics);
        });

        setProgressPhase('Tamamlanıyor…', 92);
        const complete = await apiFetch(`/api/videos/upload/complete?token=${presigned.upload.upload_token}`, {
            method: 'POST',
            body: JSON.stringify({ upload_successful: true, actual_file_size: UploadState.selectedFile.size }),
        });

        setProgressPhase('Tamamlandı', 100);
        await delay(300);
        els.progressContainer?.classList.remove('show');
        if (els.uploadBtn) { els.uploadBtn.textContent = 'Yükle'; }
        UploadState.uploadInProgress = false;
        renderSingleResult(complete);
        startSinglePoll(complete.job_id || presigned.video_id);

    } catch (err) {
        await handleSingleError(err.message, UploadState.singleVideoId);
    }
}

async function runMockSingleUpload() {
    let p = 0;
    const iv = setInterval(() => {
        p = Math.min(100, p + Math.random() * 14 + 4);
        setProgressPhase("R2'ye yükleniyor… (demo)", p * 0.9);
        if (p >= 100) {
            clearInterval(iv);
            const mockId = 'vid_mock_' + Math.random().toString(36).slice(2, 9);
            UploadState.singleVideoId = mockId;
            setProgressPhase('Tamamlandı', 100);
            setTimeout(() => {
                els.progressContainer?.classList.remove('show');
                if (els.uploadBtn) { els.uploadBtn.textContent = 'Yükle'; }
                UploadState.uploadInProgress = false;
                renderSingleResult({ job_id: mockId, normalized_name: sanitizeName(UploadState.selectedFile?.name || 'video.mp4') });
                startSinglePoll(mockId);
            }, 400);
        }
    }, 150);
}

async function handleSingleError(msg, jobId) {
    UploadState.uploadInProgress = false;
    els.progressContainer?.classList.remove('show');
    els.resultContainer?.classList.remove('show');
    if (els.uploadBtn) { els.uploadBtn.disabled = false; els.uploadBtn.textContent = 'Yükle'; }
    if (jobId) {
        try { await apiFetch(`/api/videos/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }); } catch (_) { }
    }
    showError('Yükleme Başarısız', msg);
    resetProgress();
}

function renderSingleResult(data) {
    if (!els.resultContainer || !els.resultContent) return;
    els.resultContent.innerHTML = `
        <div class="result-item">
            <div class="detail-label">Video ID</div>
            <div class="detail-value">${escapeHtml(data.job_id || '—')}</div>
        </div>
        <div class="result-item">
            <div class="detail-label">Orijinal Ad</div>
            <div class="detail-value">${escapeHtml(UploadState.selectedFile?.name || '—')}</div>
        </div>
        <div class="result-item">
            <div class="detail-label">Normalize Ad</div>
            <div class="detail-value">${escapeHtml((data.normalized_name || '—') + ' (' + (UploadState.selectedPreset || '720p') + ')')}</div>
        </div>
        <div class="result-item">
            <div class="detail-label">Durum</div>
            <div class="detail-value">
                <span class="status-badge status-uploaded" id="statusBadge">Yüklendi</span>
                <span id="statusPhase" style="margin-left:6px;font-size:11px;color:var(--text-subtle)">Sırada bekliyor</span>
            </div>
        </div>
        <div class="result-item">
            <div class="detail-label">Tahmini Süre</div>
            <div class="detail-value">~5–10 dakika</div>
        </div>
        <div class="video-preview">
            <h4>Video Önizleme</h4>
            <div class="preview-placeholder" id="previewArea">
                <svg width="20" height="20"><use href="#u-clock"/></svg>
                <span>İşlem tamamlandığında burada görünecek</span>
            </div>
        </div>
    `;
    els.resultContainer.classList.add('show');
    els.resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── SINGLE FILE POLLING (exponential backoff, pauses when tab hidden) ─────────
function startSinglePoll(videoId) {
    stopSinglePoll();
    let attempts = 0;

    function getBackoffMs() {
        const step = Math.min(attempts, 5);
        return Math.min(CONFIG.POLL_BASE_MS * step || CONFIG.POLL_BASE_MS, CONFIG.POLL_MAX_MS);
    }

    function tick() {
        if (document.hidden) return;
        attempts++;
        if (attempts > CONFIG.POLL_MAX_ATTEMPTS) {
            stopSinglePoll();
            updateSingleStatus('timeout', 'Durum alınamadı. Tekrar denemek için sayfayı yenileyin.');
            return;
        }

        (async () => {
            try {
                if (CONFIG.USE_MOCK) {
                    const s = mockPollStep(attempts);
                    updateSingleStatus(s.status, s.phase);
                    if (s.status === 'completed') { stopSinglePoll(); renderCompletedSingle(videoId, null); showToast('Video hazır!', 'success'); return; }
                } else {
                    const data = await apiFetch(`/api/videos/${videoId}`);
                    const { status, processing_message } = data.bk || data;
                    updateSingleStatus(status?.toLowerCase() || 'processing', processing_message || '');
                    if (status === 'COMPLETED') { stopSinglePoll(); renderCompletedSingle(videoId, data); showToast('Video hazır!', 'success'); return; }
                    if (status === 'FAILED') { stopSinglePoll(); showToast('İşlem başarısız.', 'error'); return; }
                }
            } catch (_) { }
            if (!document.hidden && UploadState.singleVideoId) {
                UploadState.singlePollId = setTimeout(tick, getBackoffMs());
            }
        })();
    }

    function onVisibilityChange() {
        if (document.hidden) {
            if (UploadState.singlePollId) { clearTimeout(UploadState.singlePollId); UploadState.singlePollId = null; }
        } else if (UploadState.singleVideoId && !UploadState.singlePollId) {
            tick();
        }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    UploadState._visibilityPollCleanup = () => document.removeEventListener('visibilitychange', onVisibilityChange);

    UploadState.singlePollId = setTimeout(tick, 0);
}


function stopSinglePoll() {
    if (UploadState.singlePollId != null) {
        clearTimeout(UploadState.singlePollId);
        UploadState.singlePollId = null;
    }
    if (typeof UploadState._visibilityPollCleanup === 'function') {
        UploadState._visibilityPollCleanup();
        UploadState._visibilityPollCleanup = null;
    }
}

function updateSingleStatus(status, phase) {
    const badge = document.getElementById('statusBadge');
    const phaseEl = document.getElementById('statusPhase');
    const labels = { uploaded: 'Yüklendi', processing: 'İşleniyor', completed: 'Tamamlandı', failed: 'Başarısız', timeout: 'Zaman Aşımı' };
    if (badge) { badge.className = `status-badge status-${status}`; badge.textContent = labels[status] ?? status; }
    if (phaseEl) phaseEl.textContent = phase;
}

function renderCompletedSingle(videoId, videoData) {
    const publicUrl = (videoData?.bk?.public_url) || (videoData?.files?.[0]?.link)
        || `https://cdn.bilgekarga.tr/videos/${encodeURIComponent(String(videoId))}`;
    const preview = document.getElementById('previewArea');
    if (!preview) return;
    preview.innerHTML = `
        <video controls style="max-width:100%;border-radius:6px;">
            <source src="${escapeHtml(publicUrl)}" type="video/mp4">
        </video>
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
            <button class="btn btn-primary" style="height:30px;padding:0 12px;font-size:12px" onclick="navigator.clipboard.writeText('${escapeHtml(publicUrl)}').then(()=>showToast('Link kopyalandı','success'))">Linki Kopyala</button>
        </div>
    `;
}

// ─── FOLDER MODE ──────────────────────────────────────────────────────────────
function handleFolderSelect(files) {
    const videoFiles = Array.from(files).filter(isVideoFile);
    if (!videoFiles.length) { showToast('Klasörde video dosyası bulunamadı.', 'error'); return; }

    if (els.folderSummary) {
        els.folderSummary.textContent = `${videoFiles.length} video dosyası bulundu, kuyruğa eklendi.`;
    }

    const preset = getEffectiveQuality();
    const processingProfile = els.processingProfile?.value || '12';
    const tags = els.tags?.value.trim() || '';
    const project = els.projectName?.value.trim() || '';
    const notes = els.notes?.value.trim() || '';
    const folderId = els.folderSelect?.value || null;

    videoFiles.forEach(f => {
        UploadState.queue.add({ type: 'file', file: f, preset, tags, project, notes, processingProfile, folderId, name: f.name, size: f.size });
    });

    syncStartBtn();
}

// ─── URL MODE ─────────────────────────────────────────────────────────────────
function addUrlToQueue() {
    const raw = els.urlQueueInput?.value.trim() || '';
    if (!raw) return;

    const resolved = resolveUploadUrl(raw);
    if (!resolved) { showToast('Geçerli bir URL girin (https://…)', 'error'); return; }

    const preset = getEffectiveQuality();
    const processingProfile = els.processingProfile?.value || '12';
    const tags = els.tags?.value.trim() || '';
    const project = els.projectName?.value.trim() || '';
    const notes = els.notes?.value.trim() || '';
    const folderId = els.folderSelect?.value || null;

    UploadState.queue.add({
        type: 'url',
        url: resolved.url,
        platform: resolved.platform,
        name: resolved.name,
        size: null,
        preset, tags, project, notes, processingProfile, folderId
    });

    if (els.urlQueueInput) els.urlQueueInput.value = '';
    if (els.urlPlatformHint) els.urlPlatformHint.textContent = '';
    syncStartBtn();
}

function detectUrlPlatform(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('drive.google.com')) return 'Google Drive';
        if (u.hostname.includes('dropbox.com')) return 'Dropbox';
        if (u.hostname.includes('1drv.ms') || u.hostname.includes('onedrive.live.com')) return 'OneDrive';
        const ext = u.pathname.split('.').pop().toLowerCase();
        if (CONFIG.ALLOWED_EXTENSIONS.includes('.' + ext)) return 'Doğrudan Video URL';
        return '';
    } catch { return ''; }
}

function resolveUploadUrl(raw) {
    try {
        const u = new URL(raw);
        // Google Drive
        const gd = u.pathname.match(/\/file\/d\/([^/]+)/);
        if (gd) return {
            url: `https://drive.google.com/uc?export=download&confirm=t&id=${gd[1]}`,
            platform: 'Google Drive',
            name: `drive-${gd[1].slice(0, 8)}.mp4`,
        };
        // Dropbox: ?dl=1 and www.dropbox.com → dl.dropboxusercontent.com
        if (u.hostname.includes('dropbox.com')) {
            u.searchParams.set('dl', '1');
            if (u.hostname === 'www.dropbox.com') u.hostname = 'dl.dropboxusercontent.com';
            return { url: u.toString(), platform: 'Dropbox', name: u.pathname.split('/').pop() || 'dropbox-video.mp4' };
        }
        // OneDrive
        if (u.hostname.includes('1drv.ms') || u.hostname.includes('onedrive.live.com')) {
            return { url: raw, platform: 'OneDrive', name: 'onedrive-video.mp4' };
        }
        // Direct URL
        const name = u.pathname.split('/').pop() || 'video.mp4';
        return { url: raw, platform: 'Doğrudan URL', name };
    } catch { return null; }
}

// ─── UPLOAD QUEUE ─────────────────────────────────────────────────────────────
class UploadQueue {
    constructor(concurrency = 2) {
        this.concurrency = concurrency;
        this.items = [];
        this.running = 0;
        this._listeners = {};
    }

    add(item) {
        const q = {
            id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            ...item,
            status: 'waiting',
            progress: 0,
            phase: 'Bekliyor',
            jobId: null,
            error: null,
        };
        this.items.push(q);
        this._emit('item-added', q);
        return q.id;
    }

    start() {
        this._processNext();
    }

    _processNext() {
        while (this.running < this.concurrency) {
            const next = this.items.find(i => i.status === 'waiting');
            if (!next) break;
            this.running++;
            next.status = 'uploading';
            this._emit('item-updated', next);

            this._runItem(next)
                .finally(() => {
                    this.running--;
                    this._processNext();
                    if (this.items.every(i => i.status === 'done' || i.status === 'error')) {
                        this._emit('queue-done', this.items);
                    }
                });
        }
    }

    async _runItem(item) {
        try {
            if (item.type === 'file') await this._uploadFile(item);
            else await this._importUrl(item);
            item.status = 'done';
            item.progress = 100;
            item.phase = 'Tamamlandı';
            this._emit('item-updated', item);
        } catch (err) {
            item.status = 'error';
            item.error = err.message;
            item.phase = err.message;
            this._emit('item-updated', item);
        }
    }

    async _uploadFile(item) {
        const file = item.file;
        const v = validateFile(file);
        if (!v.ok) throw new Error(v.error);

        if (CONFIG.USE_MOCK) {
            for (let p = 0; p <= 100; p += Math.random() * 18 + 6) {
                item.progress = Math.min(100, p);
                item.phase = p < 90 ? "R2'ye yükleniyor…" : 'Tamamlanıyor…';
                this._emit('item-updated', item);
                await delay(120);
            }
            return;
        }

        item.phase = 'Presigned URL alınıyor…';
        this._emit('item-updated', item);

        const presigned = await apiFetch('/api/videos/upload/presigned', {
            method: 'POST',
            body: JSON.stringify({
                fileName: file.name,
                fileSize: file.size,
                quality: isResolutionLocked() ? '1080p' : (item.preset || '720p'),
                processingProfile: item.processingProfile || els.processingProfile?.value || '12',
                displayName: els.videoName?.value.trim() || null,
                tags: item.tags || '',
                projectName: item.project || '',
                notes: item.notes || '',
                folder_id: item.folderId || null,
            }),
        });

        item.jobId = presigned.video_id;
        item.phase = "R2'ye yükleniyor…";
        item.total = file.size;
        item.loaded = 0;
        this._emit('item-updated', item);

        await uploadToR2(presigned.upload.upload_link, file, (pct, metrics) => {
            item.progress = 5 + pct * 0.85;
            if (metrics) {
                item.loaded = metrics.loaded;
                item.total = metrics.total;
                item.speedMBps = metrics.bytesPerSecond / 1048576;
                item.etaSeconds = metrics.etaSeconds;
            }
            this._emit('item-updated', item);
        });

        item.phase = 'Tamamlanıyor…';
        item.progress = 93;
        this._emit('item-updated', item);

        await apiFetch(`/api/videos/upload/complete?token=${presigned.upload.upload_token}`, {
            method: 'POST',
            body: JSON.stringify({ upload_successful: true, actual_file_size: file.size }),
        });
    }

    async _importUrl(item) {
        item.phase = 'URL işleniyor…';
        this._emit('item-updated', item);

        if (CONFIG.USE_MOCK) {
            for (let p = 0; p <= 100; p += Math.random() * 20 + 8) {
                item.progress = Math.min(100, p);
                item.phase = 'İndiriliyor ve R2\'ye aktarılıyor…';
                this._emit('item-updated', item);
                await delay(200);
            }
            return;
        }

        const result = await apiFetch('/api/videos/upload/from-url', {
            method: 'POST',
            body: JSON.stringify({
                url: item.url,
                quality: isResolutionLocked() ? '1080p' : (item.preset || '720p'),
                processingProfile: item.processingProfile || els.processingProfile?.value || '12',
                displayName: els.videoName?.value.trim() || null,
                projectName: item.project || '',
                tags: item.tags || '',
                notes: item.notes || '',
            }),
        });

        item.jobId = result.job_id;
        item.progress = 100;
    }

    removeItem(id) {
        const item = this.items.find(i => i.id === id);
        if (item && item.status === 'waiting') {
            this.items = this.items.filter(i => i.id !== id);
            this._emit('item-updated', null);
        }
    }

    clear() {
        this.items = this.items.filter(i => i.status === 'uploading');
        this._emit('item-updated', null);
    }

    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
        return this;
    }

    _emit(event, data) {
        (this._listeners[event] || []).forEach(fn => fn(data));
    }
}

function startQueue() {
    if (!UploadState.queue) return;
    els.startQueueBtn && (els.startQueueBtn.disabled = true);
    UploadState.queue.concurrency = getConcurrentUploads();
    UploadState.queue.start();
}

function onQueueDone() {
    const items = UploadState.queue?.items || [];
    const done = items.filter(i => i.status === 'done').length;
    const errors = items.filter(i => i.status === 'error').length;
    if (errors === 0) showToast(`${done} video kuyruğa alındı!`, 'success');
    else showToast(`${done} başarılı, ${errors} hatalı.`, 'warning');
    if (els.startQueueBtn) els.startQueueBtn.disabled = false;
}

function syncStartBtn() {
    const hasWaiting = UploadState.queue?.items.some(i => i.status === 'waiting');
    if (els.startQueueBtn) els.startQueueBtn.disabled = !hasWaiting;
    const total = UploadState.queue?.items.length || 0;
    if (total > 0) els.queueSection?.classList.add('visible');
    else els.queueSection?.classList.remove('visible');
}

// ─── QUEUE RENDERING ──────────────────────────────────────────────────────────
function renderQueue() {
    const items = UploadState.queue?.items || [];
    if (!els.queueList) return;

    if (!items.length) {
        els.queueSection?.classList.remove('visible');
        return;
    }

    els.queueSection?.classList.add('visible');
    if (els.queueCount) els.queueCount.textContent = items.length;

    const done = items.filter(i => i.status === 'done').length;
    const active = items.filter(i => i.status === 'uploading').length;
    if (els.queueSummaryText) {
        els.queueSummaryText.textContent = active > 0
            ? `${active} yükleniyor · ${done}/${items.length} tamamlandı`
            : `${done}/${items.length} tamamlandı`;
    }

    const statusLabel = { waiting: 'Bekliyor', uploading: 'Yükleniyor', done: 'Tamamlandı', error: 'Hata' };
    const statusClass = { waiting: 'qs-waiting', uploading: 'qs-uploading', done: 'qs-done', error: 'qs-error' };
    const fillClass = { uploading: 'animate', done: 'done', error: 'error' };

    els.queueList.innerHTML = items.map(item => `
        <div class="queue-item" data-id="${escapeHtml(item.id)}">
            <span class="queue-item-icon">
                <svg width="14" height="14"><use href="#u-film"/></svg>
            </span>
            <div class="queue-item-info">
                <div class="queue-item-name" title="${escapeHtml(item.name + (item.preset ? ' (' + item.preset + ')' : ''))}">${escapeHtml(truncate(item.name + (item.preset ? ' (' + item.preset + ')' : ''), 48))}</div>
                <div class="queue-item-meta">${item.preset} ${item.size ? '· ' + formatBytes(item.size) : ''} ${item.platform ? '· ' + escapeHtml(item.platform) : ''}</div>
            </div>
            <div class="queue-item-progress">
                <div class="queue-progress-bar">
                    <div class="queue-progress-fill ${fillClass[item.status] || ''}"
                         style="width:${item.progress}%"></div>
                </div>
                <div class="queue-item-phase">${escapeHtml(item.phase || '')}</div>
                ${(item.loaded != null && item.total) ? `<div class="queue-item-metrics">${escapeHtml(formatProgressMetrics(item.loaded, item.total, (item.speedMBps || 0) * 1048576, item.etaSeconds || 0))}</div>` : ''}
            </div>
            <span class="queue-item-status ${statusClass[item.status] || 'qs-waiting'}">
                ${statusLabel[item.status] || item.status}
            </span>
            <button class="queue-item-remove" onclick="removeQueueItem('${escapeHtml(item.id)}')"
                    ${item.status === 'uploading' ? 'disabled' : ''} title="Kaldır">
                <svg width="12" height="12"><use href="#u-x"/></svg>
            </button>
        </div>
    `).join('');

    syncStartBtn();
}

function removeQueueItem(id) {
    UploadState.queue?.removeItem(id);
    renderQueue();
}

// ─── RESET ────────────────────────────────────────────────────────────────────
function resetAll() {
    stopSinglePoll();
    UploadState.selectedFile = null;
    UploadState.uploadInProgress = false;
    UploadState.singleVideoId = null;

    if (els.fileInput) els.fileInput.value = '';
    if (els.folderInput) els.folderInput.value = '';
    if (els.urlQueueInput) els.urlQueueInput.value = '';
    if (els.videoName) els.videoName.value = '';
    if (els.tags) els.tags.value = '';
    if (els.projectName) els.projectName.value = '';
    if (els.notes) els.notes.value = '';
    if (els.folderSummary) els.folderSummary.textContent = '';
    if (els.urlPlatformHint) els.urlPlatformHint.textContent = '';

    els.fileInfo?.classList.remove('show');
    els.progressContainer?.classList.remove('show');
    els.resultContainer?.classList.remove('show');
    els.queueSection?.classList.remove('visible');

    if (els.uploadBtn) { els.uploadBtn.disabled = true; els.uploadBtn.textContent = 'Yükle'; }
    if (UploadState.mode === 'file') {
        els.uploadBtn?.style.setProperty('display', '');
        els.startQueueBtn?.style.setProperty('display', 'none');
    } else {
        syncStartBtn();
    }

    // Reset queue
    UploadState.queue = null;

    clearErrors();
    resetProgress();

    // Reset presets to 720p
    els.presetBtns?.forEach((b, i) => b.classList.toggle('active', i === 0));
    UploadState.selectedPreset = '720p';
}

// ─── UPLOAD HELPER ────────────────────────────────────────────────────────────
function uploadToR2(url, file, onProgress) {
    return new Promise((resolve, reject) => {
        let startTime = null;
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
            if (!e.lengthComputable || !onProgress) return;
            if (startTime == null) startTime = Date.now();
            const loaded = e.loaded, total = e.total;
            const pct = loaded / total;
            const elapsedMs = Date.now() - startTime;
            const elapsedSec = elapsedMs / 1000;
            const bytesPerSecond = elapsedSec > 0 ? loaded / elapsedSec : 0;
            const remaining = total - loaded;
            const etaSeconds = bytesPerSecond > 0 ? remaining / bytesPerSecond : 0;
            onProgress(pct, { loaded, total, bytesPerSecond, etaSeconds });
        });
        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else {
                const status = xhr.status;
                let msg = `R2 hatası: ${status} ${xhr.statusText}`;
                if (status === 413) msg = 'Dosya çok büyük (100MB limit). Lütfen daha küçük dosya yükleyin veya R2 yapılandırmasını kontrol edin.';
                if (status === 403) msg = 'CORS veya yetki hatası. R2 bucket CORS ayarlarını kontrol edin.';
                reject(new Error(msg));
            }
        });
        xhr.addEventListener('error', () => reject(new Error('Ağ bağlantısı kesildi.')));
        xhr.addEventListener('abort', () => reject(new Error('Yükleme iptal edildi.')));
        xhr.addEventListener('timeout', () => reject(new Error('Bağlantı zaman aşımına uğradı.')));
        xhr.timeout = 30 * 60 * 1000;
        const usePost = typeof url === 'string' && url.includes('/api/videos/upload/direct/');
        xhr.open(usePost ? 'POST' : 'PUT', url, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);
    });
}

function mockPollStep(attempt) {
    if (attempt < 3) return { status: 'uploaded', phase: 'Sırada bekliyor' };
    if (attempt < 8) return { status: 'processing', phase: 'Hetner sunucusunda' };
    if (attempt < 14) return { status: 'processing', phase: 'HandBrake encode' };
    if (attempt < 18) return { status: 'processing', phase: "R2'ye yükleniyor" };
    return { status: 'completed', phase: 'Tamamlandı' };
}

// ─── PROGRESS HELPERS ─────────────────────────────────────────────────────────
function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond < 1024) return (bytesPerSecond || 0).toFixed(1) + ' KB/s';
    return ((bytesPerSecond || 0) / 1048576).toFixed(2) + ' MB/s';
}

function formatETA(etaSeconds) {
    if (!etaSeconds || etaSeconds < 1) return '';
    const m = Math.floor(etaSeconds / 60);
    const s = Math.floor(etaSeconds % 60);
    return m ? `${m}:${String(s).padStart(2, '0')}` : `${s} sn`;
}

function formatProgressMetrics(loaded, total, bytesPerSecond, etaSeconds) {
    if (loaded == null || total == null || !total) return '';
    const parts = [formatBytes(loaded) + ' / ' + formatBytes(total)];
    if (bytesPerSecond > 0) parts.push(formatSpeed(bytesPerSecond));
    if (etaSeconds > 0) parts.push('Kalan: ' + formatETA(etaSeconds));
    return parts.join(' · ');
}

function setProgressPhase(label, pct, metrics) {
    if (els.progressLabel) els.progressLabel.innerHTML = `<span class="bk-progress-phase">${escapeHtml(label)}</span>`;
    if (els.progressFill) els.progressFill.style.width = `${Math.min(Math.round(pct), 100)}%`;
    if (els.progressPercent) els.progressPercent.textContent = `${Math.min(Math.round(pct), 100)}%`;
    if (els.progressMetrics) els.progressMetrics.textContent = metrics ? formatProgressMetrics(metrics.loaded, metrics.total, metrics.bytesPerSecond, metrics.etaSeconds) : '';
}

function resetProgress() {
    if (els.progressFill) els.progressFill.style.width = '0%';
    if (els.progressPercent) els.progressPercent.textContent = '0%';
    if (els.progressMetrics) els.progressMetrics.textContent = '';
}

// ─── INLINE ERROR ─────────────────────────────────────────────────────────────
function showError(title, message) {
    clearErrors();
    const el = document.createElement('div');
    el.className = 'bk-inline-error';
    el.setAttribute('role', 'alert');
    el.innerHTML = `
        <div class="bk-inline-error-body">
            <div class="bk-inline-error-title">${escapeHtml(title)}</div>
            <div class="bk-inline-error-msg">${escapeHtml(message)}</div>
        </div>
        <button class="bk-inline-error-close" onclick="this.closest('.bk-inline-error').remove()">×</button>
    `;
    document.querySelector('.actions')?.parentNode.insertBefore(el, document.querySelector('.actions'));
}

function clearErrors() {
    document.querySelectorAll('.bk-inline-error').forEach(e => e.remove());
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const t = document.createElement('div');
    t.className = `bk-toast bk-toast-${type}`;
    t.setAttribute('role', 'status');
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => {
        t.style.animation = 'bk-slide-out-down .3s ease forwards';
        setTimeout(() => t.remove(), 280);
    }, 4000);
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };

    let res;
    try {
        res = await fetch(`${CONFIG.API_BASE}${path}`, {
            credentials: 'include',
            headers,
            ...options,
        });
    } catch (e) {
        throw new Error(navigator.onLine === false ? 'İnternet bağlantısı yok.' : 'Bağlantı kurulamadı. Lütfen tekrar deneyin.');
    }
    if (res.status === 401) {
        location.href = '/login';
        throw new Error('Oturum sonlandı. Yeniden giriş yapın.');
    }
    if (res.status === 429) throw new Error('Çok fazla istek. Kısa süre sonra tekrar deneyin.');
    if (res.status === 503) throw new Error('Servis geçici olarak kullanılamıyor.');
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
    }
    return res.json();
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function escapeHtml(text) {
    if (text == null) return '';
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
}

function truncate(str, len) {
    return !str || str.length <= len ? (str ?? '') : str.slice(0, len) + '…';
}

function formatBytes(bytes, dec = 1) {
    if (!bytes) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(dec)} ${s[i]}`;
}

function sanitizeName(name) {
    const trMap = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };
    return name
        .replace(/[çğıöşüÇĞİÖŞÜ]/g, c => trMap[c] || c)
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/, '');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── GLOBAL EXPORTS ───────────────────────────────────────────────────────────
Object.assign(window, {
    uploadSingle,
    resetAll,
    addUrlToQueue,
    removeQueueItem,
    startQueue,
    showToast,
});

// Backwards compatibility aliases used by HTML onclick
window.uploadVideo = uploadSingle;
window.resetForm = resetAll;
