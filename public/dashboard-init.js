/**
 * Dashboard init — theme and auth-pending (no FOUC). Load before other dashboard scripts.
 */
(function () {
    var t = localStorage.getItem('bk_theme');
    if (!t) t = typeof window.matchMedia !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
})();

(function () {
    document.documentElement.classList.add('bk-auth-pending');
})();
