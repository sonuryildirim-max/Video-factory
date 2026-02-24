/**
 * Navbar component — top bar and overflow menu behavior.
 * Exposes helpers for nav overflow open/close.
 */
(function (global) {
    function initOverflow() {
        const btn = document.getElementById('navOverflowBtn');
        const dropdown = document.getElementById('navOverflowDropdown');
        if (!btn || !dropdown) return;
        btn.addEventListener('click', function () {
            const open = dropdown.hidden;
            dropdown.hidden = !open;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        document.addEventListener('click', function (e) {
            if (dropdown && !dropdown.hidden && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    global.BK = global.BK || {};
    global.BK.Navbar = { initOverflow };
})(typeof window !== 'undefined' ? window : this);
