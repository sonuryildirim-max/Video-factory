/**
 * D1 Database Repository
 * Handles all D1 database operations
 */

export class D1Repository {
    constructor(d1Database) {
        this.db = d1Database;
    }

    /**
     * Create or update link in D1
     */
    async createLink(linkData) {
        const { slug, url, created, createdBy, source, campaign, updatedAt } = linkData;
        await this.db.prepare(
            'INSERT OR REPLACE INTO links (slug, url, clicks, created, created_by, updated_at, source, campaign) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(slug, url, 0, created, createdBy, updatedAt || null, source || null, campaign || null).run();
    }

    /**
     * Update link clicks
     */
    async updateLinkClicks(slug) {
        await this.db.prepare('UPDATE links SET clicks = clicks + 1 WHERE slug = ?')
            .bind(slug).run();
    }

    /**
     * Get link by slug (single source of truth for redirect and stats)
     */
    async getLinkBySlug(slug) {
        const row = await this.db.prepare(
            'SELECT slug, url, clicks, created, created_by, updated_at, source, campaign FROM links WHERE slug = ?'
        ).bind(slug).first();
        if (!row) return null;
        return {
            slug: row.slug,
            url: row.url,
            clicks: row.clicks || 0,
            created: row.created,
            createdBy: row.created_by,
            updatedAt: row.updated_at,
            source: row.source,
            campaign: row.campaign
        };
    }

    /**
     * Get slug for URL hash (deduplication: same URL -> same slug)
     */
    async getUrlHashSlug(urlHash) {
        const row = await this.db.prepare(
            'SELECT slug FROM url_hash_cache WHERE url_hash = ?'
        ).bind(urlHash).first();
        return row ? row.slug : null;
    }

    /**
     * Save URL hash to slug mapping (for deduplication)
     */
    async saveUrlHashCache(urlHash, slug) {
        await this.db.prepare(
            'INSERT OR REPLACE INTO url_hash_cache (url_hash, slug, created_at) VALUES (?, ?, datetime("now"))'
        ).bind(urlHash, slug).run();
    }

    /**
     * Delete URL hash from cache (e.g. when link is overwritten)
     */
    async deleteUrlHashCache(urlHash) {
        await this.db.prepare('DELETE FROM url_hash_cache WHERE url_hash = ?')
            .bind(urlHash).run();
    }

    /**
     * Get links with filters
     */
    async getLinks(filters) {
        const { search, startDate, endDate, sort, page, limit } = filters;
        
        const whereClauses = [];
        const params = [];

        if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            whereClauses.push('created >= ?');
            params.push(startDate + 'T00:00:00');
        }
        if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            whereClauses.push('created <= ?');
            params.push(endDate + 'T23:59:59.999Z');
        }
        if (search) {
            whereClauses.push('(slug LIKE ? OR url LIKE ? OR source LIKE ? OR campaign LIKE ? OR created_by LIKE ?)');
            const searchLike = `%${search}%`;
            params.push(searchLike, searchLike, searchLike, searchLike, searchLike);
        }

        const whereSQL = whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : '';
        
        // Sorting
        let orderSQL = ' ORDER BY clicks DESC';
        if (sort === 'clicks-asc') orderSQL = ' ORDER BY clicks ASC';
        else if (sort === 'date-desc') orderSQL = ' ORDER BY created DESC';
        else if (sort === 'date-asc') orderSQL = ' ORDER BY created ASC';
        else if (sort === 'slug-asc') orderSQL = ' ORDER BY slug ASC';

        // Count
        const countResult = await this.db.prepare(`SELECT COUNT(*) as total FROM links${whereSQL}`)
            .bind(...params).first();
        
        const totalCount = countResult.total || 0;
        const totalPages = Math.ceil(totalCount / limit) || 1;
        const offset = (page - 1) * limit;

        // Data
        const dataResult = await this.db.prepare(
            `SELECT slug, url, clicks, created, created_by, updated_at, source, campaign FROM links${whereSQL}${orderSQL} LIMIT ? OFFSET ?`
        ).bind(...params, limit, offset).all();

        return {
            links: dataResult.results || [],
            totalCount,
            page,
            totalPages,
            limit
        };
    }

    /**
     * Write audit log
     */
    async writeLog(logData) {
        const { action, details, ip, ua, country, city, timestamp } = logData;
        try {
            await this.db.prepare(
                'INSERT INTO logs (action, details, ip, ua, country, city, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).bind(action, JSON.stringify(details), ip, ua, country || 'XX', city || 'Unknown', timestamp).run();
        } catch (e) {
            const { logger } = await import('../utils/logger.js');
            logger.error('Log DB Error', { message: e?.message });
            throw e;
        }
    }

    /**
     * Get logs with date range
     */
    async getLogs(filters) {
        const { startDate, endDate, limit = 2000 } = filters;
        
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            throw new Error('Invalid date format');
        }

        const results = await this.db.prepare(
            'SELECT id, action, details, ip, ua, country, city, timestamp FROM logs WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT ?'
        ).bind(startDate + 'T00:00:00', endDate + 'T23:59:59.999Z', limit).all();

        return (results.results || []).map(r => {
            let details = {};
            try {
                details = JSON.parse(r.details || '{}');
            } catch (e) {
                details = {};
            }
            return {
                id: r.id,
                action: r.action,
                timestamp: r.timestamp,
                ip: r.ip,
                country: r.country,
                city: r.city,
                userAgent: r.ua,
                details
            };
        });
    }

    /**
     * Get analytics data
     */
    async getAnalyticsData(dateRanges) {
        const { today, weekAgo, monthAgo, dayAgo } = dateRanges;
        
        const queries = await Promise.all([
            this.db.prepare("SELECT COUNT(*) as c FROM logs WHERE action='LINK_CLICKED' AND timestamp >= ?")
                .bind(today + 'T00:00:00').first(),
            this.db.prepare("SELECT COUNT(*) as c FROM logs WHERE action='LINK_CLICKED' AND timestamp >= ?")
                .bind(weekAgo + 'T00:00:00').first(),
            this.db.prepare("SELECT COUNT(*) as total, SUM(clicks) as totalClicks FROM links").first(),
            this.db.prepare("SELECT substr(timestamp,1,10) as date, COUNT(*) as count FROM logs WHERE action='LINK_CLICKED' AND timestamp >= ? GROUP BY substr(timestamp,1,10) ORDER BY date ASC")
                .bind(monthAgo + 'T00:00:00').all(),
            this.db.prepare("SELECT city as name, COUNT(*) as count FROM logs WHERE action='LINK_CLICKED' AND city IS NOT NULL AND city != 'Unknown' GROUP BY city ORDER BY count DESC LIMIT 8").all(),
            this.db.prepare("SELECT ua FROM logs WHERE action='LINK_CLICKED' AND ua IS NOT NULL ORDER BY id DESC LIMIT 500").all(),
            this.db.prepare("SELECT campaign as name, SUM(clicks) as count FROM links WHERE campaign IS NOT NULL AND campaign != '' GROUP BY campaign ORDER BY count DESC LIMIT 10").all(),
            this.db.prepare("SELECT CAST(substr(timestamp,12,2) AS INTEGER) as hour, COUNT(*) as count FROM logs WHERE action='LINK_CLICKED' AND timestamp >= ? GROUP BY hour ORDER BY hour ASC")
                .bind(monthAgo + 'T00:00:00').all(),
            this.db.prepare("SELECT source as name, SUM(clicks) as count FROM links WHERE source IS NOT NULL AND source != '' GROUP BY source ORDER BY count DESC LIMIT 10").all(),
            this.db.prepare("SELECT country as name, COUNT(*) as count FROM logs WHERE action='LINK_CLICKED' AND country IS NOT NULL GROUP BY country ORDER BY count DESC LIMIT 10").all(),
            this.db.prepare("SELECT slug, url, created, source, campaign FROM links WHERE clicks = 0 AND created <= ? ORDER BY created ASC LIMIT 20")
                .bind(weekAgo + 'T00:00:00').all(),
            this.db.prepare("SELECT json_extract(details,'$.slug') as slug, COUNT(*) as count FROM logs WHERE action='LINK_CLICKED' AND timestamp >= ? GROUP BY slug ORDER BY count DESC LIMIT 5")
                .bind(dayAgo + 'T00:00:00').all(),
            this.db.prepare("SELECT COUNT(*) as c FROM logs WHERE action='LINK_CLICKED' AND (ua LIKE '%bot%' OR ua LIKE '%crawler%' OR ua LIKE '%spider%' OR ua LIKE '%facebook%' OR ua LIKE '%twitter%' OR ua LIKE '%telegram%' OR ua LIKE '%whatsapp%')").first(),
            this.db.prepare("SELECT slug, url, created FROM links ORDER BY created DESC LIMIT 5").all()
        ]);

        // Parse device stats
        const deviceMap = { Mobile: 0, Desktop: 0, Tablet: 0, Bot: 0 };
        (queries[5].results || []).forEach(function (r) {
            const ua = (r.ua || "").toLowerCase();
            if (/bot|crawler|spider|slurp|facebook|twitter|telegram|whatsapp|instagram/i.test(ua)) deviceMap.Bot++;
            else if (/mobile|iphone|android(?!.*tablet)/i.test(ua)) deviceMap.Mobile++;
            else if (/ipad|tablet/i.test(ua)) deviceMap.Tablet++;
            else deviceMap.Desktop++;
        });
        const deviceStats = Object.keys(deviceMap)
            .filter(k => deviceMap[k] > 0)
            .map(k => ({ name: k, count: deviceMap[k] }))
            .sort((a, b) => b.count - a.count);

        // Fill missing dates in trend
        const trendMap = {};
        (queries[3].results || []).forEach(r => { trendMap[r.date] = r.count; });
        const dailyTrend = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
            dailyTrend.push({ date: d, count: trendMap[d] || 0 });
        }

        // Fill missing hours
        const hourMap = {};
        (queries[7].results || []).forEach(r => { hourMap[r.hour] = r.count; });
        const hourlyHeatmap = [];
        for (let h = 0; h < 24; h++) {
            hourlyHeatmap.push({ hour: h, count: hourMap[h] || 0 });
        }

        const topCampaign = (queries[6].results && queries[6].results.length > 0) ? queries[6].results[0].name : null;
        const botCount = deviceMap.Bot || 0;
        const humanCount = (queries[5].results || []).length - botCount;

        return {
            summary: {
                todayClicks: queries[0].c || 0,
                weekClicks: queries[1].c || 0,
                totalLinks: queries[2].total || 0,
                totalClicks: queries[2].totalClicks || 0,
                topCampaign
            },
            dailyTrend,
            cityClicks: queries[4].results || [],
            deviceStats,
            campaignStats: (queries[6].results || []).map(r => ({ name: r.name, count: r.count || 0 })),
            hourlyHeatmap,
            sourceStats: (queries[8].results || []).map(r => ({ name: r.name, count: r.count || 0 })),
            countryStats: (queries[9].results || []).map(r => ({ name: r.name, count: r.count || 0 })),
            deadLinks: (queries[10].results || []).map(r => ({
                slug: r.slug,
                url: r.url,
                created: r.created,
                source: r.source,
                campaign: r.campaign
            })),
            viralLinks: (queries[11].results || []).map(r => ({ slug: r.slug, count: r.count || 0 })),
            botTraffic: {
                bot: botCount,
                human: humanCount,
                total: (queries[5].results || []).length,
                botTotal: queries[12].c || 0
            },
            latestLinks: (queries[13].results || []).map(r => ({
                slug: r.slug,
                url: r.url,
                created: r.created
            }))
        };
    }

    /**
     * Cleanup old logs
     */
    async cleanupLogs(days) {
        await this.db.prepare("DELETE FROM logs WHERE timestamp < datetime('now', '-' || ? || ' days')")
            .bind(days).run();
    }
}
