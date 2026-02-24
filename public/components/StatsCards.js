/**
 * StatsCards component — dashboard and library stat cards rendering.
 * Usage: BK.StatsCards.update(summary, els)
 */
(function (global) {
    function setTrendEl(el, value, text) {
        if (!el) return;
        el.textContent = text || '—';
        el.classList.remove('trend-up', 'trend-down', 'trend-neutral');
        if (value > 0) el.classList.add('trend-up');
        else if (value < 0) el.classList.add('trend-down');
        else el.classList.add('trend-neutral');
    }

    function update(summary, els) {
        if (!summary || !els) return;
        const total = summary.total_videos ?? 0;
        const completed = summary.completed ?? 0;
        const processing = summary.processing ?? 0;
        if (els.totalVideos) els.totalVideos.textContent = String(total);
        if (els.libraryVideoCountBadge) els.libraryVideoCountBadge.textContent = total + ' Video';
        const dash1 = document.getElementById('totalVideosDash');
        const dash2 = document.getElementById('completedVideosDash');
        const dash3 = document.getElementById('processingVideosDash');
        if (dash1) dash1.textContent = String(total);
        if (dash2) dash2.textContent = String(completed);
        if (dash3) dash3.textContent = String(processing);
        if (els.completedVideos) els.completedVideos.textContent = String(completed);
        if (els.processingVideos) els.processingVideos.textContent = String(processing);
        const pubBytes = summary.public_storage_bytes ?? summary.total_storage_bytes ?? 0;
        const pubStr = pubBytes > 0 ? (pubBytes / 1_073_741_824).toFixed(1) + ' GB' : '0 GB';
        if (els.storageGb) els.storageGb.textContent = pubStr;
        const dash4 = document.getElementById('storageGbDash');
        if (dash4) dash4.textContent = pubStr;
        const savingsBytes = summary.total_savings_bytes ?? 0;
        if (els.totalSavingsGb) els.totalSavingsGb.textContent = savingsBytes > 0
            ? (savingsBytes / 1_073_741_824).toFixed(1) + ' GB' : '0 GB';
        if (els.storageTrend) {
            els.storageTrend.textContent = 'Public depo';
            els.storageTrend.classList.remove('trend-up', 'trend-down');
            els.storageTrend.classList.add('trend-neutral');
        }
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        const weeklyGrowth = total > 0 ? Math.round(((summary.last_week_total ?? 0) / total) * 100) : 0;
        setTrendEl(els.videoTrend, weeklyGrowth, '+' + weeklyGrowth + '%');
        setTrendEl(els.completedTrend, completionRate, completionRate + '%');
        setTrendEl(els.processingTrend, processing === 0 ? 0 : 1, processing === 0 ? '0' : processing + ' aktif');
    }

    global.BK = global.BK || {};
    global.BK.StatsCards = { update, setTrendEl };
})(typeof window !== 'undefined' ? window : this);
