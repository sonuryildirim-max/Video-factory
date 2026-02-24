/**
 * URL Manipulation Utilities
 */

import { TRACKING_PARAMS } from '../config/constants.js';

/**
 * Clean tracking parameters from URL
 */
export function cleanTrackingParams(urlStr) {
    try {
        const url = new URL(urlStr);
        TRACKING_PARAMS.forEach(function (param) {
            url.searchParams.delete(param);
        });
        return url.toString();
    } catch (e) {
        return urlStr;
    }
}

/**
 * Add UTM parameters to URL
 */
export function addUtmParams(urlStr, campaign, source) {
    try {
        const url = new URL(urlStr);
        if (campaign) url.searchParams.set("utm_campaign", campaign);
        if (source) url.searchParams.set("utm_source", source);
        const d = new Date();
        const dateStr = d.getFullYear().toString() +
            (d.getMonth() + 1).toString().padStart(2, "0") +
            d.getDate().toString().padStart(2, "0");
        url.searchParams.set("utm_content", dateStr);
        return url.toString();
    } catch (e) {
        return urlStr;
    }
}
