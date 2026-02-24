-- 013: Atomic hierarchy & activity heartbeat v8
-- last_activity: worker activity (claim/complete/heartbeat)
-- last_login: user last login timestamp

-- worker_heartbeats: add last_activity for activity = heartbeat semantics
-- (We use last_heartbeat as last_activity - no schema change needed; claim/complete will call updateWorkerHeartbeat)
-- No change to worker_heartbeats - we update last_heartbeat on all activities.

-- users: add last_login for login tracking
ALTER TABLE users ADD COLUMN last_login TEXT;
