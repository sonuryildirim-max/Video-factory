/**
 * Sidebar component — collapse toggle and persistence.
 * Usage: BK.Sidebar.toggleCollapse(), BK.Sidebar.applyCollapsed(), BK.Sidebar.updateToggleIcon(collapsed)
 */
(function (global) {
    function toggleCollapse() {
        const sidebar = document.getElementById('bkSidebar');
        if (!sidebar) return;
        const collapsed = sidebar.classList.toggle('collapsed');
        try { localStorage.setItem('bk_sidebar_collapsed', collapsed ? '1' : '0'); } catch (_) {}
        updateToggleIcon(collapsed);
    }

    function updateToggleIcon(collapsed) {
        const icon = document.getElementById('bkSidebarToggleIcon');
        if (icon) icon.setAttribute('href', collapsed ? '#i-chevron-right' : '#i-chevron-left');
    }

    function applyCollapsed() {
        const sidebar = document.getElementById('bkSidebar');
        if (!sidebar) return;
        const collapsed = (typeof localStorage !== 'undefined' && localStorage.getItem('bk_sidebar_collapsed') === '1');
        sidebar.classList.toggle('collapsed', collapsed);
        updateToggleIcon(collapsed);
    }

    global.BK = global.BK || {};
    global.BK.Sidebar = { toggleCollapse, updateToggleIcon, applyCollapsed };
})(typeof window !== 'undefined' ? window : this);
