// Video Dashboard — merged: Agent-2 architecture + config/API/aria/truncate layer

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
    API_BASE: '',
    PAGE_SIZE: 20,
    USE_MOCK: false,
};

// #region agent log
function _dbg(payload) {
    var p = { sessionId: '2595de', location: payload.location || 'video-dashboard.js', message: payload.message, data: payload.data || {}, timestamp: Date.now(), runId: payload.runId, hypothesisId: payload.hypothesisId };
    fetch('http://127.0.0.1:7244/ingest/6e5419c3-da58-4eff-91a7-eca90285816f', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2595de' }, body: JSON.stringify(p) }).catch(function () { });
}
// #endregion

// ─── INLINE SVG ICONS (Lucide-style, used in JS-generated HTML) ───────────────
const IC = {
    eye: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    download: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    retry: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.53"/></svg>`,
    alert: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    inbox: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
    search: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    film: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
    check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    copy: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
};

// ─── NOTIFICATION STYLES (injected once) ─────────────────────────────────────
(function injectNotificationStyles() {
    if (document.getElementById('bk-notification-styles')) return;
    const style = document.createElement('style');
    style.id = 'bk-notification-styles';
    style.textContent = `
        .bk-notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 10px;
            color: var(--text);
            font-weight: 500;
            z-index: 9999;
            box-shadow: 0 10px 30px var(--shadow);
            max-width: 400px;
            word-wrap: break-word;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: bk-slide-in .3s ease;
        }
        .bk-notification-info    { background: var(--bg); border: 1px solid var(--border); }
        .bk-notification-success { background: #16a34a; color: #fff; }
        .bk-notification-error   { background: var(--danger); color: #fff; }
        .bk-notification-warning { background: #ca8a04; color: #fff; }
        .bk-notification-success .bk-notification-dismiss,
        .bk-notification-error .bk-notification-dismiss,
        .bk-notification-warning .bk-notification-dismiss { color: rgba(255,255,255,.9); }
        .bk-notification-dismiss {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 1.2rem;
            padding: 0;
            margin-left: auto;
            flex-shrink: 0;
            line-height: 1;
        }
        .bk-notification-dismiss:hover { color: var(--text); }
        @keyframes bk-slide-in {
            from { transform: translateX(110%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes bk-slide-out {
            from { transform: translateX(0);    opacity: 1; }
            to   { transform: translateX(110%); opacity: 0; }
        }
        .bk-skeleton {
            background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%);
            background-size: 200% 100%;
            animation: bk-shimmer 1.4s infinite;
            border-radius: 6px;
        }
        @keyframes bk-shimmer {
            0%   { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        .bk-skeleton-row {
            display: grid;
            grid-template-columns: minmax(40px, auto) 2.5fr 1fr 0.9fr 0.8fr 0.7fr 1fr 1.1fr 1fr;
            padding: 0 16px;
            min-height: 52px;
            align-items: center;
            border-bottom: 1px solid var(--border);
        }
        .bk-skeleton-cell       { height: 20px; }
        .bk-skeleton-cell.wide  { height: 36px; }
        .bk-empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            color: var(--text-muted);
            gap: 12px;
        }
        .bk-empty-state-icon  { font-size: 3.5rem; }
        .bk-empty-state-title { font-size: 1.2rem; font-weight: 600; color: var(--text-2); }
        .bk-empty-state-sub   { font-size: .95rem; color: var(--text-subtle); }
        .bk-error-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            color: var(--danger);
            gap: 12px;
        }
        .bk-error-state-icon  { font-size: 3rem; }
        .bk-error-state-title { font-size: 1.1rem; font-weight: 600; }
        .bk-error-retry {
            margin-top: 8px;
            padding: 10px 20px;
            background: var(--bg);
            color: var(--text);
            border: none;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: background .15s;
        }
        .bk-error-retry:hover { background: var(--surface-hover); }
        .bk-confirm-overlay {
            position: fixed; inset: 0;
            background: var(--modal-overlay);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: bk-fade-in .2s ease;
        }
        @keyframes bk-fade-in { from { opacity: 0; } to { opacity: 1; } }
        .bk-confirm-box {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 28px;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 8px 32px var(--shadow);
            text-align: center;
        }
        .bk-confirm-icon  { font-size: 2.5rem; margin-bottom: 16px; }
        .bk-confirm-title { font-size: 1.2rem; font-weight: 600; color: var(--text); margin-bottom: 8px; }
        .bk-confirm-body  { color: var(--text-muted); margin-bottom: 24px; font-size: .95rem; }
        .bk-confirm-actions { display: flex; gap: 12px; justify-content: center; }
        .bk-confirm-cancel {
            padding: 10px 24px;
            background: var(--surface-hover);
            color: var(--text-2);
            border: 1px solid var(--border);
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: background .15s;
        }
        .bk-confirm-cancel:hover { background: var(--border); }
        .bk-confirm-danger {
            padding: 10px 24px;
            background: var(--danger);
            color: #fff;
            border: none;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: background .15s;
        }
        .bk-confirm-danger:hover { background: #b91c1c; }
    `;
    document.head.appendChild(style);
})();

// ─── EVENT MANAGER (SPA Listener Management + App-Level Events) ──────────────
class BKEventManager {
    constructor() {
        this.listeners = [];
        this._appSubs = {}; // { 'FOLDER_CHANGE': [fn, ...] }
    }
    add(el, type, fn, opt) {
        if (!el) return;
        el.addEventListener(type, fn, opt);
        this.listeners.push({ el, type, fn, opt });
    }
    removeAll() {
        this.listeners.forEach(l => l.el.removeEventListener(l.type, l.fn, l.opt));
        this.listeners = [];
    }
    on(eventName, fn) {
        if (!this._appSubs[eventName]) this._appSubs[eventName] = [];
        this._appSubs[eventName].push(fn);
    }
    emit(eventName, data) {
        if (eventName === 'FOLDER_CHANGE') {
            console.log('F-DEBUG: FOLDER_CHANGE emitted, folderId:', data);
        }
        const fns = this._appSubs[eventName];
        if (fns) fns.forEach(fn => { try { fn(data); } catch (e) { console.error('BKEventManager.emit', eventName, e); } });
    }
}
const EventManager = new BKEventManager();

/** URL'den folder id döner (folder_id veya folder); yoksa '' */
function getFolderFromUrl() {
    const search = new URLSearchParams(window.location.search);
    const out = search.get('folder_id') || search.get('folder') || '';
    if (out === '' || out == null) {
        console.log('F-DEBUG: getFolderFromUrl() returned:', out, '— (boş/null → tüm videolar listelenir)');
    } else {
        console.log('F-DEBUG: getFolderFromUrl() returned:', out);
    }
    return out;
}

// ─── APP STATE (single source of truth) ──────────────────────────────────────
const AppState = {
    isMainView: true,
    currentPage: 1,
    totalPages: 1,
    filters: { sort_by: 'created_at', sort_order: 'DESC' },
    videos: [],
    statistics: {},
    isLoadingVideos: false,
    isLoadingStats: false,
    videosError: null,
    statsError: null,
    selectedVideoIds: new Set(),
    selectedDeletedIds: new Set(),
    appUser: null,
    monitoringSecurityLogs: [],
    monitoringAppLogs: [],
    monitoringSearchQuery: '',
    deletedVideos: [],
    deletedCurrentPage: 1,
    deletedTotalPages: 1,
    deletedSearchQuery: '',
    agentStatus: { data: null, pollTimer: null, tickTimer: null },
    systemAlerts: { pollTimer: null },
};

// ─── Structured logging (JSON) for observability ─────────────────────────────
function logStructured(level, message, context = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...context,
    };
    const str = JSON.stringify(entry);
    if (level === 'error') console.error(str);
    else if (level === 'warn') console.warn(str);
    else console.log(str);
}
window.addEventListener('error', function (e) {
    logStructured('error', e.message || 'Uncaught error', { filename: e.filename, lineno: e.lineno, colno: e.colno });
});
window.addEventListener('unhandledrejection', function (e) {
    logStructured('error', 'Unhandled promise rejection', { reason: String(e.reason && (e.reason.message || e.reason)) });
});

// Active BKPlayer instance — destroyed when modal closes
let _activeBKPlayer = null;

// ─── DOM REFS ─────────────────────────────────────────────────────────────────
const Els = {};

function initDomRefs() {
    Els.navVideos = document.getElementById('navVideos');
    Els.navMonitoring = document.getElementById('navMonitoring');
    Els.navUsers = document.getElementById('navUsers');
    Els.panelVideos = document.getElementById('panelVideos');
    Els.panelMonitoring = document.getElementById('panelMonitoring');
    Els.panelUsers = document.getElementById('panelUsers');
    Els.totalVideos = document.getElementById('totalVideos');
    Els.completedVideos = document.getElementById('completedVideos');
    Els.processingVideos = document.getElementById('processingVideos');
    Els.storageGb = document.getElementById('storageGb');
    Els.totalSavingsGb = document.getElementById('totalSavingsGb');
    Els.videoTrend = document.getElementById('videoTrend');
    Els.completedTrend = document.getElementById('completedTrend');
    Els.processingTrend = document.getElementById('processingTrend');
    Els.storageTrend = document.getElementById('storageTrend');
    Els.searchInput = document.getElementById('searchInput');
    Els.searchInputTopBar = document.getElementById('searchInputTopBar');
    Els.searchInputSidebar = document.getElementById('searchInputSidebar');
    Els.libraryVideoCountBadge = document.getElementById('libraryVideoCountBadge');
    Els.statusFilter = document.getElementById('statusFilter');
    Els.presetFilter = document.getElementById('presetFilter');
    Els.dateFrom = document.getElementById('dateFrom');
    Els.dateTo = document.getElementById('dateTo');
    Els.videosTable = document.querySelector('#panelVideos .videos-table');
    Els.navDeleted = document.getElementById('navDeleted');
    Els.panelDeleted = document.getElementById('panelDeleted');
    Els.pagination = document.getElementById('pagination');
    Els.bulkRetryBtn = document.getElementById('bulkRetryBtn');
    Els.headerCheckbox = document.getElementById('headerCheckbox');
    Els.pageSize = document.getElementById('pageSize');
}

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

function toggleTheme() {
    const current = getTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
}

function updateThemeIcons() {
    const theme = getTheme();
    const useEl = document.getElementById('themeIconUse');
    if (useEl) useEl.setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
}

function applyRootUI() {
    if (AppState.appUser?.isRoot) {
        if (Els.navUsers) Els.navUsers.style.display = '';
        if (Els.navDeleted) Els.navDeleted.style.display = '';
        const navUsersDrawer = document.getElementById('navUsersDrawer');
        if (navUsersDrawer) navUsersDrawer.style.display = '';
        const navDeletedDrawer = document.getElementById('navDeletedDrawer');
        if (navDeletedDrawer) navDeletedDrawer.style.display = '';
        const r2Section = document.getElementById('r2BucketExplorerSection');
        if (r2Section) r2Section.style.display = 'block';
    }
    updateNukeButtonVisibility();
}

async function loadAppUser() {
    const me = await apiFetch('/api/me');
    AppState.appUser = me;
    applyRootUI();
}

// ─── SIDEBAR & LOGOUT ────────────────────────────────────────────────────────
function toggleSidebarCollapse() {
    if (typeof BK !== 'undefined' && BK.Sidebar && BK.Sidebar.toggleCollapse) {
        BK.Sidebar.toggleCollapse();
    } else {
        const sidebar = document.getElementById('bkSidebar');
        if (!sidebar) return;
        const collapsed = sidebar.classList.toggle('collapsed');
        try { localStorage.setItem('bk_sidebar_collapsed', collapsed ? '1' : '0'); } catch (_) { }
        updateSidebarToggleIcon(collapsed);
    }
}

function updateSidebarToggleIcon(collapsed) {
    if (typeof BK !== 'undefined' && BK.Sidebar && BK.Sidebar.updateToggleIcon) {
        BK.Sidebar.updateToggleIcon(collapsed);
    } else {
        const icon = document.getElementById('bkSidebarToggleIcon');
        if (icon) icon.setAttribute('href', collapsed ? '#i-chevron-right' : '#i-chevron-left');
    }
}

function applySidebarCollapsed() {
    if (typeof BK !== 'undefined' && BK.Sidebar && BK.Sidebar.applyCollapsed) {
        BK.Sidebar.applyCollapsed();
    } else {
        const sidebar = document.getElementById('bkSidebar');
        if (!sidebar) return;
        const collapsed = (typeof localStorage !== 'undefined' && localStorage.getItem('bk_sidebar_collapsed') === '1');
        sidebar.classList.toggle('collapsed', collapsed);
        updateSidebarToggleIcon(collapsed);
    }
}

function handleLogout() {
    Object.keys(localStorage).filter(k => k.startsWith('bk_')).forEach(k => localStorage.removeItem(k));
    window.location.href = '/login';
}

// ─── PATH-BASED VIEW (Dashboard / Library / Folders) ───────────────────────────
async function applyPathView() {
    const path = window.location.pathname;
    const panelDashboard = document.getElementById('panelDashboard');
    const panelVideos = document.getElementById('panelVideos');
    const panelFolders = document.getElementById('panelFolders');
    const panelMonitoring = document.getElementById('panelMonitoring');
    const panelDeleted = document.getElementById('panelDeleted');
    const panelUsers = document.getElementById('panelUsers');
    const topbarTitle = document.querySelector('.bk-topbar-title');
    const topbarSearch = document.querySelector('.bk-topbar-search');
    const topbarBadge = document.getElementById('libraryVideoCountBadge');

    // Clean up current view listeners
    EventManager.removeAll();

    // Hide all panels
    [panelDashboard, panelVideos, panelFolders, panelMonitoring, panelDeleted, panelUsers].forEach(p => {
        if (p) p.setAttribute('hidden', '');
    });
    document.querySelectorAll('.bk-sidebar-nav a').forEach(a => a.classList.remove('active'));

    // Re-attach view listeners
    setupViewListeners();

    if (path === '/' || path === '') {
        // Dashboard
        if (panelDashboard) panelDashboard.removeAttribute('hidden');
        const dash = document.getElementById('bkSidebarDashboard');
        if (dash) dash.classList.add('active');
        if (topbarTitle) topbarTitle.textContent = 'Dashboard';
        if (topbarSearch) topbarSearch.style.display = 'none';
        if (topbarBadge) topbarBadge.style.display = 'none';
        AppState.isMainView = true;
        loadStatistics();
        loadTopViewed();
        loadAgentStatus();
        populateDashboardStats();
    } else if (path === '/library') {
        // Library — URL as source of truth; URL'de yoksa mevcut state (örn. Klasörler'de yazılan arama) korunur
        const urlSearch = new URLSearchParams(window.location.search);
        const bucket = urlSearch.get('bucket') || '';
        const status = urlSearch.get('status') || '';
        const folderId = getFolderFromUrl();
        const searchFromUrl = urlSearch.get('search');
        const searchVal = (searchFromUrl !== null && searchFromUrl !== '') ? searchFromUrl : (AppState.filters && AppState.filters.search) || '';
        // #region agent log
        _dbg({ location: 'video-dashboard.js:applyPathView', message: 'library path: search from URL vs state', data: { searchFromUrl: searchFromUrl, searchInState: AppState.filters && AppState.filters.search, fullUrl: window.location.href }, hypothesisId: 'D' });
        // #endregion
        AppState.filters = AppState.filters || {};
        if (bucket) AppState.filters.bucket = bucket; else delete AppState.filters.bucket;
        if (status) AppState.filters.status = status; else delete AppState.filters.status;
        if (folderId) AppState.filters.folder_id = folderId; else delete AppState.filters.folder_id;
        AppState.filters.search = searchVal;
        if (Els.searchInput) Els.searchInput.value = searchVal;
        if (Els.searchInputTopBar) Els.searchInputTopBar.value = searchVal;
        if (Els.searchInputSidebar) Els.searchInputSidebar.value = searchVal;
        if (searchVal && (searchFromUrl === null || searchFromUrl === '')) {
            const params = new URLSearchParams(window.location.search);
            params.set('search', searchVal);
            history.replaceState({}, '', '/library?' + params.toString());
        }
        if (panelVideos) panelVideos.removeAttribute('hidden');
        const lib = document.getElementById('bkSidebarLibrary');
        if (lib) lib.classList.add('active');
        if (folderId) {
            if (!AppState.folders?.length) await loadFolders();
            const folder = (AppState.folders || []).find(f => f.id == folderId);
            const folderLabel = folder ? 'Klasör: ' + folder.name : 'Library';
            if (topbarTitle) topbarTitle.textContent = folderLabel;
            document.title = folderLabel + ' — Bilge Karga Video';
        } else {
            if (topbarTitle) topbarTitle.textContent = bucket === 'deleted' ? 'Silinenler' : bucket === 'raw' ? 'Ham Videolar' : bucket === 'public' ? 'Yayında' : 'Library';
            document.title = 'Bilge Karga Video';
        }
        if (topbarSearch) topbarSearch.style.display = '';
        if (topbarBadge) topbarBadge.style.display = '';
        AppState.isMainView = false;
        loadStatistics();
        loadVideos();
        loadTopViewed();
        loadAgentStatus();
        renderSidebarFolders();
        EventManager.emit('FOLDER_CHANGE', folderId);
    } else if (path === '/folders') {
        // Folders
        if (panelFolders) panelFolders.removeAttribute('hidden');
        const fold = document.getElementById('bkSidebarFolders');
        if (fold) fold.classList.add('active');
        if (topbarTitle) topbarTitle.textContent = 'Klasörler';
        if (topbarSearch) topbarSearch.style.display = 'none';
        if (topbarBadge) topbarBadge.style.display = 'none';
        loadFolders();
    } else {
        // Fallback: show Library; URL'den folder senkronu (popstate ile uyumlu)
        const folderIdFallback = getFolderFromUrl();
        if (folderIdFallback) {
            AppState.filters = AppState.filters || {};
            AppState.filters.folder_id = folderIdFallback;
        }
        if (panelVideos) panelVideos.removeAttribute('hidden');
        const lib = document.getElementById('bkSidebarLibrary');
        if (lib) lib.classList.add('active');
        if (topbarTitle) topbarTitle.textContent = 'Library';
        if (topbarSearch) topbarSearch.style.display = '';
        if (topbarBadge) topbarBadge.style.display = '';
        AppState.isMainView = false;
        loadStatistics();
        loadVideos();
        loadTopViewed();
        loadAgentStatus();
        renderSidebarFolders();
        EventManager.emit('FOLDER_CHANGE', folderIdFallback);
    }
}

function populateDashboardStats() {
    const s = AppState.statistics?.summary ?? {};
    const total = s.total_videos ?? 0;
    const completed = s.completed ?? 0;
    const processing = s.processing ?? 0;
    const pubBytes = s.public_storage_bytes ?? s.total_storage_bytes ?? 0;
    const dashEls = ['totalVideosDash', 'completedVideosDash', 'processingVideosDash', 'storageGbDash'];
    const el1 = document.getElementById('totalVideosDash');
    const el2 = document.getElementById('completedVideosDash');
    const el3 = document.getElementById('processingVideosDash');
    const el4 = document.getElementById('storageGbDash');
    if (el1) el1.textContent = String(total);
    if (el2) el2.textContent = String(completed);
    if (el3) el3.textContent = String(processing);
    if (el4) el4.textContent = pubBytes > 0 ? (pubBytes / 1_073_741_824).toFixed(1) + ' GB' : '0 GB';
    const agentEl = document.getElementById('agentLastSeenDash');
    const dotEl = document.getElementById('agentStatusDotDash');
    if (AppState.agentStatus.data) {
        const w = AppState.agentStatus.data.workers?.[0];
        const dbDate = AppState.agentStatus.data.server_last_activity || w?.last_heartbeat;
        const lastSeen = dbDate ? new Date(String(dbDate).endsWith('Z') ? dbDate : dbDate + 'Z').getTime() : 0;
        const diffSec = lastSeen > 0 ? Math.floor((Date.now() - lastSeen) / 1000) : Infinity;
        const ago = diffSec < 60 ? 'az önce' : diffSec < 3600 ? `${Math.floor(diffSec / 60)} dk önce` : diffSec < 86400 ? `${Math.floor(diffSec / 3600)} saat önce` : `${Math.floor(diffSec / 86400)} gün önce`;
        if (agentEl) agentEl.textContent = ago;
        if (dotEl) dotEl.style.background = diffSec < AGENT_OFFLINE_THRESHOLD_SEC ? 'var(--neon-emerald, #10b981)' : '#dc2626';
    }
}

// ─── FOLDERS PANEL ────────────────────────────────────────────────────────────
const FOLDER_ICON = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

async function loadFolders() {
    const grid = document.getElementById('foldersGrid');
    let all = [];
    try {
        const res = await apiFetch('/api/folders');
        all = res?.folders ?? [];
    } catch (_) {
        all = [];
    }
    AppState.folders = all;
    if (grid) {
        grid.innerHTML = all.length
            ? all.map(f => renderFolderCard(f)).join('')
            : '<p class="folders-empty">Henüz klasör yok. Yeni Klasör butonuyla oluşturun.</p>';
    }
    renderSidebarFolders();
    populateMultiUploadFolderSelect();
}

/** Dynamic sidebar folder list — DOM: data-folder-id on outermost layer; click on full row (no dead zone) */
function renderSidebarFolders() {
    const container = document.getElementById('sidebarFoldersContainer');
    if (!container) return;
    const folders = AppState.folders || [];
    const search = new URLSearchParams(window.location.search);
    const selectedFolderId = search.get('folder_id') || search.get('folder');

    container.innerHTML = folders.map(f => {
        if (f.is_system) return '';
        const active = selectedFolderId == f.id ? ' active' : '';
        const fid = String(f.id ?? '');
        return `<div class="sidebar-sub-item${active}" data-folder-id="${escapeHtml(fid)}" role="button" tabindex="0">
            <span class="bk-sidebar-label">${escapeHtml(f.name)}</span>
        </div>`;
    }).join('');

    // Tıklama en dış katmanda (div) — ölü nokta kalmaz; BKEventManager ile
    container.querySelectorAll('.sidebar-sub-item').forEach(el => {
        EventManager.add(el, 'click', (e) => {
            e.preventDefault();
            const id = el.getAttribute('data-folder-id');
            const name = (el.querySelector('.bk-sidebar-label') || el).innerText.trim();
            console.log('F-DEBUG: Clicked Folder ID:', id, 'name:', name);
            if (id) filterByFolder(id, name);
        });
        EventManager.add(el, 'keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                el.click();
            }
        });
    });
}

function renderFolderCard(f) {
    const sys = f.is_system ? ' folder-system' : '';
    const onclick = f.is_system
        ? `filterByFolderBucket('${f.id === 1 ? 'public' : f.id === 2 ? 'raw' : 'deleted'}')`
        : `filterByFolder(${f.id}, '${String(f.name).replace(/'/g, "\\'")}')`;
    const deleteBtnHtml = f.is_system ? '' :
        `<button class="folder-delete-btn" onclick="event.stopPropagation();deleteFolder(${f.id})" title="Klasörü sil">✕</button>`;
    const dataAttr = f.is_system ? '' : ` data-folder-id="${escapeHtml(String(f.id ?? ''))}"`;
    return `<div class="folder-card${sys}"${dataAttr} onclick="${onclick}" style="cursor:pointer" role="button" tabindex="0">
        ${FOLDER_ICON}
        <span class="folder-name">${escapeHtml(f.name)}</span>
        <span class="folder-count">${f.count} video</span>
        ${deleteBtnHtml}
    </div>`;
}

function filterByFolder(folderId, folderName) {
    AppState.filters = { ...AppState.filters, folder_id: folderId };
    let url = '/library?folder=' + folderId;
    if (AppState.filters.search) url += '&search=' + encodeURIComponent(AppState.filters.search);
    history.pushState({}, '', url);
    applyPathView(); // URL + state + loadVideos; FOLDER_CHANGE applyPathView içinde emit edilir
}

/** Çoklu yükleme: klasör select'ini doldurur (loadFolders sonrası). */
function populateMultiUploadFolderSelect() {
    const sel = document.getElementById('multiUploadFolderId');
    if (!sel) return;
    const folders = AppState.folders || [];
    const userFolders = folders.filter(f => !f.is_system);
    const urlFolder = getFolderFromUrl();
    sel.innerHTML = '<option value="">Klasör seçin (opsiyonel)</option>' +
        userFolders.map(f => `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.name || '')}</option>`).join('');
    if (urlFolder) sel.value = urlFolder;
}

/**
 * Çoklu video yükle: her dosya için FormData'ya folder_id append edip POST /api/upload.
 * İşlem bitince tabloyu API'den yeniler (loadVideos).
 */
async function submitMultiUpload() {
    const input = document.getElementById('multiUploadFileInput');
    const btn = document.getElementById('multiUploadBtn');
    const statusEl = document.getElementById('multiUploadStatus');
    if (!input || !input.files || input.files.length === 0) {
        showNotification('Lütfen en az bir dosya seçin.', 'warning');
        return;
    }
    const files = Array.from(input.files);
    if (btn) { btn.disabled = true; }
    if (statusEl) statusEl.textContent = `${files.length} dosya yükleniyor…`;

    let ok = 0;
    let err = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const sel = document.getElementById('multiUploadFolderId');
        const selectedFolderId = (sel && sel.value) ? String(sel.value) : '';
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder_id', selectedFolderId);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/6e5419c3-da58-4eff-91a7-eca90285816f', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a294b5' }, body: JSON.stringify({ sessionId: 'a294b5', location: 'video-dashboard.js:submitMultiUpload', message: 'multi-upload per file', data: { index: i, fileName: file.name, selectedFolderId, hasFolder: !!selectedFolderId }, timestamp: Date.now(), hypothesisId: 'A' }) }).catch(() => { });
        // #endregion

        try {
            const res = await fetch(`${CONFIG.API_BASE || ''}/api/upload`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            if (res.status === 401) {
                location.href = '/login';
                return;
            }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || body.message || `HTTP ${res.status}`);
            }
            ok++;
        } catch (e) {
            err++;
            showNotification(`${file.name}: ${e.message}`, 'error');
        }
        if (statusEl) statusEl.textContent = `${i + 1}/${files.length} yüklendi…`;
    }

    if (statusEl) statusEl.textContent = err === 0 ? `${ok} dosya yüklendi.` : `${ok} başarılı, ${err} hata.`;
    if (btn) btn.disabled = false;
    input.value = '';
    if (ok > 0) {
        showNotification(`${ok} video yüklendi. Tablo yenileniyor.`, 'success');
        loadVideos();
    }
}

function filterByFolderBucket(bucket) {
    AppState.filters = { ...AppState.filters, bucket, folder_id: null };
    history.pushState({}, '', '/library?bucket=' + bucket);
    applyPathView();
}

async function deleteFolder(id) {
    if (!confirm('Bu klasörü silmek istediğinize emin misiniz? İçindeki videolar klasörsüz kalır.')) return;
    try {
        await apiFetch('/api/folders/' + id, { method: 'DELETE' });
        showNotification('Klasör silindi', 'success');
        loadFolders();
    } catch (e) {
        showNotification(e?.message || 'Klasör silinemedi', 'error');
    }
}

async function moveVideoToFolder(videoId, folderId) {
    const numId = folderId === '' || folderId === 'null' ? null : parseInt(folderId, 10);
    if (isNaN(numId) && numId !== null) return;
    try {
        await apiFetch(`/api/videos/${videoId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_id: numId }),
        });
        showNotification('Video klasöre taşındı', 'success');
        const video = AppState.videos.find(v => v.id == videoId);
        if (video) video.folder_id = numId;
        loadVideos();
        loadFolders();
    } catch (e) {
        showNotification(e?.message || 'Taşınamadı', 'error');
    }
}

async function showNewFolderModal() {
    const name = window.prompt('Yeni klasör adı:');
    if (!name || !name.trim()) return;
    try {
        const res = await apiFetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        showNotification('Klasör oluşturuldu: ' + (res?.name || name), 'success');
        loadFolders();
    } catch (e) {
        showNotification(e?.message || 'Klasör oluşturulamadı', 'error');
    }
}

/** URL modal: create folder via API, add to select and select it (real folder, no ghost). */
async function createFolderFromUrlModal() {
    const name = window.prompt('Yeni klasör adı:');
    if (!name || !name.trim()) return;
    const folderSelect = document.getElementById('urlFolder');
    if (!folderSelect) return;
    try {
        const res = await apiFetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        if (!res || !res.id) {
            showNotification('Klasör oluşturuldu ama yanıt geçersiz.', 'error');
            return;
        }
        const opt = document.createElement('option');
        opt.value = res.id;
        opt.textContent = res.name || name.trim();
        folderSelect.appendChild(opt);
        folderSelect.value = res.id;
        if (Array.isArray(AppState.folders)) {
            AppState.folders.push({ id: res.id, name: res.name || name.trim(), is_system: false });
        }
        showNotification('Klasör oluşturuldu ve seçildi: ' + (res.name || name.trim()), 'success');
    } catch (e) {
        showNotification(e?.message || 'Klasör oluşturulamadı', 'error');
    }
}

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initDomRefs();
    setupGlobalListeners();
    updateThemeIcons();
    applySidebarCollapsed();

    await loadAppUser();

    applyPathView();
    loadAgentStatus();
    startAgentStatusPoll();
    loadSystemAlerts();
    startSystemAlertsPoll();

    // Destroy BKPlayer on page unload (SPA navigation / tab close) to prevent audio leak
    window.addEventListener('pagehide', destroyActivePlayer);
    window.addEventListener('beforeunload', destroyActivePlayer);
});

function setupGlobalListeners() {
    // Global sidebar footer: Logout & Toggle (no tab dependency)
    const logoutBtn = document.getElementById('logoutBtn');
    const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebarCollapse);

    // Sidebar SPA links (Dashboard, Library, Folders)
    ['bkSidebarDashboard', 'bkSidebarLibrary', 'bkSidebarFolders'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const href = el.getAttribute('href');
                if (href && href !== '#') {
                    history.pushState({}, '', href);
                    applyPathView();
                }
            });
        }
    });

    // Popstate for browser back/forward
    window.addEventListener('popstate', applyPathView);

    // Visibility: pause polling when tab hidden, resume when visible
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            stopAgentStatusPoll();
            stopSystemAlertsPoll();
        } else {
            loadAgentStatus();
            loadSystemAlerts();
            startAgentStatusPoll();
            startSystemAlertsPoll();
        }
    });

    // ─── THUMBNAIL LIGHTBOX (Fullscreen on Click) ───────────────────────
    (function initThumbLightbox() {
        var _activeThumb = null;
        var _overlay = null;

        function getOrCreateOverlay() {
            if (_overlay) return _overlay;
            _overlay = document.createElement('div');
            _overlay.id = 'thumbLightboxOverlay';
            _overlay.className = 'thumb-lightbox';
            _overlay.setAttribute('role', 'dialog');
            _overlay.setAttribute('aria-modal', 'true');
            _overlay.setAttribute('aria-label', 'Küçük resim büyütülmüş');
            _overlay.innerHTML =
                '<div class="thumb-lightbox-backdrop"></div>' +
                '<div class="thumb-lightbox-content">' +
                '  <span class="thumb-lightbox-loading" aria-live="polite">Yükleniyor…</span>' +
                '  <img class="thumb-lightbox-img" alt="Video küçük resmi" />' +
                '  <button type="button" class="thumb-lightbox-close" aria-label="Kapat">&times;</button>' +
                '</div>';

            var img = _overlay.querySelector('.thumb-lightbox-img');
            var loadingEl = _overlay.querySelector('.thumb-lightbox-loading');
            img.addEventListener('load', function () { if (loadingEl) loadingEl.classList.add('hidden'); });
            img.addEventListener('error', function () { if (loadingEl) loadingEl.classList.add('hidden'); });

            _overlay.querySelector('.thumb-lightbox-backdrop').addEventListener('click', closeLightbox);
            _overlay.querySelector('.thumb-lightbox-close').addEventListener('click', closeLightbox);
            _overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });
            _overlay.querySelector('.thumb-lightbox-content').addEventListener('click', function (e) {
                var tag = e.target.tagName;
                if (tag === 'IMG' || tag === 'BUTTON') return;
                closeLightbox();
            });

            document.body.appendChild(_overlay);
            return _overlay;
        }

        function openLightbox(url, triggerEl) {
            var ov = getOrCreateOverlay();
            var img = ov.querySelector('.thumb-lightbox-img');
            var loadingEl = ov.querySelector('.thumb-lightbox-loading');
            if (img) {
                if (loadingEl) loadingEl.classList.remove('hidden');
                img.src = url;
                img.style.maxWidth = '90vw';
                img.style.maxHeight = '90vh';
                img.style.objectFit = 'contain';
            }
            ov.classList.add('show');
            document.body.style.overflow = 'hidden';
            ov.querySelector('.thumb-lightbox-close').focus();
            _activeThumb = triggerEl;
        }

        function closeLightbox() {
            if (!_overlay) return;
            _overlay.classList.remove('show');
            var img = _overlay.querySelector('.thumb-lightbox-img');
            if (img) img.removeAttribute('src');
            var loadingEl = _overlay.querySelector('.thumb-lightbox-loading');
            if (loadingEl) loadingEl.classList.remove('hidden');
            document.body.style.overflow = '';
            if (_activeThumb && document.contains(_activeThumb)) {
                _activeThumb.focus({ preventScroll: true });
            }
            _activeThumb = null;
        }

        // CLICK → anında aç, sabit kal
        document.addEventListener('click', function (e) {
            var thumb = e.target.closest('.video-thumb[data-thumb-url]');
            if (!thumb) return;
            e.preventDefault();
            e.stopPropagation();
            openLightbox(thumb.getAttribute('data-thumb-url'), thumb);
        }, true); // capture phase

        // Global erişim için (closeAllModals vs.)
        window._bkThumbLightbox = { close: closeLightbox, open: openLightbox };
    })();

    // ─── FLOATING HOVER PREVIEW (Follows Cursor) ─────────────────────────
    (function initHoverPreview() {
        var _previewEl = null;
        var _currentThumb = null;
        var _hoverTimer = null;

        function getOrCreatePreview() {
            if (_previewEl) return _previewEl;
            _previewEl = document.createElement('div');
            _previewEl.className = 'hover-preview-tooltip';
            _previewEl.innerHTML = '<span class="thumb-lightbox-loading hidden">Yükleniyor…</span><img src="" alt="Önizleme" />';
            document.body.appendChild(_previewEl);
            return _previewEl;
        }

        function showPreview(url, clientX, clientY) {
            var el = getOrCreatePreview();
            var img = el.querySelector('img');
            var loading = el.querySelector('span');

            if (img.getAttribute('src') !== url) {
                loading.classList.remove('hidden');
                img.style.display = 'none';
                img.onload = function () {
                    loading.classList.add('hidden');
                    img.style.display = 'block';
                };
                img.onerror = function () {
                    loading.classList.add('hidden');
                };
                img.src = url;
            }

            positionPreview(clientX, clientY);
            el.classList.add('show');
        }

        function positionPreview(clientX, clientY) {
            if (!_previewEl || !_previewEl.classList.contains('show')) return;

            // X offset 15px right of cursor
            var x = clientX + 15;
            // Y offset 15px below cursor
            var y = clientY + 15;

            // Simple collision detection
            var estWidth = 400; // Expected max width
            var estHeight = 250; // Expected max height

            if (x + estWidth > window.innerWidth) {
                x = clientX - estWidth - 15;
                if (x < 0) x = 10;
            }
            if (y + estHeight > window.innerHeight) {
                y = clientY - estHeight - 15;
                if (y < 0) y = 10;
            }

            _previewEl.style.left = x + 'px';
            _previewEl.style.top = y + 'px';
        }

        function hidePreview() {
            if (_previewEl) {
                _previewEl.classList.remove('show');
            }
        }

        document.addEventListener('mouseover', function (e) {
            var thumb = e.target.closest('.video-thumb[data-thumb-url]');
            if (!thumb) return;
            _currentThumb = thumb;
            var url = thumb.getAttribute('data-thumb-url');
            if (!url) return;

            if (_hoverTimer) clearTimeout(_hoverTimer);
            // Küçük bir gecikme ekliyoruz ki fare hızlıca gezerken anlık popup'lar fırlamasın
            _hoverTimer = setTimeout(function () {
                // Sadece hala aynı thumb üzerindeysek aç
                if (_currentThumb === thumb) {
                    showPreview(url, e.clientX, e.clientY);
                }
            }, 100);
        });

        document.addEventListener('mousemove', function (e) {
            if (_currentThumb && _previewEl && _previewEl.classList.contains('show')) {
                positionPreview(e.clientX, e.clientY);
            }
        });

        document.addEventListener('mouseout', function (e) {
            var thumb = e.target.closest('.video-thumb[data-thumb-url]');
            if (!thumb) return;
            // Thumb içinde hareket etmeye devam ediyorsa kapatma
            if (thumb.contains(e.relatedTarget)) return;

            if (_hoverTimer) clearTimeout(_hoverTimer);
            if (_currentThumb === thumb) {
                _currentThumb = null;
                hidePreview();
            }
        });
    })();

    // Çoklu yükle: dosya seçilince Yükle butonunu aktif et
    const multiInput = document.getElementById('multiUploadFileInput');
    const multiBtn = document.getElementById('multiUploadBtn');
    const multiStatus = document.getElementById('multiUploadStatus');
    if (multiInput && multiBtn) {
        multiInput.addEventListener('change', function () {
            const n = (this.files && this.files.length) || 0;
            multiBtn.disabled = n === 0;
            if (multiStatus) multiStatus.textContent = n > 0 ? n + ' dosya seçildi' : '';
        });
    }
}

const AGENT_POLL_INTERVAL_MS = 30000;
function startAgentStatusPoll() {
    stopAgentStatusPoll();
    AppState.agentStatus.pollTimer = setInterval(loadAgentStatus, AGENT_POLL_INTERVAL_MS);
    AppState.agentStatus.tickTimer = setInterval(tickAgentStatusDisplay, AGENT_POLL_INTERVAL_MS);
}
function stopAgentStatusPoll() {
    if (AppState.agentStatus.pollTimer) { clearInterval(AppState.agentStatus.pollTimer); AppState.agentStatus.pollTimer = null; }
    if (AppState.agentStatus.tickTimer) { clearInterval(AppState.agentStatus.tickTimer); AppState.agentStatus.tickTimer = null; }
}

async function loadAgentStatus() {
    const lastEl = document.getElementById('agentLastSeen');
    const modeEl = document.getElementById('agentModeLabel');
    const dotEl = document.getElementById('agentStatusDot');
    if (!lastEl || !modeEl) return;
    try {
        const res = await apiFetch('/api/status');
        const workers = res.workers || [];
        const server_last_activity = res.server_last_activity || null;
        AppState.agentStatus.data = { workers, server_last_activity, fetchedAt: Date.now() };
        if (!workers.length && !server_last_activity) {
            lastEl.textContent = 'Sunucu yok';
            modeEl.textContent = 'Sunucu Durumu: —';
            if (dotEl) dotEl.style.background = 'var(--text-subtle)';
        } else {
            updateAgentStatusDisplay();
        }
    } catch (err) {
        AppState.agentStatus.data = null;
        logStructured('warn', 'Agent status fetch failed', { error: err?.message || String(err) });
        lastEl.textContent = 'Bağlantı hatası';
        modeEl.textContent = 'Sunucu Durumu: —';
        if (dotEl) dotEl.style.background = 'var(--text-subtle)';
    }
}

const AGENT_OFFLINE_THRESHOLD_SEC = 900; // 15 dakika

function updateAgentStatusDisplay() {
    const lastEl = document.getElementById('agentLastSeen');
    const modeEl = document.getElementById('agentModeLabel');
    const dotEl = document.getElementById('agentStatusDot');
    if (!lastEl || !modeEl) return;
    if (!AppState.agentStatus.data) return;
    const w = AppState.agentStatus.data.workers?.[0];
    const dbDate = AppState.agentStatus.data.server_last_activity || w?.last_heartbeat;
    const lastSeen = dbDate
        ? new Date(String(dbDate).endsWith('Z') ? dbDate : dbDate + 'Z').getTime()
        : 0;
    const diffSec = lastSeen > 0 ? Math.floor((Date.now() - lastSeen) / 1000) : Infinity;
    let ago = '—';
    if (diffSec < 60) ago = 'az önce';
    else if (diffSec < 3600) ago = `${Math.floor(diffSec / 60)} dk önce`;
    else if (diffSec < 86400) ago = `${Math.floor(diffSec / 3600)} saat önce`;
    else ago = `${Math.floor(diffSec / 86400)} gün önce`;

    const isActive = diffSec < AGENT_OFFLINE_THRESHOLD_SEC;
    const status = isActive ? 'ACTIVE' : 'OFFLINE';

    lastEl.textContent = `Son Görülme: ${ago}`;
    modeEl.textContent = `Sunucu Durumu: ${status}`;
    if (dotEl) {
        dotEl.style.background = isActive ? 'var(--neon-emerald, #10b981)' : '#dc2626';
    }
}

function tickAgentStatusDisplay() {
    const d = AppState.agentStatus.data;
    if (d && (d.workers?.length || d.server_last_activity)) {
        updateAgentStatusDisplay();
    }
}

// ─── V17 İki kademeli canlı UI alarm (warning/critical) ─────────────────────
const SYSTEM_ALERTS_POLL_INTERVAL_MS = 12000;

async function loadSystemAlerts() {
    const banner = document.getElementById('system-alert-banner');
    const apiSlot = document.getElementById('api-injection-slot');
    const mainTitle = document.getElementById('alert-main-title');
    const alertCritical = document.getElementById('alert-text-critical');
    const alertWarning = document.getElementById('alert-text-warning');
    if (!banner || !apiSlot || !mainTitle || !alertCritical || !alertWarning) return;
    try {
        const res = await apiFetch('/api/alerts');
        if (!res || typeof res !== 'object') {
            banner.style.display = 'none';
            return;
        }
        const status = res.status || null;
        const message = (res.message || '').trim();
        if (status === 'warning' || status === 'critical') {
            banner.style.display = 'block';
            apiSlot.textContent = message || '';
            if (status === 'warning') {
                banner.classList.add('warning-mode');
                mainTitle.textContent = 'Sistem uyarısı';
                alertWarning.style.display = 'block';
                alertCritical.style.display = 'none';
            } else {
                banner.classList.remove('warning-mode');
                mainTitle.textContent = 'Önemli uyarı';
                alertCritical.style.display = 'block';
                alertWarning.style.display = 'none';
            }
        } else {
            banner.style.display = 'none';
        }
    } catch (err) {
        logStructured('warn', 'System alerts fetch failed', { error: err?.message || String(err) });
        banner.style.display = 'none';
    }
}

function startSystemAlertsPoll() {
    stopSystemAlertsPoll();
    AppState.systemAlerts.pollTimer = setInterval(loadSystemAlerts, SYSTEM_ALERTS_POLL_INTERVAL_MS);
}
function stopSystemAlertsPoll() {
    if (AppState.systemAlerts.pollTimer) { clearInterval(AppState.systemAlerts.pollTimer); AppState.systemAlerts.pollTimer = null; }
}

function dismissAlertBanner() {
    const banner = document.getElementById('system-alert-banner');
    if (!banner) return;
    banner.style.display = 'none';
    banner.removeAttribute('data-demo');
    startSystemAlertsPoll();
}

function destroyActivePlayer() {
    if (_activeBKPlayer) {
        try { _activeBKPlayer.destroy(); } catch (_) { }
        _activeBKPlayer = null;
    }
}

// ─── EVENT LISTENERS (attached once) ─────────────────────────────────────────
// ─── VIEW LISTENERS (attached via EventManager for SPA cleanup) ─────────────
function setupViewListeners() {
    // #region agent log
    _dbg({ location: 'video-dashboard.js:setupViewListeners', message: 'setupViewListeners called', data: { hasStatusFilter: !!Els.statusFilter, hasPresetFilter: !!Els.presetFilter, hasSearchInputSidebar: !!Els.searchInputSidebar }, hypothesisId: 'A' });
    // #endregion
    if (!Els.statusFilter || !Els.presetFilter) return;
    // #region agent log
    _dbg({ location: 'video-dashboard.js:setupViewListeners', message: 'attaching search listeners', data: { sidebar: !!Els.searchInputSidebar }, hypothesisId: 'A' });
    // #endregion
    function applySearch(val) {
        AppState.filters.search = val;
        AppState.currentPage = 1;
        loadVideos();
        if (Els.searchInput && Els.searchInput !== Els.searchInputTopBar) Els.searchInput.value = val;
        if (Els.searchInputTopBar) Els.searchInputTopBar.value = val;
        if (Els.searchInputSidebar) Els.searchInputSidebar.value = val;
        if (window.location.pathname === '/library') {
            const params = new URLSearchParams(window.location.search);
            if (val) params.set('search', val);
            else params.delete('search');
            const qs = params.toString();
            history.replaceState({}, '', qs ? '/library?' + qs : '/library');
        }
    }
    if (Els.searchInput) {
        EventManager.add(Els.searchInput, 'input', debounce(() => applySearch(Els.searchInput.value.trim()), 450));
    }
    if (Els.searchInputTopBar) {
        EventManager.add(Els.searchInputTopBar, 'input', debounce(() => applySearch(Els.searchInputTopBar.value.trim()), 450));
    }
    if (Els.searchInputSidebar) {
        EventManager.add(Els.searchInputSidebar, 'input', debounce(() => applySearch(Els.searchInputSidebar.value.trim()), 450));
        EventManager.add(Els.searchInputSidebar, 'keydown', (e) => {
            if (e.key === 'Escape') {
                Els.searchInputSidebar.value = '';
                applySearch('');
            }
        });
    }
    function clearSearchOnEscape(el, applyFn) {
        if (!el) return;
        EventManager.add(el, 'keydown', (e) => {
            if (e.key === 'Escape') {
                el.value = '';
                applyFn('');
            }
        });
    }
    clearSearchOnEscape(Els.searchInput, applySearch);
    clearSearchOnEscape(Els.searchInputTopBar, applySearch);

    EventManager.add(Els.statusFilter, 'change', () => {
        AppState.filters.status = Els.statusFilter.value;
        AppState.currentPage = 1;
        loadVideos();
    });

    EventManager.add(Els.presetFilter, 'change', () => {
        AppState.filters.render_preset = Els.presetFilter.value;
        AppState.currentPage = 1;
        loadVideos();
    });

    if (Els.dateFrom) {
        EventManager.add(Els.dateFrom, 'change', () => {
            AppState.filters.start_date = Els.dateFrom.value;
            AppState.currentPage = 1;
            loadVideos();
        });
    }

    if (Els.dateTo) {
        EventManager.add(Els.dateTo, 'change', () => {
            AppState.filters.end_date = Els.dateTo.value;
            AppState.currentPage = 1;
            loadVideos();
        });
    }

    // Close modals on backdrop click
    EventManager.add(document, 'click', (e) => {
        if (e.target.classList.contains('modal')) closeAllModals();
    });

    // Close modals on Escape
    EventManager.add(document, 'keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });

    // Tab switching
    document.querySelectorAll('[data-tab]').forEach(link => {
        EventManager.add(link, 'click', (e) => {
            e.preventDefault();
            const tab = link.dataset.tab;
            switchTab(tab);
        });
    });

    const monitoringSearchInput = document.getElementById('monitoringSearchInput');
    if (monitoringSearchInput) {
        EventManager.add(monitoringSearchInput, 'input', debounce(() => {
            AppState.monitoringSearchQuery = monitoringSearchInput.value.trim();
            renderMonitoringLogs();
        }, 300));
    }

    const deletedSearchInput = document.getElementById('deletedSearchInput');
    if (deletedSearchInput) {
        EventManager.add(deletedSearchInput, 'input', debounce(() => {
            AppState.deletedSearchQuery = deletedSearchInput.value.trim();
            renderDeletedTable();
        }, 300));
    }

    // URL modal: single listener for platform hint (managed via EventManager)
    const urlInput = document.getElementById('urlInput');
    if (urlInput) {
        EventManager.add(urlInput, 'input', () => {
            const hint = document.getElementById('urlHint');
            const platform = detectUrlPlatform(urlInput.value.trim());
            if (hint) hint.textContent = platform ? `Tespit edildi: ${platform}` : '';
        });
    }
    const urlNewFolderLink = document.getElementById('urlNewFolderLink');
    if (urlNewFolderLink) {
        EventManager.add(urlNewFolderLink, 'click', (e) => {
            e.preventDefault();
            createFolderFromUrlModal();
        });
    }

    // Sunucuyu uyandır
    const wakeServerBtn = document.getElementById('wakeServerBtn');
    if (wakeServerBtn) {
        EventManager.add(wakeServerBtn, 'click', () => { wakeServer(); closeNavOverflow(); });
    }

    // Mobile nav drawer
    const navHamburger = document.getElementById('navHamburger');
    const navDrawerOverlay = document.getElementById('navDrawerOverlay');
    const navDrawer = document.getElementById('navDrawer');
    function closeNavDrawer() {
        if (navDrawerOverlay) navDrawerOverlay.classList.remove('open');
        if (navDrawer) navDrawer.classList.remove('open');
        if (navHamburger) navHamburger.setAttribute('aria-expanded', 'false');
    }
    window.closeNavDrawer = closeNavDrawer;
    if (navHamburger && navDrawerOverlay && navDrawer) {
        EventManager.add(navHamburger, 'click', () => {
            const open = navDrawer.classList.toggle('open');
            navDrawerOverlay.classList.toggle('open', open);
            navHamburger.setAttribute('aria-expanded', open);
        });
        EventManager.add(navDrawerOverlay, 'click', closeNavDrawer);
    }

    // Nav overflow menu (İşlemler)
    const navOverflowBtn = document.getElementById('navOverflowBtn');
    const navOverflowDropdown = document.getElementById('navOverflowDropdown');
    function closeNavOverflow() {
        if (navOverflowDropdown) { navOverflowDropdown.hidden = true; navOverflowBtn?.setAttribute('aria-expanded', 'false'); }
    }
    if (navOverflowBtn && navOverflowDropdown) {
        EventManager.add(navOverflowBtn, 'click', (e) => {
            e.stopPropagation();
            const open = !navOverflowDropdown.hidden;
            navOverflowDropdown.hidden = open;
            navOverflowBtn.setAttribute('aria-expanded', !open);
        });
        navOverflowDropdown.querySelectorAll('.nav-overflow-item').forEach(el => {
            EventManager.add(el, 'click', () => closeNavOverflow());
        });
        EventManager.add(document, 'click', closeNavOverflow);
    }

    // Seçilenleri yeniden işle
    if (Els.bulkRetryBtn) {
        EventManager.add(Els.bulkRetryBtn, 'click', () => bulkRetrySelected());
    }

    // Sayfa başı (pageSize) değişince ilk sayfaya dön ve yeniden yükle
    if (Els.pageSize) {
        EventManager.add(Els.pageSize, 'change', () => {
            AppState.currentPage = 1;
            loadVideos();
        });
    }

    // Sort headers (videos table thead)
    document.querySelectorAll('#panelVideos .sort-header').forEach(el => {
        EventManager.add(el, 'click', () => {
            const col = el.dataset.sort;
            if (!col) return;
            const current = AppState.filters.sort_by;
            const order = AppState.filters.sort_order;
            AppState.filters.sort_by = col;
            AppState.filters.sort_order = (current === col && order === 'DESC') ? 'ASC' : 'DESC';
            AppState.currentPage = 1;
            loadVideos();
        });
    });

    // Header checkbox: select/deselect only visible (current page) deletable rows; IDs stay in selectedVideoIds (getSelectedIds() for API)
    if (Els.headerCheckbox) {
        EventManager.add(Els.headerCheckbox, 'change', (e) => {
            const checked = e.target.checked;
            const deletable = AppState.videos.filter(v => !['processing', 'downloading', 'converting', 'uploading'].includes(v.status));
            if (checked) {
                deletable.forEach(v => AppState.selectedVideoIds.add(String(v.id)));
            } else {
                AppState.selectedVideoIds.clear();
            }
            updateBulkActionUI();
            renderVideosTable();
        });
    }

    const headerDeleted = document.getElementById('headerCheckboxDeleted');
    if (headerDeleted) {
        EventManager.add(headerDeleted, 'change', (e) => {
            const checked = e.target.checked;
            if (checked) {
                AppState.deletedVideos.forEach(v => AppState.selectedDeletedIds.add(String(v.id)));
            } else {
                AppState.selectedDeletedIds.clear();
            }
            updateBulkDeletedUI();
            renderDeletedTable();
        });
    }
}

// ─── API LAYER ────────────────────────────────────────────────────────────────
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
        throw new Error(navigator.onLine === false ? 'İnternet bağlantısı yok. Bağlantıyı kontrol edin.' : 'Bağlantı kurulamadı. Lütfen tekrar deneyin.');
    }
    if (res.status === 401) {
        location.href = '/login';
        throw new Error('Oturum sonlandı. Yeniden giriş yapın.');
    }
    if (res.status === 429) {
        throw new Error('Çok fazla istek. Lütfen kısa süre sonra tekrar deneyin.');
    }
    if (res.status === 503) {
        throw new Error('Servis geçici olarak kullanılamıyor. Lütfen biraz sonra tekrar deneyin.');
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

// ─── STATISTICS ───────────────────────────────────────────────────────────────
async function loadStatistics() {
    if (AppState.isLoadingStats) return;
    AppState.isLoadingStats = true;
    renderStatsSkeleton();

    try {
        let statsData;
        if (CONFIG.USE_MOCK) {
            await delay(300);
            statsData = getMockStats();
        } else {
            statsData = await apiFetch('/api/videos/statistics?days=30');
        }

        AppState.statistics = statsData;
        AppState.statsError = null;
        renderStatisticsUI();
        updateNukeButtonVisibility();
        if (AppState.appUser?.isRoot) renderR2StorageWidget();
    } catch (error) {
        AppState.statsError = error.message;
        showNotification('İstatistikler yüklenemedi: ' + error.message, 'error');
        renderStatsError();
    } finally {
        document.documentElement.classList.remove('bk-auth-pending');
        AppState.isLoadingStats = false;
    }
}

function renderStatsSkeleton() {
    ['totalVideos', 'completedVideos', 'processingVideos', 'storageGb', 'totalSavingsGb'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span class="bk-skeleton" style="display:inline-block;width:60px;height:28px;border-radius:4px;"></span>';
    });
}

function renderStatsError() {
    ['totalVideos', 'completedVideos', 'processingVideos', 'storageGb', 'totalSavingsGb'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '—';
    });
}

function renderStatisticsUI() {
    const s = AppState.statistics?.summary ?? {};
    if (!s || Object.keys(s).length === 0) return;

    if (typeof BK !== 'undefined' && BK.StatsCards && BK.StatsCards.update) {
        BK.StatsCards.update(s, Els);
    } else {
        const total = s.total_videos ?? 0;
        const completed = s.completed ?? 0;
        const processing = s.processing ?? 0;
        if (Els.totalVideos) Els.totalVideos.textContent = String(total);
        if (Els.libraryVideoCountBadge) Els.libraryVideoCountBadge.textContent = total + ' Video';
        const dash1 = document.getElementById('totalVideosDash');
        const dash2 = document.getElementById('completedVideosDash');
        const dash3 = document.getElementById('processingVideosDash');
        if (dash1) dash1.textContent = String(total);
        if (dash2) dash2.textContent = String(completed);
        if (dash3) dash3.textContent = String(processing);
        if (Els.completedVideos) Els.completedVideos.textContent = String(completed);
        if (Els.processingVideos) Els.processingVideos.textContent = String(processing);
        const pubBytes = s.public_storage_bytes ?? s.total_storage_bytes ?? 0;
        if (Els.storageGb) Els.storageGb.textContent = pubBytes > 0 ? (pubBytes / 1_073_741_824).toFixed(1) + ' GB' : '0 GB';
        const dash4 = document.getElementById('storageGbDash');
        if (dash4) dash4.textContent = pubBytes > 0 ? (pubBytes / 1_073_741_824).toFixed(1) + ' GB' : '0 GB';
        const savingsBytes = s.total_savings_bytes ?? 0;
        if (Els.totalSavingsGb) Els.totalSavingsGb.textContent = savingsBytes > 0 ? (savingsBytes / 1_073_741_824).toFixed(1) + ' GB' : '0 GB';
        if (Els.storageTrend) {
            Els.storageTrend.textContent = 'Public depo';
            Els.storageTrend.classList.remove('trend-up', 'trend-down');
            Els.storageTrend.classList.add('trend-neutral');
        }
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        const weeklyGrowth = total > 0 ? Math.round(((s.last_week_total ?? 0) / total) * 100) : 0;
        setTrendEl(Els.videoTrend, weeklyGrowth, '+' + weeklyGrowth + '%');
        setTrendEl(Els.completedTrend, completionRate, completionRate + '%');
        setTrendEl(Els.processingTrend, processing === 0 ? 0 : 1, processing === 0 ? '0' : processing + ' aktif');
    }

    renderStatusChart();
    renderDailyChart();
    renderRawStorageChart();
    renderPublicStorageChart();
    updateNukeButtonVisibility();
    renderR2StorageWidget();
}

function formatMbAsStorage(mb) {
    if (mb == null || mb === 0) return '0 MB';
    if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB';
    return (Math.round(mb * 100) / 100) + ' MB';
}

function renderR2StorageWidget() {
    const widget = document.getElementById('r2Widget');
    const rawEl = document.getElementById('r2RawUsageMb');
    const pubEl = document.getElementById('r2PublicUsageMb');
    if (!widget) return;
    const rawMb = AppState.statistics?.raw_usage_mb ?? 0;
    const pubMb = AppState.statistics?.public_usage_mb ?? 0;
    if (rawEl) rawEl.textContent = formatMbAsStorage(rawMb);
    if (pubEl) pubEl.textContent = formatMbAsStorage(pubMb);
    const isRoot = !!AppState.appUser?.isRoot;
    widget.style.display = isRoot ? 'block' : 'none';
    const nukeWidgetBtn = document.getElementById('btnNukeRawWidget');
    if (nukeWidgetBtn) nukeWidgetBtn.style.display = isRoot && rawMb > 0 ? '' : 'none';
}

// UPLOAD_01: R2'de raw varsa Nuke butonu görünür, yoksa gizli; sadece root kullanıcı görür
function updateNukeButtonVisibility() {
    const btn = document.getElementById('btnNukeRaw');
    if (!btn) return;
    const isRoot = !!AppState.appUser?.isRoot;
    if (!isRoot) {
        btn.style.display = 'none';
        return;
    }
    const s = AppState.statistics?.summary ?? {};
    const rawBytes = s.raw_storage_bytes ?? s.total_input_size ?? 0;
    const rawMb = AppState.statistics?.raw_usage_mb ?? 0;
    const hasRawFiles = rawBytes > 0 || rawMb > 0;
    btn.style.display = hasRawFiles ? '' : 'none';
    const nukeWidgetBtn = document.getElementById('btnNukeRawWidget');
    if (nukeWidgetBtn) nukeWidgetBtn.style.display = hasRawFiles ? '' : 'none';
}

function renderStatusChart() {
    const el = document.getElementById('statusChart');
    if (!el) return;
    const s = AppState.statistics?.summary ?? {};
    const total = (s.completed ?? 0) + (s.processing ?? 0) + (s.failed ?? 0) + (s.uploaded ?? 0);
    if (total === 0) {
        el.innerHTML = '<span style="color:var(--text-subtle)">Henüz veri yok</span>';
        return;
    }

    const items = [
        { label: 'Tamamlandı', val: s.completed ?? 0, color: '#34d399' },
        { label: 'İşleniyor', val: s.processing ?? 0, color: '#facc15' },
        { label: 'Başarısız', val: s.failed ?? 0, color: '#f87171' },
        { label: 'Yüklendi', val: s.uploaded ?? 0, color: '#38bdf8' },
    ].filter(x => x.val > 0);

    const bars = items.map(x => {
        const pct = Math.round((x.val / total) * 100);
        return `<div style="flex:${x.val};min-width:4px;height:20px;background:${x.color};border-radius:2px" title="${escapeHtml(x.label)}: ${x.val} (${pct}%)"></div>`;
    }).join('');

    const legend = items.map(x => {
        const pct = Math.round((x.val / total) * 100);
        return `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:12px;font-size:11px;color:var(--text-muted)"><span style="width:8px;height:8px;border-radius:2px;background:${x.color}"></span>${escapeHtml(x.label)} ${x.val}</span>`;
    }).join('');

    el.innerHTML = `<div style="display:flex;gap:2px;height:24px;margin-bottom:10px;background:var(--surface-hover);border-radius:4px;overflow:hidden">${bars}</div><div style="display:flex;flex-wrap:wrap;gap:4px">${legend}</div>`;
}

function renderRawStorageChart() {
    const el = document.getElementById('rawStorageChart');
    if (!el) return;
    const rawMb = AppState.statistics?.raw_usage_mb ?? 0;
    const s = AppState.statistics?.summary ?? {};
    const rawBytes = s.raw_storage_bytes ?? s.total_input_size ?? 0;
    const displayMb = rawMb > 0 ? rawMb : rawBytes / (1024 * 1024);
    const label = displayMb >= 1024 ? (displayMb / 1024).toFixed(2) + ' GB' : (Math.round(displayMb * 100) / 100) + ' MB';
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:160px;gap:8px"><span style="font-size:28px;font-weight:600;color:var(--neon-cyan,#00ffff)">${escapeHtml(label)}</span><span style="font-size:12px;color:var(--text-muted)">Raw (ham) depo</span></div>`;
}

function renderPublicStorageChart() {
    const el = document.getElementById('publicStorageChart');
    if (!el) return;
    const pubMb = AppState.statistics?.public_usage_mb ?? 0;
    const s = AppState.statistics?.summary ?? {};
    const pubBytes = s.public_storage_bytes ?? s.total_output_size ?? s.total_storage_bytes ?? 0;
    const displayMb = pubMb > 0 ? pubMb : pubBytes / (1024 * 1024);
    const label = displayMb >= 1024 ? (displayMb / 1024).toFixed(2) + ' GB' : (Math.round(displayMb * 100) / 100) + ' MB';
    el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:160px;gap:8px"><span style="font-size:28px;font-weight:600;color:var(--neon-emerald,#10b981)">${escapeHtml(label)}</span><span style="font-size:12px;color:var(--text-muted)">Public (işlenmiş) depo</span></div>`;
}

function renderDailyChart() {
    const el = document.getElementById('dailyChart');
    if (!el) return;
    const ra = AppState.statistics?.recent_activity ?? [];
    if (!ra?.length) {
        el.innerHTML = '<span style="color:var(--text-subtle)">Henüz veri yok</span>';
        return;
    }

    const maxVal = Math.max(...ra.map(d => d.uploads ?? d.total_jobs ?? 0), 1);
    const bars = ra.slice(0, 14).reverse().map(d => {
        const v = d.uploads ?? d.total_jobs ?? 0;
        const h = Math.round((v / maxVal) * 120) || 4;
        const dateLabel = d.date ? String(d.date).slice(5) : '';
        return `<div style="flex:1;min-width:20px;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="width:100%;height:${h}px;min-height:4px;background:var(--neon-cyan, #00ffff);border-radius:3px;opacity:.8" title="${escapeHtml(d.date)}: ${v} yükleme"></div><span style="font-size:10px;color:var(--text-subtle)">${escapeHtml(dateLabel)}</span></div>`;
    }).join('');

    el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;height:160px;padding:12px 0">${bars}</div>`;
}

function setTrendEl(el, numericValue, label) {
    if (!el) return;
    el.textContent = label;
    el.classList.remove('trend-up', 'trend-down', 'trend-neutral');
    el.classList.add(numericValue > 0 ? 'trend-up' : numericValue < 0 ? 'trend-down' : 'trend-neutral');
}

// ─── VIDEOS ───────────────────────────────────────────────────────────────────
/** Fetches the current page of videos and replaces the table (no append). Uses AppState.currentPage; callers set it (e.g. goToPage, filter change). */
async function loadVideos() {
    if (AppState.isLoadingVideos) return;
    const pageToFetch = AppState.currentPage || 1;
    AppState.isLoadingVideos = true;
    renderTableSkeleton();

    try {
        let data;
        if (CONFIG.USE_MOCK) {
            await delay(400);
            data = generateMockVideos();
        } else {
            const currentLimit = Els.pageSize ? Math.min(100, Math.max(1, parseInt(Els.pageSize.value, 10) || CONFIG.PAGE_SIZE)) : CONFIG.PAGE_SIZE;
            const params = new URLSearchParams({
                page: pageToFetch,
                limit: AppState.isMainView ? 5 : currentLimit,
                sort_by: AppState.filters.sort_by || 'created_at',
                sort_order: AppState.filters.sort_order || 'DESC',
                ...Object.fromEntries(Object.entries(AppState.filters || {}).filter(([k, v]) => k !== 'sort_by' && k !== 'sort_order' && v !== '' && v != null)),
            });
            // #region agent log
            _dbg({ location: 'video-dashboard.js:loadVideos', message: 'params before folder/bucket', data: { searchInParams: params.get('search'), searchInState: AppState.filters && AppState.filters.search }, hypothesisId: 'C' });
            // #endregion
            const folderFromUrl = getFolderFromUrl();
            if (folderFromUrl) params.set('folder_id', folderFromUrl);
            const search = new URLSearchParams(window.location.search);
            const bucket = search.get('bucket');
            if (bucket) params.set('bucket', bucket);
            const finalUrl = `${CONFIG.API_BASE || ''}/api/videos?${params}`;
            console.log('F-DEBUG: Fetching URL:', finalUrl);
            data = await apiFetch(`/api/videos?${params}`);
        }

        const normalized = CONFIG.USE_MOCK ? data : fromVideoListDTO(data);
        const newVideos = normalized.videos || [];
        AppState.totalPages = normalized.totalPages ?? 1;
        AppState.currentPage = pageToFetch;
        AppState.videosError = null;
        AppState.videos = newVideos;
        renderVideosTable();
        renderPagination();
        renderMainViewToggle();
    } catch (error) {
        AppState.videosError = error.message;
        renderTableError(error.message);
    } finally {
        AppState.isLoadingVideos = false;
    }
}

// ─── TABLE RENDERING ──────────────────────────────────────────────────────────
function getTableBody() {
    return document.getElementById('videosTableBody');
}

function renderTableSkeleton() {
    if (typeof BK !== 'undefined' && BK.VideoGrid && BK.VideoGrid.renderSkeleton) {
        BK.VideoGrid.renderSkeleton(IC);
    } else {
        const body = getTableBody();
        if (!body) return;
        const loadingRow = '<tr><td colspan="11" class="bk-loading-row" style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Yükleniyor...</td></tr>';
        const skeletonRows = Array.from({ length: 4 }, () => '<tr class="bk-skeleton-row" aria-hidden="true"><td colspan="11"><div class="bk-skeleton" style="height:24px;border-radius:4px"></div></td></tr>').join('');
        body.innerHTML = loadingRow + skeletonRows;
    }
}

function renderTableError(message) {
    if (typeof BK !== 'undefined' && BK.VideoGrid && BK.VideoGrid.renderError) {
        BK.VideoGrid.renderError(message, escapeHtml, IC);
    } else {
        const body = getTableBody();
        if (!body) return;
        body.innerHTML = '<tr><td colspan="11"><div class="bk-error-state" role="alert"><div class="bk-error-state-icon" style="color:#a1a1aa">' + (IC.alert || '') + '</div><div class="bk-error-state-title">Videolar yüklenemedi</div><div style="color:#71717a;font-size:.85rem;">' + escapeHtml(message) + '</div><button class="bk-error-retry" onclick="loadVideos()">Tekrar Dene</button></div></td></tr>';
        if (Els.pagination) Els.pagination.innerHTML = '';
    }
}

function renderVideosTable() {
    const body = getTableBody();
    if (!body) return;

    if (!AppState.videos.length) {
        const hasFilters = Object.values(AppState.filters).some(v => v !== '' && v != null);
        body.innerHTML = `
            <tr><td colspan="11">
                <div class="bk-empty-state">
                    <div class="bk-empty-state-icon" style="color:#a1a1aa">${hasFilters ? IC.search : IC.inbox}</div>
                    <div class="bk-empty-state-title">
                        ${hasFilters ? 'Filtrelerle eşleşen video bulunamadı' : 'Henüz video yüklenmemiş'}
                    </div>
                    <div class="bk-empty-state-sub">
                        ${hasFilters
                ? 'Farklı filtre kriterleri deneyin veya filtreleri temizleyin.'
                : 'İlk videoyu yüklemek için Yükle butonuna tıklayın.'}
                    </div>
                    ${hasFilters
                ? `<button class="bk-error-retry" style="background:#09090b;" onclick="clearFilters()">Filtreleri Temizle</button>`
                : ''}
                </div>
            </td></tr>
        `;
        return;
    }

    const fragment = document.createDocumentFragment();
    AppState.videos.forEach(video => fragment.appendChild(createVideoRow(video)));
    body.innerHTML = '';
    body.appendChild(fragment);
    updateBulkActionUI();
}

/** Video için çözünürlük etiketi: Orijinal, 720p, 1080p, 2K, 4K. */
function getResolutionLabel(video) {
    const q = (video.bk && video.bk.quality) || video.render_preset || '';
    if (q === 'original') return 'Orijinal';
    if (q === '720p' || q === '720p_web') return '720p';
    if (q === '1080p' || q === '1080p_web') return '1080p';
    if (q === '2k') return '2K';
    if (q === '4k') return '4K';
    const res = (video.resolution || (video.bk && video.bk.resolution) || '').toString();
    if (res.includes('2160') || res.includes('3840')) return '4K';
    if (res.includes('1440') || res.includes('2560')) return '2K';
    if (res.includes('1080')) return '1080p';
    if (res.includes('720')) return '720p';
    return q || '—';
}

/** Video süresi: saniye -> "mm:ss" formatı. 0/null/undefined için "—" */
function formatVideoDuration(seconds) {
    if (seconds == null || seconds === undefined || isNaN(seconds) || seconds < 0 || seconds === 0) return '—';
    const s = Math.floor(Number(seconds));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    const ss = s % 60;
    if (h > 0) return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Normalize ad + çözünürlük: "dosya-adi.mp4 (720p)" */
function getNormalizedNameWithResolution(video) {
    const base = (video.normalized_name || video.bk?.clean_name || '—').trim();
    const res = getResolutionLabel(video);
    if (base === '—') return '—';
    return base + ' (' + res + ')';
}

/** Preset label: İşleme modu + CRF. Prefer numeric crf (6,8,10,12,14); fallback to processing_profile string (legacy). */
function getPresetLabel(video) {
    const crfNum = video.bk?.crf ?? video.crf;
    if (crfNum != null && [6, 8, 10, 12, 14].includes(Number(crfNum))) {
        const labels = { 6: 'Native (CRF 6)', 8: 'Ultra Kalite (CRF 8)', 10: 'Dengeli (CRF 10)', 12: 'Standart (CRF 12)', 14: 'Küçük (CRF 14)' };
        return labels[Number(crfNum)] || '—';
    }
    const p = (video.bk && video.bk.processing_profile) || video.processing_profile || '';
    if (p === 'web_opt' || p === 'web_optimize') return 'Sadece Web Optimize (Kalite/FPS Değişmez)';
    const map = {
        crf_10: 'Native (CRF 6)', crf_12: 'Ultra Kalite (CRF 8)', crf_14: 'Dengeli (CRF 10)', crf_16: 'Standart (CRF 12)', crf_18: 'Küçük (CRF 14)',
        '6': 'Native (CRF 6)', '8': 'Ultra Kalite (CRF 8)', '10': 'Dengeli (CRF 10)', '12': 'Standart (CRF 12)', '14': 'Küçük (CRF 14)',
        native: 'Native (CRF 6)', ultra: 'Ultra Kalite (CRF 8)', dengeli: 'Dengeli (CRF 10)', kucuk_dosya: 'Küçük (CRF 14)', web_optimize: 'Sadece Web Optimize (Kalite/FPS Değişmez)',
    };
    return map[p] || p || '—';
}

/** createVideoRow: 11 sütun (Checkbox, Thumbnail, Video, İzlenme, Preset, Çözünürlük, Boyut, Kazanç, Süre, Tarih, İşlem). */
function createVideoRow(video) {
    const retryable = ['pending', 'uploaded', 'failed', 'processing', 'downloading', 'converting', 'uploading'].includes(video.status);
    const checked = AppState.selectedVideoIds.has(String(video.id));

    const row = document.createElement('tr');
    row.dataset.videoId = video.id;

    const uploadDate = video.uploaded_at
        ? new Date(String(video.uploaded_at).endsWith('Z') ? video.uploaded_at : video.uploaded_at + 'Z').toLocaleString('tr-TR')
        : '—';
    const originalName = (video.original_name || video.bk?.original_name || '').trim() || '—';
    const r2RawKey = (video.bk?.r2_raw_key || video.r2_raw_key || '').trim() || '—';
    const safeId = escapeHtml(video.id);

    const thumbSrc = video.thumbnail_url || (video.bk && video.bk.thumbnail_url) || null;
    const cdnBase = 'https://cdn.bilgekarga.tr';
    const thumbKey = video.bk && video.bk.thumbnail_key;
    const thumbUrl = thumbSrc || (thumbKey ? `${cdnBase}/${thumbKey}` : null);
    const thumbHtml = thumbUrl
        ? `<img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy">`
        : IC.film;
    const thumbAttrs = thumbUrl
        ? ` data-thumb-url="${escapeHtml(thumbUrl)}" role="button" tabindex="0" title="Küçük resmi büyüt"`
        : '';

    const inputMB = (video.file_size_input ?? video.file_size ?? 0) / 1_048_576;
    const outputMB = (video.file_size_output ?? video.bk?.file_size_output ?? 0) / 1_048_576;
    const sizeDisplay = video.status === 'completed' && outputMB > 0
        ? `${outputMB.toFixed(1)} MB`
        : inputMB > 0 ? `${inputMB.toFixed(1)} MB` : '—';
    const fsIn = video.file_size_input ?? video.file_size ?? 0;
    const fsOut = video.file_size_output ?? video.bk?.file_size_output ?? 0;
    const kazançDisplay = (fsIn && fsOut && video.status === 'completed')
        ? Math.round((1 - fsOut / fsIn) * 100) + '%'
        : '—';
    const viewCount = String(video.view_count ?? video.bk?.view_count ?? 0);
    const presetLabel = getPresetLabel(video);
    const resolutionLabel = getResolutionLabel(video);
    const downloadPct = (video.bk && video.bk.download_progress != null) ? video.bk.download_progress : null;

    const processing = ['processing', 'downloading', 'converting', 'uploading'].includes(video.status);
    const deletable = !processing;
    const checkboxCell = deletable
        ? `<td data-label="Seç"><input type="checkbox" class="row-checkbox" data-video-id="${safeId}" ${checked ? 'checked' : ''} aria-label="Seç" onclick="toggleVideoSelection('${safeId}')"></td>`
        : `<td data-label="Seç"><input type="checkbox" disabled aria-label="İşleniyor" title="İşlem sırasında silinemez"></td>`;

    const retryBtn = retryable
        ? `<button class="action-btn action-retry" onclick="retryProcessing('${safeId}')" aria-label="Yeniden işle">${IC.retry} Yeniden işle</button>`
        : '';
    const showErrorDetail = video.status === 'failed' || (video.bk && video.bk.error_message);
    const errorDetailBtn = showErrorDetail
        ? `<button class="action-btn action-error-detail" onclick="viewErrorDetail('${safeId}')" aria-label="Hata detayı">${IC.alert} Hata detayı</button>`
        : '';

    row.innerHTML = `
        ${checkboxCell}
        <td data-label="Thumbnail"><div class="video-thumb"${thumbAttrs} aria-hidden="true">${thumbHtml}</div></td>
        <td data-label="Video" class="cell-video">
            <div style="display: flex; flex-direction: column; line-height: 1.2;">
                <strong style="font-weight: 600; color: #111827;" title="${escapeHtml(originalName)}">${escapeHtml(originalName)}</strong>
                <span style="font-size: 11px; color: #6b7280; margin-top: 2px;">${escapeHtml(r2RawKey)}</span>
            </div>
        </td>
        <td data-label="İzlenme">${escapeHtml(viewCount)}</td>
        <td data-label="Preset">${escapeHtml(presetLabel)}</td>
        <td data-label="Çözünürlük">${video.status === 'downloading' && downloadPct != null ? escapeHtml(resolutionLabel) + ' · İndirme ' + escapeHtml(downloadPct + '%') : escapeHtml(resolutionLabel)}</td>
        <td data-label="Boyut">${escapeHtml(sizeDisplay)}</td>
        <td data-label="Kazanç">${escapeHtml(kazançDisplay)}</td>
        <td data-label="Süre">${escapeHtml(formatVideoDuration(video.duration ?? video.bk?.duration))}</td>
        <td data-label="Tarih">${escapeHtml(uploadDate)}</td>
        <td data-label="İşlem" class="cell-actions">
            <div class="action-buttons">
                <button class="action-btn action-view"
                    onclick="viewVideoDetails('${safeId}')"
                    aria-label="Görüntüle: ${escapeHtml(video.original_name)}">${IC.eye} Görüntüle</button>
                ${errorDetailBtn}
                ${retryBtn}
                ${video.status === 'completed'
            ? `<button class="action-btn action-download"
                            onclick="downloadVideo('${safeId}')"
                            aria-label="İndir">${IC.download}</button>`
            : ''}
                ${video.status === 'completed'
            ? `<button class="action-btn action-copy"
                            onclick="copyVideoUrl('${safeId}')"
                            title="CDN linkini kopyala">${IC.copy}</button>`
            : ''}
                <button class="action-btn action-delete"
                    onclick="deleteVideo('${safeId}')"
                    aria-label="Sil">${IC.trash}</button>
            </div>
        </td>
    `;

    return row;
}

function copyVideoUrl(videoId) {
    const video = AppState.videos.find(v => v.id == videoId);
    if (!video) return;

    const url = (video.bk && video.bk.public_url)
        || video.public_url
        || `https://cdn.bilgekarga.tr/videos/${encodeURIComponent(video.normalized_name)}`;

    navigator.clipboard.writeText(url)
        .then(() => showNotification('CDN linki kopyalandı', 'success'))
        .catch(() => showNotification(`URL: ${url}`, 'info'));
}

function toggleMainView() {
    AppState.isMainView = !AppState.isMainView;
    AppState.currentPage = 1;
    loadVideos();
}

function renderMainViewToggle() {
    const el = document.getElementById('mainViewToggle');
    if (!el) return;
    if (AppState.isMainView) {
        el.innerHTML = '<button class="btn btn-primary" onclick="window.location.href=\'/library\'">Tüm Videolar</button>';
        el.hidden = false;
    } else {
        el.innerHTML = '<button class="btn btn-ghost" onclick="toggleMainView()">Ana Ekrana Dön</button>';
        el.hidden = false;
    }
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
function renderPagination() {
    if (!Els.pagination) return;
    if (AppState.isMainView) { Els.pagination.innerHTML = ''; return; }
    const { currentPage: cp, totalPages: tp } = AppState;
    if (tp <= 1) { Els.pagination.innerHTML = ''; return; }
    Els.pagination.innerHTML = `
        <button class="page-btn" onclick="goToPage(${cp - 1})"
            ${cp <= 1 ? 'disabled aria-disabled="true"' : ''} aria-label="Önceki sayfa">← Önceki</button>
        <div class="page-info" aria-live="polite">Sayfa ${cp} / ${tp}</div>
        <button class="page-btn" onclick="goToPage(${cp + 1})"
            ${cp >= tp ? 'disabled aria-disabled="true"' : ''} aria-label="Sonraki sayfa">Sonraki →</button>
    `;
}

function goToPage(page) {
    if (page < 1 || page > AppState.totalPages || page === AppState.currentPage) return;
    AppState.currentPage = page;
    loadVideos();
    Els.videosTable?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────
function clearFilters() {
    // #region agent log
    _dbg({ location: 'video-dashboard.js:clearFilters', message: 'clearFilters called', data: { path: window.location.pathname, searchBefore: window.location.search }, hypothesisId: 'B' });
    // #endregion
    AppState.filters = {};
    AppState.currentPage = 1;
    if (Els.searchInput) Els.searchInput.value = '';
    if (Els.searchInputTopBar) Els.searchInputTopBar.value = '';
    if (Els.searchInputSidebar) Els.searchInputSidebar.value = '';
    if (Els.statusFilter) Els.statusFilter.value = '';
    if (Els.presetFilter) Els.presetFilter.value = '';
    if (Els.dateFrom) Els.dateFrom.value = '';
    if (Els.dateTo) Els.dateTo.value = '';
    if (window.location.pathname === '/library') {
        const params = new URLSearchParams(window.location.search);
        params.delete('search');
        const qs = params.toString();
        history.replaceState({}, '', qs ? '/library?' + qs : '/library');
    }
    loadVideos();
}

// ─── TAB SWITCHING ────────────────────────────────────────────────────────────
function switchTab(tab) {
    const panelDashboard = document.getElementById('panelDashboard');
    const panelFolders = document.getElementById('panelFolders');
    Els.panelVideos?.setAttribute('hidden', '');
    Els.panelMonitoring?.setAttribute('hidden', '');
    Els.panelDeleted?.setAttribute('hidden', '');
    Els.panelUsers?.setAttribute('hidden', '');
    if (panelDashboard) panelDashboard.setAttribute('hidden', '');
    if (panelFolders) panelFolders.setAttribute('hidden', '');
    document.querySelectorAll('[data-tab]').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`[data-tab="${tab}"]`).forEach(l => l.classList.add('active'));
    document.querySelectorAll('.bk-sidebar-nav a').forEach(a => a.classList.remove('active'));
    const sidebarActive = { videos: ['bkSidebarLibrary'], monitoring: ['bkSidebarAnalytics'], deleted: ['bkSidebarTrash'] };
    (sidebarActive[tab] || []).forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('active'); });
    if (tab === 'videos') {
        Els.panelVideos?.removeAttribute('hidden');
        AppState.selectedDeletedIds.clear();
        updateBulkDeletedUI();
    } else if (tab === 'monitoring') {
        Els.panelMonitoring?.removeAttribute('hidden');
        loadMonitoringData();
    } else if (tab === 'deleted') {
        Els.panelDeleted?.removeAttribute('hidden');
        AppState.selectedVideoIds.clear();
        updateBulkActionUI();
        loadDeletedVideos();
    } else if (tab === 'users') {
        Els.panelUsers?.removeAttribute('hidden');
        loadUsers();
    }
    if (typeof closeNavDrawer === 'function') closeNavDrawer();
}

// ─── MONITORING API ───────────────────────────────────────────────────────────
async function loadMonitoringData() {
    const statsEls = {
        monStatsSuccess: document.getElementById('monStatsSuccess'),
        monStatsFailed: document.getElementById('monStatsFailed'),
        monStatsHoneypot: document.getElementById('monStatsHoneypot'),
        monStatsBanned: document.getElementById('monStatsBanned'),
    };
    const logsBody = document.getElementById('monitoringLogsBody');
    const bannedBody = document.getElementById('monitoringBannedBody');
    const refreshBtn = document.getElementById('monitoringRefreshBtn');

    const appLogsBody = document.getElementById('monitoringAppLogsBody');
    const failedBody = document.getElementById('monitoringFailedBody');
    const setPlaceholder = () => {
        Object.values(statsEls).forEach(el => { if (el) el.textContent = '—'; });
        if (logsBody) logsBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.alert + '</div><div class="bk-empty-state-title">Yükleniyor…</div></div>';
        if (appLogsBody) appLogsBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.alert + '</div><div class="bk-empty-state-title">Yükleniyor…</div></div>';
        if (bannedBody) bannedBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">Yükleniyor…</div></div>';
        if (failedBody) failedBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.alert + '</div><div class="bk-empty-state-title">Yükleniyor…</div></div>';
        const processingBody = document.getElementById('monitoringProcessingLogsBody');
        const storageBody = document.getElementById('monitoringStorageLogsBody');
        const agentHealthBody = document.getElementById('monitoringAgentHealthLogsBody');
        if (processingBody) processingBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-title">Yükleniyor…</div></div>';
        if (storageBody) storageBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-title">Yükleniyor…</div></div>';
        if (agentHealthBody) agentHealthBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-title">Yükleniyor…</div></div>';
    };
    if (refreshBtn) refreshBtn.disabled = true;
    setPlaceholder();

    try {
        const [statsRes, logsRes, appLogsRes, processingRes, storageRes, agentHealthRes] = await Promise.all([
            apiFetch('/api/security/stats?days=7'),
            apiFetch('/api/security/logs?limit=100'),
            apiFetch('/api/logs/app?limit=100').catch(() => ({ logs: [] })),
            apiFetch('/api/logs/processing?limit=100').catch(() => ({ logs: [] })),
            apiFetch('/api/logs/storage?limit=100').catch(() => ({ logs: [] })),
            apiFetch('/api/logs/agent-health?limit=100').catch(() => ({ logs: [] })),
        ]);

        const c = statsRes.counts || {};
        if (statsEls.monStatsSuccess) statsEls.monStatsSuccess.textContent = c.LOGIN_SUCCESS ?? 0;
        if (statsEls.monStatsFailed) statsEls.monStatsFailed.textContent = c.LOGIN_FAILED ?? 0;
        if (statsEls.monStatsHoneypot) statsEls.monStatsHoneypot.textContent = c.HONEYPOT_TRIGGERED ?? 0;
        if (statsEls.monStatsBanned) statsEls.monStatsBanned.textContent = statsRes.bannedCount ?? 0;

        const logs = logsRes.logs || [];
        const appLogs = appLogsRes.logs || [];
        AppState.monitoringSecurityLogs = logs;
        AppState.monitoringAppLogs = appLogs;
        AppState.monitoringProcessingLogs = processingRes.logs || [];
        AppState.monitoringStorageLogs = storageRes.logs || [];
        AppState.monitoringAgentHealthLogs = agentHealthRes.logs || [];
        renderMonitoringLogs();
        renderMonitoringProcessingStorageAgentLogs();

        const failedRes = await apiFetch('/api/videos?status=failed&limit=50').catch(() => ({ data: [] }));
        const failedNormalized = failedRes.data ? fromVideoListDTO({ data: failedRes.data, total: failedRes.total || 0, per_page: failedRes.per_page || 50 }) : { videos: [] };
        const failedVideos = failedNormalized.videos || [];
        if (failedBody) {
            if (!failedVideos.length) {
                failedBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">Başarısız iş yok</div></div>';
            } else {
                failedBody.innerHTML = failedVideos.map(v => {
                    const errMsg = v.bk?.error_message || '—';
                    const ffmpeg = (v.bk?.ffmpeg_output || '').trim();
                    const hasFfmpeg = ffmpeg.length > 0;
                    return `<div class="table-row" style="grid-template-columns: 1fr 1fr 2fr;align-items:start">
                        <div class="table-cell cell-text">${escapeHtml(v.bk?.clean_name || v.original_name || v.id)}</div>
                        <div class="table-cell cell-mono">${escapeHtml(String(v.id))}</div>
                        <div class="table-cell" style="flex-direction:column;gap:4px">
                            <div class="error-detail-pre" style="font-size:11px;max-height:80px;overflow-y:auto">${escapeHtml(errMsg)}</div>
                            ${hasFfmpeg ? `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:var(--text-muted)">FFmpeg çıktısını göster</summary><pre class="error-detail-pre" style="margin-top:8px;font-size:10px;max-height:200px;overflow:auto;white-space:pre-wrap">${escapeHtml(ffmpeg)}</pre></details>` : ''}
                        </div>
                    </div>`;
                }).join('');
            }
        }

        const banned = logsRes.bannedIps || [];
        try {
            const bannedRes = await apiFetch('/api/security/banned');
            banned.push(...(bannedRes.list || []));
        } catch (_) { /* optional banned endpoint */ }
        if (bannedBody) {
            if (!banned.length) {
                bannedBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">Banlanan IP yok</div></div>';
            } else {
                bannedBody.innerHTML = banned.slice(0, 50).map(b => {
                    const ip = b.ip || b;
                    const reason = b.reason || '—';
                    const bannedAt = b.bannedAt ? new Date(b.bannedAt).toLocaleString('tr-TR') : '—';
                    return `<div class="table-row" style="grid-template-columns: 1.5fr 1fr 1.5fr">
                        <div class="table-cell cell-mono">${escapeHtml(ip)}</div>
                        <div class="table-cell cell-text">${escapeHtml(reason)}</div>
                        <div class="table-cell cell-mono">${escapeHtml(bannedAt)}</div>
                    </div>`;
                }).join('');
            }
        }

        // If bannedCount is available but we don't have /api/security/banned, use stats
        if (statsRes.bannedCount > 0 && !banned.length) {
            const bannedRes = await apiFetch('/api/security/banned').catch(() => ({}));
            const list = bannedRes.list || [];
            if (bannedBody && list.length) {
                bannedBody.innerHTML = list.slice(0, 50).map(b => {
                    const ip = b.ip || b;
                    const reason = b.reason || '—';
                    const bannedAt = b.bannedAt ? new Date(b.bannedAt).toLocaleString('tr-TR') : '—';
                    return `<div class="table-row" style="grid-template-columns: 1.5fr 1fr 1.5fr">
                        <div class="table-cell cell-mono">${escapeHtml(ip)}</div>
                        <div class="table-cell cell-text">${escapeHtml(reason)}</div>
                        <div class="table-cell cell-mono">${escapeHtml(bannedAt)}</div>
                    </div>`;
                }).join('');
            }
        }
    } catch (err) {
        showNotification('Monitoring verileri yüklenemedi: ' + err.message, 'error');
        if (logsBody) logsBody.innerHTML = '<div class="bk-error-state"><div class="bk-error-state-title">Hata</div><div style="color:var(--text-muted)">' + escapeHtml(err.message) + '</div><button class="bk-error-retry" onclick="loadMonitoringData()">Tekrar Dene</button></div>';
        if (appLogsBody) appLogsBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-title">Yüklenemedi</div></div>';
        if (bannedBody) bannedBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-title">Yüklenemedi</div></div>';
        const processingBody = document.getElementById('monitoringProcessingLogsBody');
        const storageBody = document.getElementById('monitoringStorageLogsBody');
        const agentHealthBody = document.getElementById('monitoringAgentHealthLogsBody');
        if (processingBody) processingBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-title">Yüklenemedi</div></div>';
        if (storageBody) storageBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-title">Yüklenemedi</div></div>';
        if (agentHealthBody) agentHealthBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-title">Yüklenemedi</div></div>';
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

function renderMonitoringLogs() {
    const logsBody = document.getElementById('monitoringLogsBody');
    const appLogsBody = document.getElementById('monitoringAppLogsBody');
    const q = (AppState.monitoringSearchQuery || '').toLowerCase().trim();
    const matches = (log, text) => !q || text.toLowerCase().includes(q);

    const logs = AppState.monitoringSecurityLogs || [];
    const filteredLogs = q ? logs.filter(log => {
        const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '';
        const d = log.details && typeof log.details === 'object' ? log.details : {};
        const detail = typeof d === 'object' ? JSON.stringify(d) : String(log.details || '');
        const loc = [log.country, log.city].filter(Boolean).join(', ');
        const text = [time, log.ip, log.action, log.status, detail, loc].join(' ');
        return matches(log, text);
    }) : logs;

    if (logsBody) {
        if (!filteredLogs.length) {
            logsBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">' + (q ? 'Arama sonucu yok' : 'Güvenlik kaydı yok') + '</div></div>';
        } else {
            logsBody.innerHTML = filteredLogs.map(log => {
                const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '—';
                const d = log.details && typeof log.details === 'object' ? log.details : {};
                const detail = log.action === 'AGENT_WAKEUP_FAILED' && d.error ? (d.agent_status ? `[${d.agent_status}] ` : '') + d.error : (log.details && typeof log.details === 'object' ? JSON.stringify(log.details).slice(0, 120) : '');
                const loc = [log.country, log.city].filter(Boolean).join(', ') || '—';
                return `<div class="table-row" style="grid-template-columns: 1fr 1.2fr 1fr 1fr 2fr 1.2fr">
                    <div class="table-cell cell-mono">${escapeHtml(time)}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.ip)}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.action)}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.status)}</div>
                    <div class="table-cell cell-mono" style="font-size:11px">${escapeHtml(detail)}</div>
                    <div class="table-cell cell-text">${escapeHtml(loc)}</div>
                </div>`;
            }).join('');
        }
    }

    const appLogs = AppState.monitoringAppLogs || [];
    const filteredAppLogs = q ? appLogs.filter(log => {
        const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '';
        const detail = log.details && typeof log.details === 'object' ? JSON.stringify(log.details) : '';
        const text = [time, log.level, log.action, log.jobId, detail].join(' ');
        return matches(log, text);
    }) : appLogs;

    if (appLogsBody) {
        if (!filteredAppLogs.length) {
            appLogsBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">' + (q ? 'Arama sonucu yok' : 'Uygulama kaydı yok') + '</div></div>';
        } else {
            appLogsBody.innerHTML = filteredAppLogs.map(log => {
                const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '—';
                const detail = log.details && typeof log.details === 'object' ? JSON.stringify(log.details).slice(0, 120) : '';
                const levelCls = log.level === 'ERROR' ? 'status-failed' : log.level === 'WARN' ? 'status-processing' : 'status-completed';
                return `<div class="table-row" style="grid-template-columns: 1fr 0.8fr 1fr 1.5fr 2fr">
                    <div class="table-cell cell-mono">${escapeHtml(time)}</div>
                    <div class="table-cell cell-text"><span class="status-badge ${levelCls}">${escapeHtml(log.level || '—')}</span></div>
                    <div class="table-cell cell-text">${escapeHtml(log.action || '—')}</div>
                    <div class="table-cell cell-mono">${log.jobId ?? '—'}</div>
                    <div class="table-cell cell-mono" style="font-size:11px">${escapeHtml(detail)}</div>
                </div>`;
            }).join('');
        }
    }
}

function renderMonitoringProcessingStorageAgentLogs() {
    const processingBody = document.getElementById('monitoringProcessingLogsBody');
    const storageBody = document.getElementById('monitoringStorageLogsBody');
    const agentHealthBody = document.getElementById('monitoringAgentHealthLogsBody');
    const processingLogs = AppState.monitoringProcessingLogs || [];
    const storageLogs = AppState.monitoringStorageLogs || [];
    const agentHealthLogs = AppState.monitoringAgentHealthLogs || [];

    if (processingBody) {
        if (!processingLogs.length) {
            processingBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">İşlem detay kaydı yok</div></div>';
        } else {
            processingBody.innerHTML = processingLogs.map(log => {
                const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '—';
                const errMsg = (log.errorMessage || '').slice(0, 80);
                return `<div class="table-row" style="grid-template-columns: 1fr 0.8fr 1fr 0.8fr 0.8fr 1fr 2fr">
                    <div class="table-cell cell-mono">${escapeHtml(time)}</div>
                    <div class="table-cell cell-mono">${log.jobId ?? '—'}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.workerId || '—')}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.event || '—')}</div>
                    <div class="table-cell cell-mono">${log.processingTimeSeconds ?? '—'}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.errorCode || '—')}</div>
                    <div class="table-cell cell-mono" style="font-size:11px">${escapeHtml(errMsg || '—')}</div>
                </div>`;
            }).join('');
        }
    }

    if (storageBody) {
        if (!storageLogs.length) {
            storageBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">Depolama kaydı yok</div></div>';
        } else {
            storageBody.innerHTML = storageLogs.map(log => {
                const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '—';
                const sizeStr = log.sizeBytes != null ? (log.sizeBytes / 1024 / 1024).toFixed(2) + ' MB' : (log.dbSize != null && log.r2Size != null ? `DB:${(log.dbSize / 1024 / 1024).toFixed(2)} / R2:${(log.r2Size / 1024 / 1024).toFixed(2)}` : '—');
                const reason = (log.reason || '').slice(0, 60);
                return `<div class="table-row" style="grid-template-columns: 1fr 0.7fr 1fr 1fr 1.5fr 2fr">
                    <div class="table-cell cell-mono">${escapeHtml(time)}</div>
                    <div class="table-cell cell-mono">${log.jobId ?? '—'}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.eventType || '—')}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.bucket || '—')}</div>
                    <div class="table-cell cell-mono">${escapeHtml(sizeStr)}</div>
                    <div class="table-cell cell-mono" style="font-size:11px">${escapeHtml(reason)}</div>
                </div>`;
            }).join('');
        }
    }

    if (agentHealthBody) {
        if (!agentHealthLogs.length) {
            agentHealthBody.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">Ajan sağlık kaydı yok</div></div>';
        } else {
            agentHealthBody.innerHTML = agentHealthLogs.map(log => {
                const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '—';
                const detail = log.details && typeof log.details === 'object' ? JSON.stringify(log.details).slice(0, 80) : '';
                return `<div class="table-row" style="grid-template-columns: 1fr 1.2fr 0.8fr 0.8fr 0.8fr 1fr 2fr">
                    <div class="table-cell cell-mono">${escapeHtml(time)}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.workerId || '—')}</div>
                    <div class="table-cell cell-mono">${escapeHtml(log.version || '—')}</div>
                    <div class="table-cell cell-text">${escapeHtml(log.status || '—')}</div>
                    <div class="table-cell cell-mono">${log.diskFreeMb ?? '—'}</div>
                    <div class="table-cell cell-mono">${log.ramUsedPct != null ? log.ramUsedPct + '%' : '—'}</div>
                    <div class="table-cell cell-mono" style="font-size:11px">${escapeHtml(detail)}</div>
                </div>`;
            }).join('');
        }
    }
}

function exportMonitoringLogsCsv() {
    const logs = AppState.monitoringSecurityLogs || [];
    const appLogs = AppState.monitoringAppLogs || [];
    const rows = [];
    rows.push(['Tür', 'Tarih', 'IP', 'Olay', 'Durum', 'Detay', 'Konum'].join(','));
    logs.forEach(log => {
        const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '';
        const detail = (log.details && typeof log.details === 'object' ? JSON.stringify(log.details) : '').replace(/"/g, '""');
        const loc = [log.country, log.city].filter(Boolean).join(', ') || '';
        rows.push(['Güvenlik', time, log.ip || '', log.action || '', log.status || '', `"${detail}"`, loc].join(','));
    });
    appLogs.forEach(log => {
        const time = log.createdAt ? new Date(log.createdAt).toLocaleString('tr-TR') : '';
        const detail = (log.details && typeof log.details === 'object' ? JSON.stringify(log.details) : '').replace(/"/g, '""');
        rows.push(['Uygulama', time, '-', log.action || '', log.level || '', `"${detail}"`, log.jobId ?? ''].join(','));
    });
    const csv = '\uFEFF' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'logs_export.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('logs_export.csv indirildi', 'success');
}

// ─── GLOBAL ACTIONS ───────────────────────────────────────────────────────────
function refreshData() {
    AppState.currentPage = 1;
    loadStatistics();
    loadVideos();
    loadTopViewed();
    showNotification('Veriler yenilendi', 'success');
}

async function unstickJobs() {
    try {
        const res = await apiFetch('/api/videos/unstick?minutes=30', { method: 'POST' });
        const n = res.unstuck_count ?? 0;
        if (n > 0) {
            showNotification(`${n} askıda kalan video PENDING'e alındı. Agent tekrar deneyecek.`, 'success');
            loadStatistics();
            loadVideos();
        } else {
            showNotification('Askıda kalan iş bulunamadı (30 dk+ takılı olanlar)', 'info');
        }
    } catch (e) {
        showNotification('Askıda sıfırlama hatası: ' + e.message, 'error');
    }
}

function exportData() {
    if (!AppState.videos.length) {
        showNotification('Dışa aktarılacak video bulunamadı', 'warning');
        return;
    }

    const sizeStr = (v) => {
        const inMB = (v.file_size || 0) / 1_048_576;
        const outMB = (v.file_size_output || v.bk?.file_size_output || 0) / 1_048_576;
        return v.status === 'completed' && outMB > 0 ? `${inMB.toFixed(2)} / ${outMB.toFixed(2)}` : inMB.toFixed(2);
    };
    const headers = ['ID', 'Orijinal Ad', 'Normalize Edilmiş Ad', 'Durum', 'Render Preseti', 'Boyut (MB)', 'Süre (sn)', 'Yükleyen', 'Yükleme Tarihi'];
    const rows = AppState.videos.map(v => [
        v.id,
        `"${(v.original_name || '').replace(/"/g, '""')}"`,
        `"${(getNormalizedNameWithResolution(v) || '').replace(/"/g, '""')}"`,
        v.status,
        v.render_preset,
        sizeStr(v),
        v.duration ?? 0,
        v.uploaded_by,
        new Date(v.uploaded_at).toLocaleDateString('tr-TR'),
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Turkish chars
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `videolar_${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('CSV dosyası indiriliyor', 'success');
}

function downloadVideo(videoId) {
    const video = AppState.videos.find(v => v.id == videoId);
    if (!video) return;
    const url = video.public_url || `https://cdn.bilgekarga.tr/videos/${encodeURIComponent(video.normalized_name)}`;
    showNotification(`${escapeHtml(video.normalized_name)} indiriliyor…`, 'info');
    setTimeout(() => window.open(url, '_blank', 'noopener,noreferrer'), 300);
}

function deleteVideo(videoId) {
    const video = AppState.videos.find(v => v.id == videoId);
    if (!video) return;

    var confirmed = window.confirm('Bu video çöp kutusuna taşınacak (Son Silinenler). Root olarak oradan geri yükleyebilir veya kalıcı silebilirsiniz. Devam?');
    if (!confirmed) return;

    (async function () {
        try {
            if (!CONFIG.USE_MOCK) {
                await apiFetch(`/api/videos/${encodeURIComponent(String(videoId))}`, { method: 'DELETE' });
            } else {
                await delay(600);
            }
            AppState.videos = AppState.videos.filter(function (v) { return String(v.id) !== String(videoId); });
            renderVideosTable();
            renderPagination();
            loadStatistics();
            if (AppState.appUser && AppState.appUser.isRoot) loadDeletedVideos();
            showNotification('Video çöp kutusuna taşındı', 'success');
        } catch (err) {
            showNotification('Silme işlemi başarısız: ' + (err.message || String(err)), 'error');
        }
    })();
}

// ─── Son Silinenler (Root only) ───────────────────────────────────────────────
async function loadDeletedVideos() {
    if (!AppState.appUser?.isRoot) return;
    const search = document.getElementById('deletedSearchInput')?.value?.trim() || '';
    try {
        const params = new URLSearchParams({
            page: AppState.deletedCurrentPage,
            limit: 25,
            sort_by: 'deleted_at',
            sort_order: 'DESC',
        });
        const data = await apiFetch(`/api/videos/deleted?${params}`);
        const normalized = fromVideoListDTO(data);
        AppState.deletedVideos = normalized.videos;
        AppState.deletedTotalPages = normalized.totalPages || 1;
        renderDeletedTable();
        renderDeletedPagination();
    } catch (err) {
        showNotification('Son silinenler yüklenemedi: ' + err.message, 'error');
        if (document.getElementById('deletedTableBody')) {
            document.getElementById('deletedTableBody').innerHTML =
                `<tr><td colspan="11"><div class="bk-error-state"><div class="bk-error-state-title">${escapeHtml(err.message)}</div></div></td></tr>`;
        }
    }
}

function renderDeletedTable() {
    const body = document.getElementById('deletedTableBody');
    if (!body) return;
    let list = AppState.deletedVideos;
    const q = (AppState.deletedSearchQuery || '').toLowerCase();
    if (q) {
        list = list.filter(v => {
            const name = (v.original_name || v.bk?.clean_name || '').toLowerCase();
            return name.includes(q);
        });
    }
    if (!list.length) {
        body.innerHTML = '<tr><td colspan="11"><div class="bk-empty-state"><div class="bk-empty-state-icon">' + IC.inbox + '</div><div class="bk-empty-state-title">Silinen video yok</div></div></td></tr>';
        return;
    }
    const thumbCdn = 'https://cdn.bilgekarga.tr';
    body.innerHTML = list.map(v => {
        const duration = formatVideoDuration(v.duration ?? v.bk?.duration);
        const deletedAt = v.bk?.deleted_at ? new Date(v.bk.deleted_at).toLocaleString('tr-TR') : '—';
        const name = v.original_name || v.bk?.clean_name || v.id;
        const viewCount = String(v.view_count ?? v.bk?.view_count ?? 0);
        const inputMB = (v.file_size_input ?? v.file_size ?? 0) / 1_048_576;
        const outputMB = (v.file_size_output ?? v.bk?.file_size_output ?? 0) / 1_048_576;
        const sizeDisplay = outputMB > 0 ? `${inputMB.toFixed(1)} / ${outputMB.toFixed(1)} MB` : `${inputMB.toFixed(1)} MB`;
        const fsIn = v.file_size_input ?? v.file_size ?? 0;
        const fsOut = v.file_size_output ?? v.bk?.file_size_output ?? 0;
        const kazançDisplay = (fsIn && fsOut) ? Math.round((1 - fsOut / fsIn) * 100) + '%' : '—';
        const thumbUrl = v.thumbnail_url ?? (v.bk?.thumbnail_key ? `${thumbCdn}/${v.bk.thumbnail_key}` : null);
        const thumbHtml = thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy">` : IC.film;
        const thumbAttrs = thumbUrl ? ` data-thumb-url="${escapeHtml(thumbUrl)}" role="button" tabindex="0" title="Küçük resmi büyüt"` : '';
        const checked = AppState.selectedDeletedIds.has(String(v.id));
        const safeId = escapeHtml(String(v.id));
        const originalNameDel = (v.original_name || v.bk?.original_name || '').trim() || '—';
        const r2RawKeyDel = (v.bk?.r2_raw_key || v.r2_raw_key || '').trim() || '—';
        const presetLabelDel = getPresetLabel(v);
        return `<tr data-video-id="${safeId}">
                <td><input type="checkbox" class="row-checkbox-deleted" data-video-id="${safeId}" ${checked ? 'checked' : ''} aria-label="Seç" onclick="toggleDeletedSelection('${safeId}')"></td>
                <td><div class="video-thumb"${thumbAttrs} aria-hidden="true">${thumbHtml}</div></td>
                <td class="cell-video">
                    <div style="display: flex; flex-direction: column; line-height: 1.2;">
                        <strong style="font-weight: 600; color: #111827;" title="${escapeHtml(originalNameDel)}">${escapeHtml(originalNameDel)}</strong>
                        <span style="font-size: 11px; color: #6b7280; margin-top: 2px;">${escapeHtml(r2RawKeyDel)}</span>
                    </div>
                </td>
                <td>${escapeHtml(viewCount)}</td>
                <td>${escapeHtml(presetLabelDel)}</td>
                <td>${escapeHtml(sizeDisplay)}</td>
                <td>${escapeHtml(kazançDisplay)}</td>
                <td>${escapeHtml(duration)}</td>
                <td>${escapeHtml(deletedAt)}</td>
                <td class="cell-actions">
                    <div class="action-buttons">
                        <button class="action-btn action-retry" onclick="restoreDeletedVideo('${escapeHtml(v.id)}')">${IC.retry} Geri Yükle</button>
                        <button class="action-btn action-delete" onclick="purgeDeletedVideo('${escapeHtml(v.id)}')">${IC.trash} Kalıcı Sil</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
    updateBulkDeletedUI();
}

function renderDeletedPagination() {
    const el = document.getElementById('deletedPagination');
    if (!el) return;
    const { deletedCurrentPage: cp, deletedTotalPages: tp } = AppState;
    if (tp <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <button class="page-btn" onclick="goToDeletedPage(${cp - 1})" ${cp <= 1 ? 'disabled' : ''}>← Önceki</button>
        <div class="page-info">Sayfa ${cp} / ${tp}</div>
        <button class="page-btn" onclick="goToDeletedPage(${cp + 1})" ${cp >= tp ? 'disabled' : ''}>Sonraki →</button>`;
}

function goToDeletedPage(page) {
    if (page < 1 || page > AppState.deletedTotalPages) return;
    AppState.deletedCurrentPage = page;
    loadDeletedVideos();
}

async function restoreDeletedVideo(videoId) {
    try {
        await apiFetch(`/api/videos/${videoId}/restore`, { method: 'POST' });
        showNotification('Video geri yüklendi', 'success');
        loadDeletedVideos();
        loadStatistics();
        loadVideos();
    } catch (err) {
        showNotification('Geri yükleme başarısız: ' + err.message, 'error');
    }
}

async function purgeDeletedVideo(videoId) {
    showConfirm({
        title: 'Kalıcı Sil',
        body: 'Bu video R2 ve veritabanından kalıcı olarak silinecek. Bu işlem geri alınamaz.',
        confirmLabel: 'Evet, Kalıcı Sil',
        onConfirm: async () => {
            try {
                await apiFetch(`/api/videos/${encodeURIComponent(String(videoId))}/purge`, { method: 'POST' });
                showNotification('Video kalıcı olarak silindi', 'success');
                loadDeletedVideos();
                loadStatistics();
            } catch (err) {
                showNotification('Kalıcı silme başarısız: ' + (err.message || String(err)), 'error');
            }
        },
    });
}

function exportDeletedCsv() {
    const list = AppState.deletedVideos;
    if (!list.length) {
        showNotification('Dışa aktarılacak silinen video yok', 'warning');
        return;
    }
    const headers = ['ID', 'Orijinal Ad', 'Preset', 'Süre', 'Silinme Tarihi'];
    const rows = list.map(v => [
        v.id,
        `"${(v.original_name || v.bk?.clean_name || '').replace(/"/g, '""')}"`,
        getResolutionLabel(v),
        v.duration ?? v.bk?.duration ?? '',
        v.bk?.deleted_at ? new Date(v.bk.deleted_at).toISOString() : '',
    ].join(','));
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `son_silinenler_${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('CSV indirildi', 'success');
}

function toggleVideoSelection(videoId) {
    const id = String(videoId);
    if (AppState.selectedVideoIds.has(id)) {
        AppState.selectedVideoIds.delete(id);
    } else {
        AppState.selectedVideoIds.add(id);
    }
    updateBulkActionUI();
}

function toggleDeletedSelection(videoId) {
    const id = String(videoId);
    if (AppState.selectedDeletedIds.has(id)) {
        AppState.selectedDeletedIds.delete(id);
    } else {
        AppState.selectedDeletedIds.add(id);
    }
    updateBulkDeletedUI();
}

function updateBulkActionUI() {
    const count = AppState.selectedVideoIds.size;
    const bar = document.getElementById('bulkActionBarVideos');
    const countEl = document.getElementById('bulkSelectedCountVideos');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    const bulkRetryBtn = document.getElementById('bulkRetryBtn');
    const bulkMoveBtn = document.getElementById('bulkMoveBtn');
    if (bar) bar.hidden = count === 0;
    if (countEl) countEl.textContent = count;
    if (bulkDeleteBtn) bulkDeleteBtn.disabled = count === 0;
    if (bulkMoveBtn) bulkMoveBtn.disabled = count === 0;
    const retryable = AppState.videos.filter(v => ['pending', 'uploaded', 'failed', 'processing', 'downloading', 'converting', 'uploading'].includes(v.status));
    const retryableSelected = retryable.filter(v => AppState.selectedVideoIds.has(String(v.id)));
    if (bulkRetryBtn) bulkRetryBtn.disabled = retryableSelected.length === 0;
    if (Els.headerCheckbox) {
        const deletable = AppState.videos.filter(v => !['processing', 'downloading', 'converting', 'uploading'].includes(v.status));
        Els.headerCheckbox.checked = deletable.length > 0 && deletable.every(v => AppState.selectedVideoIds.has(String(v.id)));
        Els.headerCheckbox.indeterminate = deletable.some(v => AppState.selectedVideoIds.has(String(v.id))) && !Els.headerCheckbox.checked;
    }
}

function updateBulkDeletedUI() {
    const count = AppState.selectedDeletedIds.size;
    const bar = document.getElementById('bulkActionBarDeleted');
    const countEl = document.getElementById('bulkSelectedCountDeleted');
    const purgeBtn = document.getElementById('bulkPurgeBtn');
    const headerCb = document.getElementById('headerCheckboxDeleted');
    if (bar) bar.hidden = count === 0;
    if (countEl) countEl.textContent = count;
    if (purgeBtn) purgeBtn.style.display = AppState.appUser?.isRoot ? '' : 'none';
    if (headerCb && AppState.deletedVideos?.length) {
        headerCb.checked = count > 0 && AppState.deletedVideos.every(v => AppState.selectedDeletedIds.has(String(v.id)));
        headerCb.indeterminate = count > 0 && !headerCb.checked;
    }
}

async function bulkRetrySelected() {
    const ids = Array.from(AppState.selectedVideoIds);
    if (ids.length === 0) return;

    showNotification(`${ids.length} video yeniden işleniyor…`, 'info');

    try {
        const res = await apiFetch('/api/jobs/reprocess', {
            method: 'POST',
            body: JSON.stringify({ job_ids: ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n)) }),
        });
        AppState.selectedVideoIds.clear();
        updateBulkActionUI();
        loadVideos();
        showNotification(`${res.reprocessed || ids.length} video kuyruğa alındı`, 'success');
    } catch (err) {
        showNotification('Yeniden işleme başarısız: ' + err.message, 'error');
    }
}

/** Seçilen tüm video job ID'lerini array olarak döndür (D1 Primary Key). */
function getSelectedIds() {
    return Array.from(AppState.selectedVideoIds).map(id => String(id));
}

async function openBulkMoveModal() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
        showNotification('Taşınacak video seçilmedi', 'warning');
        return;
    }
    if (!AppState.folders?.length) await loadFolders();
    const select = document.getElementById('bulkMoveFolderSelect');
    if (!select) return;
    const folders = AppState.folders || [];
    select.innerHTML = '<option value="">Klasör seçin</option>' +
        folders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    select.value = '';
    openModal('bulkMoveModal');
}

function closeBulkMoveModal() {
    closeAllModals();
}

async function confirmBulkMove() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
        showNotification('Taşınacak video seçilmedi', 'warning');
        return;
    }
    const select = document.getElementById('bulkMoveFolderSelect');
    const folderIdRaw = select?.value ?? '';
    const folder_id = folderIdRaw === '' ? null : Number(folderIdRaw);
    const confirmBtn = document.getElementById('bulkMoveConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    try {
        const res = await apiFetch('/api/videos/bulk-move', {
            method: 'POST',
            body: JSON.stringify({ ids, folder_id }),
        });
        const updated = res?.updated ?? ids.length;
        const idSet = new Set(ids.map(id => String(id)));
        AppState.videos = AppState.videos.filter(v => !idSet.has(String(v.id)));
        ids.forEach(id => AppState.selectedVideoIds.delete(String(id)));
        closeBulkMoveModal();
        updateBulkActionUI();
        removeMovedRowsWithAnimation(ids);
        showNotification(`${updated} video taşındı`, 'success');
    } catch (err) {
        showNotification('Toplu taşıma başarısız: ' + (err?.message || String(err)), 'error');
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

/** Taşınan satırlara fade-out uygulayıp kaldırır, sonra tabloyu yeniden çizer. */
function removeMovedRowsWithAnimation(ids) {
    const tbody = getTableBody();
    if (!tbody) {
        renderVideosTable();
        return;
    }
    const idSet = new Set(ids.map(id => String(id)));
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => {
        const vid = tr.getAttribute('data-video-id');
        return vid && idSet.has(String(vid));
    });
    if (rows.length === 0) {
        renderVideosTable();
        return;
    }
    rows.forEach(tr => tr.classList.add('bulk-move-row-out'));
    setTimeout(() => {
        renderVideosTable();
        renderPagination();
    }, 280);
}

async function bulkDeleteSelected() {
    const ids = getSelectedIds();
    if (ids.length === 0) {
        showNotification('Silinecek video seçilmedi', 'warning');
        return;
    }

    logStructured('info', 'Bulk delete selected', { ids, count: ids.length });
    if (typeof window !== 'undefined' && window.__BK_DEBUG_BULK) {
        alert('ID Listesi: ' + ids.join(', '));
    }

    showConfirm({
        title: 'Seçilen Videoları Sil',
        body: `${ids.length} video çöp kutusuna taşınacak (Son Silinenler). Root olarak oradan geri yükleyebilir veya kalıcı silebilirsiniz. Devam?`,
        confirmLabel: 'Evet, Sil',
        onConfirm: async () => {
            const url = (CONFIG?.API_BASE || '') + '/api/videos/bulk-delete';
            const body = JSON.stringify({ ids });
            try {
                const res = await apiFetch('/api/videos/bulk-delete', {
                    method: 'POST',
                    body,
                });
                AppState.selectedVideoIds.clear();
                updateBulkActionUI();
                loadVideos();
                loadStatistics();
                var msg;
                if ((res.errors && res.errors.length) > 0) {
                    msg = res.deleted > 0
                        ? `${res.deleted} silindi, ${res.errors.length} hata: ${(res.errors.slice(0, 2).join('; '))}${res.errors.length > 2 ? '...' : ''}`
                        : `Silinemedi: ${(res.errors.slice(0, 2).join('; '))}${res.errors.length > 2 ? '...' : ''}`;
                    showNotification(msg, res.deleted > 0 ? 'success' : 'error');
                } else {
                    msg = res.skipped?.length
                        ? `${res.deleted} silindi, ${res.skipped.length} işleniyor (atlandı)`
                        : `${res.deleted} video çöp kutusuna taşındı`;
                    showNotification(msg, 'success');
                }
            } catch (err) {
                logStructured('error', 'Bulk delete failed', { error: err?.message || String(err) });
                showNotification('Silme başarısız: ' + err.message, 'error');
            }
        },
    });
}

async function bulkRestoreSelected() {
    const ids = Array.from(AppState.selectedDeletedIds);
    if (ids.length === 0) return;

    showNotification(`${ids.length} video geri yükleniyor…`, 'info');

    try {
        const res = await apiFetch('/api/videos/bulk-restore', {
            method: 'POST',
            body: JSON.stringify({ ids }),
        });
        AppState.selectedDeletedIds.clear();
        updateBulkDeletedUI();
        loadDeletedVideos();
        loadStatistics();
        loadVideos();
        showNotification(`${res.restored ?? res} video geri yüklendi`, 'success');
    } catch (err) {
        showNotification('Geri yükleme başarısız: ' + err.message, 'error');
    }
}

async function bulkPurgeSelected() {
    const ids = Array.from(AppState.selectedDeletedIds);
    if (ids.length === 0) return;

    showConfirm({
        title: 'Seçilen Videoları Kalıcı Sil',
        body: `${ids.length} video R2 ve veritabanından kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
        confirmLabel: 'Evet, Kalıcı Sil',
        onConfirm: async () => {
            try {
                const res = await apiFetch('/api/videos/bulk-purge', {
                    method: 'POST',
                    body: JSON.stringify({ ids }),
                });
                AppState.selectedDeletedIds.clear();
                updateBulkDeletedUI();
                loadDeletedVideos();
                showNotification(`${res.purged ?? res} video kalıcı olarak silindi`, 'success');
            } catch (err) {
                showNotification('Kalıcı silme başarısız: ' + err.message, 'error');
            }
        },
    });
}

async function wakeServer() {
    showNotification('Sunucu uyandırılıyor…', 'info');
    try {
        await apiFetch('/api/jobs/wakeup', { method: 'POST' });
        showNotification('Sunucu uyandırıldı', 'success');
    } catch (err) {
        showNotification('Wakeup başarısız: ' + err.message, 'error');
    }
}

function retryProcessing(videoId) {
    const video = AppState.videos.find(v => v.id == videoId);
    if (!video) return;

    showNotification('Video işlemi yeniden başlatılıyor…', 'info');

    const run = CONFIG.USE_MOCK
        ? () => { video.status = 'processing'; renderVideosTable(); showNotification('Video işleme kuyruğuna alındı', 'success'); }
        : async () => {
            try {
                await apiFetch('/api/jobs/reprocess', {
                    method: 'POST',
                    body: JSON.stringify({ job_ids: [parseInt(videoId, 10)] }),
                });
                video.status = 'processing';
                loadVideos();
                showNotification('Video işleme kuyruğuna alındı', 'success');
            } catch (err) {
                showNotification('Yeniden işleme başarısız: ' + err.message, 'error');
            }
        };

    setTimeout(run, 400);
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // Focus first interactive element
    modal.querySelector('button, [tabindex="0"]')?.focus();
}

function closeAllModals() {
    destroyActivePlayer();
    closeThumbLightbox();
    const playerContainer = document.getElementById('bkPlayerContainer');
    if (playerContainer) {
        playerContainer.style.display = 'none';
        playerContainer.innerHTML = '';
    }

    document.querySelectorAll('.modal.show').forEach(m => {
        m.classList.remove('show');
        m.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = '';
}

function closeModal() { closeAllModals(); }
function closeStatsModal() { closeAllModals(); }

// ── Thumbnail Lightbox v2: compat shims for closeAllModals etc. ─────────────
function openThumbLightbox(url, el) {
    if (window._bkThumbLightbox) window._bkThumbLightbox.open(url, el);
}
function closeThumbLightbox() {
    if (window._bkThumbLightbox) window._bkThumbLightbox.close();
}

function viewErrorDetail(videoId) {
    const video = AppState.videos.find(v => v.id == videoId);
    const modal = document.getElementById('errorDetailModal');
    const contentEl = document.getElementById('errorDetailContent');
    if (!video || !modal || !contentEl) return;
    const msg = video.bk?.error_message || 'Hata detayı mevcut değil.';
    const ffmpeg = video.bk?.ffmpeg_output || '';
    let html = `<pre class="error-detail-pre"><code>${escapeHtml(msg)}</code></pre>`;
    if (ffmpeg) {
        html += `<h4 style="margin-top:16px;font-size:12px;color:var(--text-muted);">FFmpeg Çıktısı</h4><pre class="error-detail-pre"><code>${escapeHtml(ffmpeg)}</code></pre>`;
    }
    contentEl.innerHTML = html;
    openModal('errorDetailModal');
}

async function viewVideoDetails(videoId) {
    const video = AppState.videos.find(v => v.id == videoId);
    const modal = document.getElementById('videoModal');
    if (!video || !modal) return;
    if (!AppState.folders?.length) await loadFolders();

    if (video.status === 'completed') {
        apiFetch(`/api/videos/${encodeURIComponent(video.id)}/hit`, { method: 'POST' })
            .then(() => {
                video.view_count = (video.view_count ?? 0) + 1;
                loadTopViewed();
            })
            .catch(() => { });
    }

    const uploadDate = new Date(video.uploaded_at).toLocaleString('tr-TR');
    const processDate = video.processing_completed_at
        ? new Date(video.processing_completed_at).toLocaleString('tr-TR')
        : '—';
    const fileSizeMB = (video.file_size / 1_048_576).toFixed(1);
    const fileSizeGB = (video.file_size / 1_073_741_824).toFixed(2);
    const outputBytes = video.file_size_output ?? video.bk?.file_size_output ?? 0;
    const STATUS_LABELS = { uploaded: 'Yüklendi', processing: 'İşleniyor', completed: 'Tamamlandı', failed: 'Başarısız' };

    const detailItem = (label, value) => `
        <div class="detail-group">
            <div class="detail-label">${label}</div>
            <div class="detail-value">${value}</div>
        </div>`;

    document.getElementById('modalDetails').innerHTML = `
        ${detailItem('Video ID', escapeHtml(video.id))}
        ${detailItem('Orijinal Ad', escapeHtml(video.original_name))}
        ${detailItem('Normalize Edilmiş Ad', escapeHtml(getNormalizedNameWithResolution(video)))}
        ${detailItem('Durum', `<span class="status-badge status-${video.status}">${STATUS_LABELS[video.status] ?? video.status}</span>`)}
        ${detailItem('Render Preseti', video.render_preset === '720p_web' ? '720p Web Optimize' : '1080p Web Optimize')}
        ${detailItem('Boyut', `${fileSizeMB} MB (${fileSizeGB} GB)`)}
        ${detailItem('İşlenmiş Boyut', outputBytes > 0 ? `${(outputBytes / 1_048_576).toFixed(2)} MB` : '—')}
        ${detailItem('Çözünürlük', video.resolution ?? '—')}
        ${detailItem('Yükleyen', escapeHtml(video.uploaded_by))}
        ${detailItem('Yükleme Tarihi', uploadDate)}
        ${detailItem('İşlem Tamamlanma', processDate)}
        ${detailItem('Etiketler', escapeHtml(video.tags) || '—')}
        ${detailItem('Proje Adı', escapeHtml(video.project_name) || '—')}
        ${(function () {
            const folders = AppState.folders || [];
            const currentId = video.folder_id ?? video.bk?.folder_id ?? '';
            const options = '<option value="">Klasör yok</option>' + folders.map(f => `<option value="${f.id}" ${f.id == currentId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('');
            return detailItem('Klasör', `<select class="bk-folder-select" data-video-id="${escapeHtml(video.id)}" onchange="moveVideoToFolder('${escapeHtml(video.id)}', this.value)" aria-label="Klasöre taşı">${options}</select>`);
        })()}
        ${video.status === 'completed'
            ? detailItem('Video URL', `<a href="${escapeHtml(video.public_url || `https://cdn.bilgekarga.tr/videos/${encodeURIComponent(video.normalized_name)}`)}" target="_blank" rel="noopener noreferrer">Linki Aç ↗</a>`)
            : ''}
    `;

    const logsEl = document.getElementById('modalLogs');
    if (logsEl) logsEl.innerHTML = `<h4>İşlem Logları</h4>${buildVideoLogs(video, uploadDate, processDate)}`;

    // Modal actions (retry / download)
    const actionsEl = modal.querySelector('.modal-actions');
    if (actionsEl) {
        const retryable = ['pending', 'uploaded', 'failed', 'processing', 'downloading', 'converting', 'uploading'].includes(video.status);
        actionsEl.innerHTML = `
            ${video.status === 'completed'
                ? `<button class="btn btn-primary" onclick="downloadVideo('${escapeHtml(video.id)}')">${IC.download} İndir</button>`
                : ''}
            ${retryable ? `<button class="btn btn-ghost" onclick="retryProcessing('${escapeHtml(video.id)}')">${IC.retry} Yeniden İşle</button>` : ''}
        `;
    }

    // ── Video player in modal: HTML5 <video> with Public (processed) URL only — avoids MEDIA_ELEMENT_ERROR / URL safety
    const playerContainer = document.getElementById('bkPlayerContainer');
    if (playerContainer) {
        destroyActivePlayer();

        if (video.status === 'completed') {
            // Only processed (Public) CDN URL — never raw or presigned
            const publicUrl = (video.bk && video.bk.public_url) || video.public_url;
            const isPublicCdn = publicUrl && (publicUrl.startsWith('https://cdn.bilgekarga.tr') || publicUrl.includes('/videos/'));
            const videoSrc = isPublicCdn ? publicUrl : `https://cdn.bilgekarga.tr/videos/${encodeURIComponent((video.normalized_name || video.original_name || '').trim() || 'video')}.mp4`;

            playerContainer.style.display = 'block';
            playerContainer.innerHTML = '<video class="bk-modal-video" controls autoplay playsinline style="width:100%;max-height:360px;border-radius:6px;background:#000;">Tarayıcınız video etiketini desteklemiyor.</video>';
            const videoEl = playerContainer.querySelector('video');
            videoEl.src = videoSrc;
            videoEl.load(); // PLAY_01: Force load so playback starts reliably (avoids "black screen" illusion)
            videoEl.addEventListener('error', function onErr() {
                playerContainer.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:8px;">
                    <span style="color:#dc2626;">Video yüklenemedi</span><br>
                    <small style="color:var(--text-muted);font-size:.8rem;">${escapeHtml(this.error?.message || 'Bilinmeyen hata')}</small>
                </div>`;
            });
        } else {
            playerContainer.style.display = 'none';
        }
    }

    openModal('videoModal');
}

function buildVideoLogs(video, uploadDate, processDate) {
    const entry = (time, msg) => `
        <div class="log-entry">
            <div class="log-time">${time}</div>
            <div class="log-message">${escapeHtml(msg)}</div>
        </div>`;

    let html = entry(uploadDate, `Video yüklendi: ${video.original_name}`);
    if (video.status === 'processing' || video.status === 'completed') {
        html += entry(uploadDate, `Dosya normalizasyonu: ${video.normalized_name}`);
        html += entry(uploadDate, `FFmpeg işlemi başlatıldı (${video.render_preset === '720p_web' ? '720p Web Optimize' : '1080p Web Optimize'})`);
    }
    if (video.status === 'completed') {
        html += entry(processDate, "Video işlendi ve R2'ye yüklendi");
        html += entry(processDate, 'İşlem tamamlandı');
    }
    if (video.status === 'failed') {
        html += entry(uploadDate, 'Video işlenirken hata oluştu. Lütfen "Yeniden İşle" düğmesine tıklayın.');
    }
    return html;
}

function showStatsModal() {
    const modal = document.getElementById('statsModal');
    const detailsEl = document.getElementById('statsDetails');
    if (!modal || !detailsEl) return;

    const s = AppState.statistics?.summary ?? {};
    const ra = AppState.statistics?.recent_activity ?? [];
    const tu = AppState.statistics?.top_uploaders ?? [];

    if (!AppState.statistics?.summary && AppState.statsError) {
        detailsEl.innerHTML = `
            <div class="detail-group" style="grid-column:1/-1">
                <div class="detail-label">Hata</div>
                <div class="detail-value">${escapeHtml(AppState.statsError)}</div>
            </div>
            <div class="modal-actions" style="grid-column:1/-1;margin-top:16px">
                <button class="btn btn-primary" onclick="loadStatistics().then(()=>showStatsModal())">Tekrar Dene</button>
            </div>`;
        openModal('statsModal');
        return;
    }

    const total = s.total_videos ?? 0;
    const pct = (n) => total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';

    const detailItem = (label, value) => `
        <div class="detail-group">
            <div class="detail-label">${label}</div>
            <div class="detail-value">${value}</div>
        </div>`;

    detailsEl.innerHTML = `
        ${detailItem('Toplam Video', total)}
        ${detailItem('İşlenmiş', `${s.completed ?? 0} (${pct(s.completed ?? 0)})`)}
        ${detailItem('İşleniyor', `${s.processing ?? 0} (${pct(s.processing ?? 0)})`)}
        ${detailItem('Başarısız', `${s.failed ?? 0} (${pct(s.failed ?? 0)})`)}
        ${detailItem('Yüklendi', `${s.uploaded ?? 0} (${pct(s.uploaded ?? 0)})`)}
        ${detailItem('Ort. İşlem Süresi', `${s.avg_processing_time ?? 0} saniye`)}
        ${detailItem('720p Preset', `${s.preset_720p ?? 0} video (${pct(s.preset_720p ?? 0)})`)}
        ${detailItem('1080p Preset', `${s.preset_1080p ?? 0} video (${pct(s.preset_1080p ?? 0)})`)}
        ${detailItem('Benzersiz Yükleyen', `${s.unique_uploaders} kullanıcı`)}
        ${ra.length ? `
            <div class="detail-group" style="grid-column:1/-1">
                <div class="detail-label">Son 5 Günün Aktivitesi</div>
                <div>${ra.map(d =>
        `<div class="log-entry"><div class="log-time">${d.date}</div><div class="log-message">${d.uploads} yükleme, ${d.completed} tamamlandı</div></div>`
    ).join('')}</div>
            </div>` : ''}
        ${tu.length ? `
            <div class="detail-group" style="grid-column:1/-1">
                <div class="detail-label">En Çok Yükleyenler</div>
                <div>${tu.map(u =>
        `<div class="log-entry"><div class="log-time">${escapeHtml(u.uploaded_by)}</div><div class="log-message">${u.upload_count} video — ${(u.total_size / 1_073_741_824).toFixed(2)} GB</div></div>`
    ).join('')}</div>
            </div>` : ''}
    `;

    openModal('statsModal');
}


// ─── MOCK DATA (replace with real API calls) ──────────────────────────────────
function getMockStats() {
    return {
        summary: {
            total_videos: 42,
            completed: 35,
            processing: 3,
            failed: 2,
            uploaded: 2,
            total_storage_bytes: 15_480_000_000,
            avg_processing_time: 127,
            unique_uploaders: 3,
            preset_720p: 28,
            preset_1080p: 14,
            last_week_total: 13,
        },
        recent_activity: [
            { date: '2026-02-19', uploads: 3, completed: 2 },
            { date: '2026-02-18', uploads: 2, completed: 3 },
            { date: '2026-02-17', uploads: 4, completed: 4 },
            { date: '2026-02-16', uploads: 1, completed: 1 },
            { date: '2026-02-15', uploads: 3, completed: 2 },
        ],
        top_uploaders: [
            { uploaded_by: 'admin', upload_count: 28, total_size: 11_200_000_000 },
            { uploaded_by: 'user1', upload_count: 10, total_size: 3_500_000_000 },
            { uploaded_by: 'user2', upload_count: 4, total_size: 780_000_000 },
        ],
    };
}

function generateMockVideos() {
    const STATUSES = ['uploaded', 'processing', 'completed', 'failed'];
    const PRESETS = ['720p_web', '1080p_web'];
    const USERS = ['admin', 'user1', 'user2'];
    const NAMES = ['gunes-gozlugu-tanitimi', 'urun-demo-2026', 'egitim-videosu', 'tanitim-reklami', 'konferans-kaydi', 'webinar-kaydi', 'musteri-testimonials', 'sirket-tanitimi', 'urun-kullanim-kilavuzu', 'teknik-demo'];
    const ORIGINALS = ['güneş gözlüğü.mp4', 'ürün demo 2026.mov', 'eğitim videosu.avi', 'tanıtım reklamı.mp4', 'konferans kaydı.mkv', 'webinar kaydı.webm', 'müşteri testimonials.mp4', 'şirket tanıtımı.mov', 'ürün kullanım kılavuzu.avi', 'teknik demo.mp4'];

    // Deterministic seed — identical requests yield identical results (no Math.random)
    const seed = AppState.currentPage * 100 + Object.values(AppState.filters).join('').length;
    const seeded = (n) => (seed * 9301 + 49297) % 233280 / 233280 * n | 0;

    const videos = Array.from({ length: 20 }, (_, i) => {
        const ni = (i + seed) % NAMES.length;
        const s = STATUSES[(i + seeded(4)) % STATUSES.length];
        const p = PRESETS[(i + seeded(2)) % PRESETS.length];
        const u = USERS[(i + seeded(3)) % USERS.length];
        return {
            id: `vid_p${AppState.currentPage}_${i}`,
            normalized_name: `${NAMES[ni]}-${(i + seed).toString(36).padStart(6, '0')}.mp4`,
            original_name: ORIGINALS[ni],
            status: s,
            render_preset: p,
            file_size: (i + 1) * 52_428_800,
            duration: (i + 1) * 30,
            resolution: p === '720p_web' ? '1280x720' : '1920x1080',
            uploaded_by: u,
            uploaded_at: new Date(Date.now() - i * 86_400_000).toISOString(),
            processing_completed_at: s === 'completed' ? new Date(Date.now() - i * 82_000_000).toISOString() : null,
            tags: 'ürün,tanıtım',
            project_name: '2026 Tanıtım Videoları',
            notes: '',
        };
    });

    return { videos, totalCount: 42, page: AppState.currentPage, totalPages: 3, limit: 20 };
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function escapeHtml(text) {
    if (text == null) return '';
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
}

function truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str ?? '';
    return str.slice(0, maxLen) + '…';
}

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m ? `${m} dk ${s} sn` : `${s} sn`;
}

/** VideoListDTO → { videos, totalPages, total } */
function fromVideoListDTO(res) {
    return {
        videos: (res.data || []).map(fromVideoDTO),
        totalPages: Math.ceil((res.total || 0) / (res.per_page || 25)) || 1,
        total: res.total || 0,
    };
}

/** VideoDTO → dashboard'un beklediği iç temsil */
function fromVideoDTO(dto) {
    const bk = dto.bk || {};
    return {
        id: bk.job_id,
        original_name: dto.name || bk.original_name,
        normalized_name: bk.clean_name,
        status: (bk.status || '').toLowerCase(),
        render_preset: bk.quality === '720p' ? '720p_web' : '1080p_web',
        file_size: bk.file_size_input || 0,
        file_size_output: bk.file_size_output || 0,
        uploaded_at: dto.created_time,
        processing_completed_at: dto.release_time,
        uploaded_by: dto.user?.name,
        tags: bk.tags,
        project_name: bk.project_name,
        notes: bk.notes,
        resolution: bk.resolution,
        public_url: bk.public_url || dto.files?.[0]?.link,
        thumbnail_url: dto.thumbnail_url || bk.thumbnail_url,
        duration: dto.duration,
        view_count: dto.view_count ?? bk.view_count ?? 0,
        deleted_at: bk.deleted_at,
        bk,
    };
}

function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// ─── NOTIFICATION SYSTEM ─────────────────────────────────────────────────────
function showNotification(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `bk-notification bk-notification-${type}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `
        <span>${escapeHtml(message)}</span>
        <button class="bk-notification-dismiss" aria-label="Bildirimi kapat">×</button>
    `;

    function dismiss(n) {
        if (n._dismissTimer) clearTimeout(n._dismissTimer);
        n._dismissTimer = null;
        n.style.animation = 'bk-slide-out .3s ease forwards';
        setTimeout(() => n.remove(), 280);
    }

    el.querySelector('.bk-notification-dismiss').addEventListener('click', () => dismiss(el));
    document.body.appendChild(el);

    el._dismissTimer = setTimeout(() => dismiss(el), 5000);
    el.addEventListener('mouseenter', () => {
        if (el._dismissTimer) { clearTimeout(el._dismissTimer); el._dismissTimer = null; }
    });
    el.addEventListener('mouseleave', () => {
        el._dismissTimer = setTimeout(() => dismiss(el), 2000);
    });
}

// ─── CONFIRM DIALOG ───────────────────────────────────────────────────────────
function showConfirm({ icon = '', title, body, confirmLabel = 'Onayla', onConfirm }) {
    const overlay = document.createElement('div');
    overlay.className = 'bk-confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.innerHTML = `
        <div class="bk-confirm-box">
            <div class="bk-confirm-title">${escapeHtml(title)}</div>
            <div class="bk-confirm-body">${body}</div>
            <div class="bk-confirm-actions">
                <button class="bk-confirm-cancel">İptal</button>
                <button class="bk-confirm-danger">${escapeHtml(confirmLabel)}</button>
            </div>
        </div>
    `;

    overlay.querySelector('.bk-confirm-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.bk-confirm-danger').addEventListener('click', () => {
        overlay.remove();
        onConfirm();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    overlay.querySelector('.bk-confirm-danger').focus();
}

// ─── URL IMPORT MODAL ─────────────────────────────────────────────────────────

/** Detect platform from URL and return a hint label */
function detectUrlPlatform(rawUrl) {
    try {
        const u = new URL(rawUrl);
        if (u.hostname.includes('drive.google.com')) return 'Google Drive';
        if (u.hostname.includes('dropbox.com')) return 'Dropbox';
        if (u.hostname.includes('1drv.ms') ||
            u.hostname.includes('onedrive.live.com')) return 'OneDrive';
        const ext = u.pathname.split('.').pop().toLowerCase();
        if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'Doğrudan video URL';
        return '';
    } catch {
        return '';
    }
}

function showUrlModal() {
    const input = document.getElementById('urlInput');
    const hint = document.getElementById('urlHint');
    const errorEl = document.getElementById('urlError');
    const project = document.getElementById('urlProject');

    if (input) { input.value = ''; }
    if (hint) { hint.textContent = ''; }
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
    if (project) { project.value = ''; }

    // Populate folders
    const folderSelect = document.getElementById('urlFolder');
    if (folderSelect) {
        const userFolders = (AppState.folders || []).filter(f => !f.is_system);
        folderSelect.innerHTML = '<option value="">Klasör Seçin (Opsiyonel)...</option>' +
            userFolders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    }

    openModal('urlModal');
    setTimeout(() => input?.focus(), 80);
}

function closeUrlModal() {
    closeAllModals();
}

async function submitUrlImport() {
    const urlVal = document.getElementById('urlInput')?.value.trim() || '';
    const preset = document.getElementById('urlPreset')?.value || '720p';
    const project = document.getElementById('urlProject')?.value.trim() || '';
    const folderId = document.getElementById('urlFolder')?.value || '';
    const errorEl = document.getElementById('urlError');
    const submitBtn = document.getElementById('urlSubmitBtn');

    // Reset error
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

    // Validate
    if (!urlVal) {
        if (errorEl) { errorEl.textContent = 'URL boş bırakılamaz.'; errorEl.style.display = 'block'; }
        document.getElementById('urlInput')?.focus();
        return;
    }
    try { new URL(urlVal); } catch {
        if (errorEl) { errorEl.textContent = 'Geçerli bir URL girin (https://…).'; errorEl.style.display = 'block'; }
        document.getElementById('urlInput')?.focus();
        return;
    }

    // Disable button while processing
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Ekleniyor…'; }

    try {
        if (CONFIG.USE_MOCK) {
            await delay(600);
            // Add a fake pending entry to the top of the video list
            const platform = detectUrlPlatform(urlVal);
            const fakeFilename = urlVal.split('/').pop().split('?')[0] || 'url-video.mp4';
            const mockJob = {
                id: 'vid_url_' + Math.random().toString(36).slice(2, 9),
                normalized_name: fakeFilename.replace(/[^a-z0-9.]/gi, '-').toLowerCase(),
                original_name: fakeFilename,
                status: 'uploaded',
                render_preset: preset === '720p' ? '720p_web' : '1080p_web',
                file_size: 0,
                uploaded_at: new Date().toISOString(),
                uploaded_by: 'admin',
                project_name: project,
                tags: '',
                notes: platform ? `Kaynak: ${platform}` : 'URL ile eklendi',
            };
            AppState.videos.unshift(mockJob);
            renderVideosTable();
            closeAllModals();
            showNotification(`URL kuyruğa alındı${platform ? ` (${platform})` : ''}`, 'success');
        } else {
            const result = await apiFetch('/api/videos/upload/from-url', {
                method: 'POST',
                body: JSON.stringify({ url: urlVal, quality: preset, projectName: project, folder_id: folderId }),
            });
            closeAllModals();
            const msg = result.job_count != null
                ? `${result.job_count} video kuyruğa alındı`
                : `Kuyruğa alındı: ${result.clean_name || urlVal}`;
            showNotification(msg, 'success');
            loadVideos();
        }
    } catch (err) {
        if (errorEl) { errorEl.textContent = `Hata: ${err.message}`; errorEl.style.display = 'block'; }
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = `<svg width="13" height="13"><use href="#i-link"/></svg> Kuyruğa Ekle`; }
    }
}

// ─── Top Viewed (En Çok İzlenenler) ─────────────────────────────────────────
async function loadTopViewed() {
    const listEl = document.getElementById('topViewedList');
    const listDash = document.getElementById('topViewedListDashboard');
    const targets = [listEl, listDash].filter(Boolean);
    if (!targets.length) return;
    try {
        const data = await apiFetch('/api/videos/top-viewed?limit=5');
        const jobs = data?.data ?? data ?? [];
        const emptyHtml = '<div class="bk-empty-state" style="padding:24px"><span style="color:var(--text-subtle)">Henüz izlenme verisi yok</span></div>';
        const errHtml = '<div class="bk-empty-state" style="padding:24px"><span style="color:var(--text-subtle)">Yüklenemedi</span></div>';
        if (!jobs.length) {
            targets.forEach(el => { el.innerHTML = emptyHtml; });
            return;
        }
        const cdnBase = 'https://cdn.bilgekarga.tr';
        const html = jobs.map(v => {
            const vid = v.bk?.job_id ?? v.uri?.replace(/^.*\/api\/videos\//, '').replace(/\?.*$/, '') ?? '';
            const thumb = v.thumbnail_url || (v.bk?.thumbnail_key ? `${cdnBase}/${v.bk.thumbnail_key}` : null);
            const name = (v.bk?.original_name || v.name || v.bk?.clean_name || vid || '—').toString();
            const views = v.view_count ?? v.bk?.view_count ?? 0;
            return `<div class="top-viewed-item" onclick="viewVideoDetails('${escapeHtml(String(vid))}')" role="button" tabindex="0">
                <div class="top-viewed-thumb">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '<span style="color:var(--text-subtle)">—</span>'}</div>
                <div class="top-viewed-info">
                    <div class="top-viewed-name">${escapeHtml(truncate(name, 36))}</div>
                    <div class="top-viewed-count">${escapeHtml(String(views))} izlenme</div>
                </div>
            </div>`;
        }).join('');
        targets.forEach(el => { el.innerHTML = html; });
    } catch (e) {
        targets.forEach(el => { el.innerHTML = errHtml; });
    }
}

// ─── USER MANAGEMENT (root only) ─────────────────────────────────────────────
async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<div class="bk-empty-state" style="grid-column:1/-1;padding:40px"><div class="bk-skeleton" style="width:120px;height:24px;margin:0 auto"></div><div style="margin-top:8px;color:var(--text-subtle)">Yükleniyor…</div></div>';
    try {
        const users = await apiFetch('/api/users');
        if (!users || !Array.isArray(users)) {
            tbody.innerHTML = '<div class="bk-empty-state" style="grid-column:1/-1"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.alert + '</div><div class="bk-empty-state-title">Veri alınamadı</div></div>';
            return;
        }
        if (!users.length) {
            tbody.innerHTML = '<div class="bk-empty-state" style="grid-column:1/-1"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">Henüz kullanıcı yok</div><div class="bk-empty-state-sub">Yeni Admin ile ekleyin</div></div>';
            return;
        }
        const me = AppState.appUser;
        const myId = me?.userId ?? null;
        const isRoot = me?.isRoot ?? false;
        tbody.innerHTML = users.map(u => {
            const created = u.created_at ? new Date(u.created_at).toLocaleDateString('tr-TR') : '—';
            const lastLogin = u.last_login ? new Date(u.last_login).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
            const statusCls = u.is_active ? 'status-completed' : 'status-failed';
            const statusText = u.is_active ? 'Aktif' : 'Pasif';
            const roleBadge = u.role === 'root' ? '<span class="status-badge status-uploaded role-root">Root</span>' : '<span class="status-badge status-pending role-admin">Admin</span>';
            const toggleText = u.is_active ? 'Pasif yap' : 'Aktif yap';
            const isSelf = myId != null && u.id === myId;
            const isTargetRoot = u.role === 'root';
            const canDelete = !isSelf && !isTargetRoot;
            const canToggle = !isSelf && (!isTargetRoot || isRoot);
            const canEditPwd = !isTargetRoot || isRoot;
            return `<div class="saas-table-row" data-user-id="${u.id}">
                <div class="saas-col saas-col-user cell-text">${escapeHtml(u.username)}</div>
                <div class="saas-col saas-col-role">${roleBadge}</div>
                <div class="saas-col saas-col-status"><span class="status-badge ${statusCls}">${statusText}</span></div>
                <div class="saas-col saas-col-date cell-mono">${escapeHtml(created)}</div>
                <div class="saas-col saas-col-lastlogin cell-mono">${escapeHtml(lastLogin)}</div>
                <div class="saas-col saas-col-actions">
                    ${canToggle ? `<button class="action-btn" onclick="toggleUserActive(${u.id}, ${!u.is_active})" title="${escapeHtml(toggleText)}">${escapeHtml(toggleText)}</button>` : ''}
                    ${canEditPwd ? `<button class="action-btn" onclick="promptChangePassword(${u.id})" title="Şifre değiştir">Şifre değiştir</button>` : ''}
                    ${canDelete ? `<button class="action-btn action-delete" onclick="deleteUser(${u.id})" title="Kullanıcıyı sil">${IC.trash} Sil</button>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = '<div class="bk-empty-state" style="grid-column:1/-1"><div class="bk-empty-state-icon" style="color:#f87171">' + IC.alert + '</div><div class="bk-error-state-title">' + escapeHtml(err.message) + '</div><button class="bk-error-retry" onclick="loadUsers()">Tekrar dene</button></div>';
    }
}

function showNewUserModal() {
    const modal = document.getElementById('newUserModal');
    const username = document.getElementById('newUserUsername');
    const password = document.getElementById('newUserPassword');
    const role = document.getElementById('newUserRole');
    const errorEl = document.getElementById('newUserError');
    if (modal && username && password && role && errorEl) {
        username.value = '';
        password.value = '';
        role.value = 'admin';
        errorEl.style.display = 'none';
        errorEl.textContent = '';
        modal.classList.add('show');
    }
}

function closeNewUserModal() {
    const modal = document.getElementById('newUserModal');
    if (modal) modal.classList.remove('show');
}

async function submitNewUser() {
    const username = document.getElementById('newUserUsername')?.value?.trim();
    const password = document.getElementById('newUserPassword')?.value || '';
    const role = document.getElementById('newUserRole')?.value || 'admin';
    const errorEl = document.getElementById('newUserError');
    const submitBtn = document.getElementById('newUserSubmitBtn');
    if (!username || !password) {
        if (errorEl) { errorEl.textContent = 'Kullanıcı adı ve şifre gerekli'; errorEl.style.display = 'block'; }
        return;
    }
    if (submitBtn) submitBtn.disabled = true;
    if (errorEl) errorEl.style.display = 'none';
    try {
        await apiFetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role }),
        });
        closeNewUserModal();
        loadUsers();
        showNotification('Kullanıcı oluşturuldu', 'success');
    } catch (err) {
        if (errorEl) { errorEl.textContent = err.message || 'Hata oluştu'; errorEl.style.display = 'block'; }
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function toggleUserActive(userId, isActive) {
    try {
        await apiFetch(`/api/users/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: isActive }),
        });
        showNotification(isActive ? 'Kullanıcı aktif yapıldı' : 'Kullanıcı pasif yapıldı', 'success');
        loadUsers();
    } catch (err) {
        showNotification(err.message || 'İşlem başarısız', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('Bu kullanıcıyı devre dışı bırakmak istediğinize emin misiniz?')) return;
    try {
        await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
        showNotification('Kullanıcı devre dışı bırakıldı', 'success');
        loadUsers();
    } catch (err) {
        showNotification(err.message || 'İşlem başarısız', 'error');
    }
}

function loadR2Stats() {
    if (typeof renderR2StorageWidget === 'function') renderR2StorageWidget();
}

async function loadR2BucketList() {
    const body = document.getElementById('r2BucketListBody');
    if (!body) return;
    const bucket = document.getElementById('r2BucketSelect')?.value || 'bk-video-raw';
    const prefix = document.getElementById('r2PrefixInput')?.value?.trim() || '';
    body.innerHTML = '<div class="bk-empty-state" style="padding:24px"><div class="bk-skeleton" style="width:80px;height:20px;margin:0 auto"></div><div style="margin-top:8px;color:var(--text-subtle)">Yükleniyor…</div></div>';
    try {
        let url = `/api/r2/list?bucket=${encodeURIComponent(bucket)}`;
        if (prefix) url += '&prefix=' + encodeURIComponent(prefix);
        const res = await apiFetch(url);
        const objects = res.objects || [];
        if (!objects.length) {
            body.innerHTML = '<div class="bk-empty-state"><div class="bk-empty-state-icon" style="color:var(--text-subtle)">' + IC.inbox + '</div><div class="bk-empty-state-title">Dosya bulunamadı</div></div>';
        } else {
            body.innerHTML = objects.map(o => {
                const sizeStr = o.size >= 1e9 ? (o.size / 1e9).toFixed(1) + ' GB' : o.size >= 1e6 ? (o.size / 1e6).toFixed(1) + ' MB' : o.size >= 1e3 ? (o.size / 1e3).toFixed(1) + ' KB' : o.size + ' B';
                const uploaded = o.uploaded ? new Date(o.uploaded).toLocaleString('tr-TR') : '—';
                return `<div class="table-row" style="grid-template-columns: 2fr 1fr 1.2fr">
                    <div class="table-cell cell-mono" style="font-size:11px;word-break:break-all">${escapeHtml(o.key)}</div>
                    <div class="table-cell cell-mono">${escapeHtml(sizeStr)}</div>
                    <div class="table-cell cell-mono">${escapeHtml(uploaded)}</div>
                </div>`;
            }).join('');
        }
        const paginationEl = document.getElementById('r2ListPagination');
        if (paginationEl) {
            paginationEl.textContent = res.truncated ? `${objects.length} nesne gösteriliyor (devamı var)` : `${objects.length} nesne`;
        }
    } catch (err) {
        body.innerHTML = '<div class="bk-error-state"><div class="bk-error-state-title">Hata</div><div style="color:var(--text-muted)">' + escapeHtml(err.message) + '</div><button class="bk-error-retry" onclick="loadR2BucketList()">Tekrar Dene</button></div>';
    }
}

async function r2Purge() {
    const btn = document.getElementById('r2PurgeBtn');
    if (btn) btn.disabled = true;
    try {
        const r = await apiFetch('/api/r2/purge', { method: 'POST' });
        showNotification(`Temizlendi: ${r?.cleaned_count ?? 0} iş`, 'success');
        loadR2Stats();
        loadStatistics();
        loadVideos();
    } catch (err) {
        showNotification(err.message || 'Purge başarısız', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function promptChangePassword(userId) {
    const newPassword = window.prompt('Yeni şifreyi girin:');
    if (newPassword === null || newPassword === '') return;
    try {
        await apiFetch(`/api/users/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ password: newPassword }),
        });
        showNotification('Şifre güncellendi', 'success');
    } catch (err) {
        showNotification(err.message || 'Şifre güncellenemedi', 'error');
    }
}

// ─── R2 Orphan Cleanup ────────────────────────────────────────────────────────
async function cleanupR2Orphans() {
    const btn = document.getElementById('r2CleanupBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Temizleniyor…'; }
    try {
        const res = await apiFetch('/api/admin/cleanup-r2', { method: 'POST' });
        const data = await res.json();
        alert(`Temizlik tamamlandı!\nRaw silinen: ${data.deleted_raw_count}\nÇöp kovasından silinen: ${data.deleted_trash_count}`);
    } catch (e) {
        alert('Temizlik başarısız: ' + (e?.message || e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg width="14" height="14"><use href="#i-trash"></use></svg> Hayalet Dosyaları Temizle';
        }
    }
}

// ─── Nuclear Button (Purge Raw) ───────────────────────────────────────────────
async function purgeRawBucket() {
    const btn = document.getElementById('btnNukeRaw');
    const keyword = 'POCO-T';
    const input = window.prompt(`DİKKAT: RAW bucket'ındaki TÜM dosyalar kalıcı olarak silinecektir!\n\nOnaylamak için büyük harflerle "${keyword}" yazın:`);

    if (input !== keyword) {
        if (input !== null) showNotification('Onay kodu hatalı.', 'warning');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn._originalHtml = btn.innerHTML;
        btn.innerText = 'Boşaltılıyor...';
    }

    try {
        const res = await apiFetch('/api/admin/purge-raw', { method: 'POST' });
        showNotification(res.message || 'RAW bucket boşaltıldı.', 'success');
        // RAW sayacını anında sıfırla (temizlik bitti, dashboard anında 0 göstersin)
        if (AppState.statistics) {
            AppState.statistics.raw_usage_mb = 0;
            if (AppState.statistics.summary) AppState.statistics.summary.raw_storage_bytes = 0;
            if (typeof renderStatisticsUI === 'function') renderStatisticsUI();
            if (typeof renderR2StorageWidget === 'function') renderR2StorageWidget();
            updateNukeButtonVisibility();
        }
        if (typeof loadR2BucketList === 'function') loadR2BucketList();
        await loadStatistics();
        if (typeof renderR2StorageWidget === 'function') renderR2StorageWidget();
        updateNukeButtonVisibility();
    } catch (e) {
        showNotification(e.message || 'İşlem başarısız.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = btn._originalHtml;
        }
    }
}

// ─── GLOBAL EXPORTS (for HTML onclick attributes) ─────────────────────────────
Object.assign(window, {
    refreshData,
    unstickJobs,
    exportData,
    showStatsModal,
    closeModal,
    closeStatsModal,
    viewVideoDetails,
    viewErrorDetail,
    downloadVideo,
    deleteVideo,
    retryProcessing,
    moveVideoToFolder,
    goToPage,
    clearFilters,
    loadVideos,
    loadMonitoringData,
    renderMonitoringLogs,
    exportMonitoringLogsCsv,
    loadR2BucketList,
    loadUsers,
    showNewUserModal,
    closeNewUserModal,
    submitNewUser,
    toggleUserActive,
    toggleVideoSelection,
    promptChangePassword,
    r2Purge,
    cleanupR2Orphans,
    showUrlModal,
    closeUrlModal,
    submitUrlImport,
    copyVideoUrl,
    toggleTheme,
    purgeRawBucket,
    showNewFolderModal,
    bulkDeleteSelected,
    bulkRetrySelected,
    loadDeletedVideos,
    exportDeletedCsv,
    bulkRestoreSelected,
    bulkPurgeSelected,
    dismissAlertBanner,
    wakeServer,
});

// UPLOAD_01: Nuke tek handler purgeRawBucket (onclick); duplicate listener kaldırıldı
