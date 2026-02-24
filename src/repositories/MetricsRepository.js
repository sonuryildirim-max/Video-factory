/**
 * Metrics repository — persist encode duration, R2 transfer size, queue depth for observability.
 */

export class MetricsRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * Insert a metric row.
     * @param {Object} params - { metric_type, job_id?, value, extra? }
     */
    async insert(params) {
        if (!this.db) return;
        const { metric_type, job_id = null, value, extra = null } = params;
        await this.db.prepare(
            'INSERT INTO metrics (metric_type, job_id, value, extra) VALUES (?, ?, ?, ?)'
        ).bind(metric_type, job_id, value, extra ?? null).run();
    }
}
