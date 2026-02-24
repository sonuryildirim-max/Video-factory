/**
 * Modal component — confirm dialog and overlay helpers.
 * Usage: BK.Modal.showConfirm(options), BK.Modal.closeAll()
 */
(function (global) {
    function closeAll() {
        document.querySelectorAll('.modal.open, .bk-confirm-overlay').forEach(function (el) {
            el.classList.remove('open');
            el.setAttribute('hidden', '');
        });
    }

    function showConfirm(options) {
        var title = options.title || 'Onay';
        var body = options.body || '';
        var confirmText = options.confirmText || 'Onayla';
        var cancelText = options.cancelText || 'İptal';
        var danger = options.danger === true;
        var onConfirm = typeof options.onConfirm === 'function' ? options.onConfirm : function () {};
        var onCancel = typeof options.onCancel === 'function' ? options.onCancel : function () {};
        var existing = document.getElementById('bk-confirm-root');
        if (existing) existing.remove();
        var root = document.createElement('div');
        root.id = 'bk-confirm-root';
        root.className = 'bk-confirm-overlay';
        root.innerHTML = '<div class="bk-confirm-box">' +
            '<div class="bk-confirm-icon" aria-hidden="true">' + (danger ? '⚠️' : '') + '</div>' +
            '<div class="bk-confirm-title">' + title + '</div>' +
            '<div class="bk-confirm-body">' + body + '</div>' +
            '<div class="bk-confirm-actions">' +
            '<button type="button" class="bk-confirm-cancel">' + cancelText + '</button>' +
            '<button type="button" class="bk-confirm-danger">' + confirmText + '</button>' +
            '</div></div>';
        var cancelBtn = root.querySelector('.bk-confirm-cancel');
        var confirmBtn = root.querySelector('.bk-confirm-danger');
        if (!danger) confirmBtn.className = 'bk-confirm-danger'; else confirmBtn.classList.add('danger');
        cancelBtn.addEventListener('click', function () { closeAll(); onCancel(); });
        confirmBtn.addEventListener('click', function () { closeAll(); onConfirm(); });
        root.addEventListener('click', function (e) { if (e.target === root) { closeAll(); onCancel(); } });
        document.body.appendChild(root);
    }

    global.BK = global.BK || {};
    global.BK.Modal = { showConfirm, closeAll };
})(typeof window !== 'undefined' ? window : this);
