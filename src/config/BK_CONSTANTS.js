/**
 * Centralized job/status and other magic strings — single source of truth for API/DB values.
 * Use these instead of string literals so renames and new statuses are consistent.
 */

/** Job lifecycle statuses (stored in DB and returned by API) */
export const JOB_STATUS = {
    PENDING: 'PENDING',
    URL_IMPORT_QUEUED: 'URL_IMPORT_QUEUED',
    PROCESSING: 'PROCESSING',
    DOWNLOADING: 'DOWNLOADING',
    CONVERTING: 'CONVERTING',
    UPLOADING: 'UPLOADING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    INTERRUPTED: 'INTERRUPTED',
    DELETING: 'DELETING',
    DELETED: 'DELETED',
};

/** Statuses that mean "work in progress" (agent is running) — used for deny-delete and metrics */
export const PROCESSING_STATUSES = [
    JOB_STATUS.PROCESSING,
    JOB_STATUS.DOWNLOADING,
    JOB_STATUS.CONVERTING,
    JOB_STATUS.UPLOADING,
];

/** Statuses that are considered "queued" (not yet picked by worker) */
export const QUEUED_STATUSES = [
    JOB_STATUS.PENDING,
    JOB_STATUS.URL_IMPORT_QUEUED,
];
