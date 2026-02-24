/**
 * Cache Service
 * Handles OG tag caching and fetching
 */

import { logger } from '../utils/logger.js';

export class CacheService {
    constructor(kvRepo) {
        this.kvRepo = kvRepo;
    }

    /**
     * Fetch OG tags from target URL
     */
    async fetchOgTags(slug, targetUrl) {
        // Check cache first
        const cached = await this.kvRepo.getOgCache(slug);
        if (cached) return cached;

        try {
            const res = await fetch(targetUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (compatible; BilgeKargaBot/1.0)" },
                redirect: "follow",
                cf: { cacheTtl: 300 }
            });
            if (!res.ok) return null;

            const html = await res.text();
            const headEnd = html.indexOf("</head>");
            const head = html.substring(0, headEnd === -1 ? Math.min(html.length, 8000) : headEnd);

            const getMetaContent = function (propName) {
                const patterns = [
                    new RegExp('<meta[^>]*property=["\']' + propName + '["\'][^>]*content=["\']([^"\'>]*)["\']', 'i'),
                    new RegExp('<meta[^>]*content=["\']([^"\'>]*)["\'][^>]*property=["\']' + propName + '["\']', 'i')
                ];
                for (let p = 0; p < patterns.length; p++) {
                    const match = head.match(patterns[p]);
                    if (match && match[1]) return match[1].trim();
                }
                return null;
            };

            const titleMatch = head.match(/<title[^>]*>([^<]*)<\/title>/i);
            const pageTitle = titleMatch ? titleMatch[1].trim() : null;

            const og = {
                title: getMetaContent("og:title") || getMetaContent("twitter:title") || pageTitle || "",
                description: getMetaContent("og:description") || getMetaContent("twitter:description") || getMetaContent("description") || "",
                image: getMetaContent("og:image") || getMetaContent("twitter:image") || "",
                siteName: getMetaContent("og:site_name") || ""
            };

            // Cache for 24 hours
            if (og.title || og.image) {
                await this.kvRepo.cacheOgTags(slug, og, 86400);
            }

            return og;
        } catch (e) {
            logger.error('OG fetch error', { error: e?.message ?? String(e) });
            return null;
        }
    }

    /**
     * Build OG HTML for social media bots
     */
    buildOgHtml(og, targetUrl, slug) {
        const title = og.title || slug;
        const desc = og.description || targetUrl;
        let html = '<!DOCTYPE html><html><head>';
        html += '<meta charset="UTF-8">';
        html += '<meta property="og:type" content="website">';
        html += '<meta property="og:title" content="' + title.replace(/"/g, '&quot;') + '">';
        html += '<meta property="og:description" content="' + desc.replace(/"/g, '&quot;') + '">';
        html += '<meta property="og:url" content="' + targetUrl.replace(/"/g, '&quot;') + '">';
        if (og.image) {
            html += '<meta property="og:image" content="' + og.image.replace(/"/g, '&quot;') + '">';
            html += '<meta property="og:image:width" content="1200">';
            html += '<meta property="og:image:height" content="630">';
        }
        if (og.siteName) {
            html += '<meta property="og:site_name" content="' + og.siteName.replace(/"/g, '&quot;') + '">';
        }
        html += '<meta name="twitter:card" content="' + (og.image ? 'summary_large_image' : 'summary') + '">';
        html += '<meta name="twitter:title" content="' + title.replace(/"/g, '&quot;') + '">';
        html += '<meta name="twitter:description" content="' + desc.replace(/"/g, '&quot;') + '">';
        if (og.image) {
            html += '<meta name="twitter:image" content="' + og.image.replace(/"/g, '&quot;') + '">';
        }
        html += '<meta http-equiv="refresh" content="0;url=' + targetUrl.replace(/"/g, '&quot;') + '">';
        html += '<title>' + title.replace(/</g, '&lt;') + '</title>';
        html += '</head><body></body></html>';
        return html;
    }
}
