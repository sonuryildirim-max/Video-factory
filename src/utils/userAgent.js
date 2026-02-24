/**
 * User-Agent Parsing Utilities
 */

import { SOCIAL_BOTS } from '../config/constants.js';

/**
 * Parse User-Agent string
 */
export function parseUserAgent(ua) {
    if (!ua) return { device: "unknown", browser: "unknown", os: "unknown" };
    
    let device = "Desktop";
    if (/Mobile|Android/i.test(ua)) device = "Mobile";
    else if (/Tablet|iPad/i.test(ua)) device = "Tablet";
    else if (/bot|spider|crawl/i.test(ua)) device = "Bot";
    
    let browser = "unknown";
    if (ua.indexOf("Firefox") > -1) browser = "Firefox";
    else if (ua.indexOf("Edg/") > -1) browser = "Edge";
    else if (ua.indexOf("Chrome") > -1) browser = "Chrome";
    else if (ua.indexOf("Safari") > -1) browser = "Safari";
    
    let os = "unknown";
    if (ua.indexOf("Windows") > -1) os = "Windows";
    else if (ua.indexOf("Mac OS") > -1) os = "macOS";
    else if (ua.indexOf("Linux") > -1) os = "Linux";
    else if (ua.indexOf("Android") > -1) os = "Android";
    else if (ua.indexOf("iPhone") > -1 || ua.indexOf("iPad") > -1) os = "iOS";
    
    return { device, browser, os };
}

/**
 * Check if User-Agent is a social media bot
 */
export function isSocialBot(userAgent) {
    if (!userAgent) return false;
    for (let i = 0; i < SOCIAL_BOTS.length; i++) {
        if (userAgent.indexOf(SOCIAL_BOTS[i]) !== -1) return true;
    }
    return false;
}
