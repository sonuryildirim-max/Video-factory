/**
 * VideoGrid component — table skeleton and error state rendering.
 * Usage: BK.VideoGrid.renderSkeleton(), BK.VideoGrid.renderError(message)
 */
(function (global) {
    function getTableBody() {
        return document.getElementById('videosTableBody');
    }

    function renderSkeleton(icons) {
        const body = getTableBody();
        if (!body) return;
        body.innerHTML = Array.from({ length: 5 }, function () {
            return '<tr class="bk-skeleton-row" aria-hidden="true"><td colspan="11"><div class="bk-skeleton" style="height:24px;border-radius:4px"></div></td></tr>';
        }).join('');
    }

    function renderError(message, escapeFn, icons) {
        const body = getTableBody();
        if (!body) return;
        var safeMsg = typeof escapeFn === 'function' ? escapeFn(message) : message;
        var alertIcon = (icons && icons.alert) ? icons.alert : '';
        body.innerHTML = '<tr><td colspan="11"><div class="bk-error-state" role="alert">' +
            '<div class="bk-error-state-icon" style="color:#a1a1aa">' + alertIcon + '</div>' +
            '<div class="bk-error-state-title">Videolar yüklenemedi</div>' +
            '<div style="color:#71717a;font-size:.85rem;">' + safeMsg + '</div>' +
            '<button class="bk-error-retry" onclick="loadVideos()">Tekrar Dene</button></div></td></tr>';
        var pagination = document.getElementById('pagination');
        if (pagination) pagination.innerHTML = '';
    }

    global.BK = global.BK || {};
    global.BK.VideoGrid = { getTableBody, renderSkeleton, renderError };
})(typeof window !== 'undefined' ? window : this);
