/**
 * Structured JSON logger — replaces console.log/warn/error with {"level","msg","timestamp",...}
 * Output one JSON object per line for log aggregation.
 */

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

function formatEntry(level, msg, data) {
    const entry = {
        level,
        msg: typeof msg === 'string' ? msg : String(msg),
        timestamp: new Date().toISOString(),
    };
    if (data != null && typeof data === 'object' && !Array.isArray(data)) {
        Object.assign(entry, data);
    } else if (data != null) {
        entry.data = data;
    }
    return JSON.stringify(entry);
}

function write(level, msg, data) {
    const line = formatEntry(level, msg, data);
    if (level === 'ERROR') {
        console.error(line);
    } else if (level === 'WARN') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

export const logger = {
    debug(msg, data) {
        write('DEBUG', msg, data);
    },
    info(msg, data) {
        write('INFO', msg, data);
    },
    warn(msg, data) {
        write('WARN', msg, data);
    },
    error(msg, data) {
        write('ERROR', msg, data);
    },
};
