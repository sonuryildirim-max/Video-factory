/**
 * Upload flow — BK Video Factory
 * Presigned URL, direct upload, confirm, URL import (async + sync)
 */

import { AwsClient } from 'aws4fetch';
import { VIDEO_CONSTANTS, CONFIG } from '../config/config.js';
import { JOB_STATUS } from '../config/BK_CONSTANTS.js';
import { JobRepository } from '../repositories/JobRepository.js';
import { UploadTokenRepository } from '../repositories/UploadTokenRepository.js';
import { validateR2Key, sanitizeFilename } from '../utils/videoValidation.js';
import { AppError, NotFoundError, ValidationError, PayloadTooLargeError, BK_ERROR_CODES } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const RAW_BUCKET = 'R2_RAW_UPLOADS_BUCKET';

export class UploadService {
    constructor(env, jobRepo, uploadTokenRepo) {
        this.env = env;
        this.jobRepo = jobRepo;
        this.uploadTokenRepo = uploadTokenRepo;
    }

    async generatePresignedUrl(params, userId) {
        const { fileName, fileSize, quality, processingProfile, tags, projectName, notes, displayName, folderId } = params;
        if (fileSize > VIDEO_CONSTANTS.MAX_FILE_SIZE_BYTES) {
            const err = new ValidationError(`File exceeds 5 GB limit (got ${fileSize} bytes)`, [
                { field: 'fileSize', error: 'Must be ≤ 5 GB', error_code: BK_ERROR_CODES.FILE_TOO_LARGE },
            ]);
            err.errorCode = BK_ERROR_CODES.FILE_TOO_LARGE;
            throw err;
        }
        const ALLOWED_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
        const ext = (fileName.includes('.') ? fileName.split('.').pop() : '').toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) {
            const err = new ValidationError(`Invalid file type: .${ext}`, [
                { field: 'fileName', error: `Allowed: ${ALLOWED_EXT.join(', ')}`, error_code: BK_ERROR_CODES.INVALID_FILE_TYPE },
            ]);
            err.errorCode = BK_ERROR_CODES.INVALID_FILE_TYPE;
            throw err;
        }
        let originalName = fileName;
        if (displayName && typeof displayName === 'string' && displayName.trim()) {
            const trimmed = displayName.trim();
            const hasExt = ALLOWED_EXT.some(e => trimmed.toLowerCase().endsWith('.' + e));
            originalName = hasExt ? trimmed : `${trimmed}.${ext}`;
        }
        const cleanName = sanitizeFilename(originalName);
        const timestamp = Date.now();
        const r2RawKey = `raw-uploads/${timestamp}-${cleanName}`;
        const job = await this.jobRepo.create({
            original_name: originalName,
            clean_name: cleanName,
            r2_raw_key: r2RawKey,
            quality: quality || '720p',
            file_size_input: fileSize,
            processing_profile: processingProfile || '12',
            uploaded_by: userId,
            tags: tags || '',
            project_name: projectName || '',
            notes: notes || '',
            folder_id: folderId || null,
        });
        const uploadToken = crypto.randomUUID();
        if (this.uploadTokenRepo) {
            await this.uploadTokenRepo.save(uploadToken, job.id, {
                r2RawKey,
                fileName,
                cleanName,
                fileSize,
                quality: quality || '720p',
                userId,
            }, 900);
        }
        const presignedUrl = await this._getR2PresignedUrl(r2RawKey, fileSize, uploadToken);
        return {
            jobId: job.id,
            uploadUrl: presignedUrl,
            uploadToken,
            cleanName,
            r2Key: r2RawKey,
            expiresIn: 900,
        };
    }

    async _getR2PresignedUrl(r2Key, fileSize, directUploadToken) {
        const accountId = this.env.R2_ACCOUNT_ID;
        const accessKeyId = this.env.R2_ACCESS_KEY_ID;
        const secretKey = this.env.R2_SECRET_ACCESS_KEY;
        const bucketName = this.env.R2_RAW_BUCKET_NAME || 'bk-video-raw';
        if (accountId && accessKeyId && secretKey) {
            try {
                const client = new AwsClient({ accessKeyId, secretAccessKey: secretKey, region: 'auto', service: 's3' });
                const expiresIn = 900;
                const url = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${r2Key}?X-Amz-Expires=${expiresIn}`;
                const signed = await client.sign(new Request(url, { method: 'PUT' }), { aws: { signQuery: true } });
                return signed.url;
            } catch (r2Err) {
                logger.error('R2 presigned URL failed', { message: r2Err?.message || String(r2Err) });
            }
        } else {
            logger.error('R2 API tokens not configured; falling back to direct proxy');
        }
        if (fileSize > VIDEO_CONSTANTS.MAX_DIRECT_UPLOAD_BYTES) {
            throw new PayloadTooLargeError('Dosya 100MB üzeri. R2 API anahtarlarınızı kontrol edin. Presigned URL kullanılmadan bu boyutta yükleme yapılamaz.');
        }
        if (!directUploadToken || !this.uploadTokenRepo) {
            const err = new AppError('Presigned URL failed; direct-upload fallback requires D1 upload_tokens', 503, 'R2_CONFIG');
            err.errorCode = BK_ERROR_CODES.R2_BUCKET_NOT_FOUND;
            throw err;
        }
        const workerUrl = this.env.WORKER_URL || CONFIG.WORKER_URL;
        return `${workerUrl}/api/videos/upload/direct/${directUploadToken}`;
    }

    async handleDirectUploadComplete(token, request) {
        const tokenData = this.uploadTokenRepo ? await this.uploadTokenRepo.get(token) : null;
        if (!tokenData) {
            const err = new ValidationError('Invalid or expired upload token');
            err.errorCode = BK_ERROR_CODES.UPLOAD_TOKEN_INVALID;
            throw err;
        }
        const { cleanName, fileSize } = tokenData.payload;
        const jobId = tokenData.jobId;
        const body = await request.json().catch(() => ({}));
        const { upload_successful, actual_file_size } = body;
        if (!upload_successful) {
            const err = new ValidationError('Client reported upload failure');
            err.errorCode = BK_ERROR_CODES.UPLOAD_NOT_CONFIRMED;
            throw err;
        }
        const r2RawKey = tokenData.payload.r2RawKey;
        const bucket = this.env[RAW_BUCKET];
        let actualSize = 0;
        if (r2RawKey && bucket) {
            const obj = await bucket.head(r2RawKey);
            if (!obj) {
                const err = new ValidationError('Dosya R2\'de bulunamadi. Yuklemeyi tekrar deneyin.');
                err.errorCode = BK_ERROR_CODES.UPLOAD_NOT_CONFIRMED;
                throw err;
            }
            actualSize = obj.size ?? 0;
        }
        const clientSize = parseInt(actual_file_size || fileSize || '0', 10) || 0;
        if (actualSize > 0 && clientSize > 0) {
            const ratio = actualSize / clientSize;
            if (ratio < 0.95 || ratio > 1.05) {
                const err = new ValidationError(`Dosya boyutu R2 ile uyuşmuyor. R2: ${actualSize} byte, bildirilen: ${clientSize} byte`);
                err.errorCode = BK_ERROR_CODES.UPLOAD_NOT_CONFIRMED;
                throw err;
            }
        }
        const job = await this.jobRepo.getById(jobId);
        if (!job) throw new NotFoundError('Job', jobId);
        if (this.uploadTokenRepo) await this.uploadTokenRepo.delete(token);
        if (actualSize > 0) await this.jobRepo.updateJobFileSizeInput(jobId, actualSize);
        await this.jobRepo.setUploadConfirmed(jobId);
        logger.info('Upload confirmed', { jobId, cleanName, actualSize });
        return {
            success: true,
            job_id: jobId,
            clean_name: cleanName,
            normalized_name: cleanName,
            status: 'uploaded',
            transcode: { status: 'in_progress' },
            uri: `/api/videos/${jobId}`,
            message: 'Upload confirmed. Job queued for Hetner processing.',
            next_step: 'Poll GET /api/videos/' + jobId + ' until transcode.status === "complete"',
            uploaded_by: tokenData.payload.userId,
            actual_file_size: actualSize || actual_file_size || fileSize,
        };
    }

    async handleDirectUpload(request, token) {
        const tokenData = this.uploadTokenRepo ? await this.uploadTokenRepo.get(token) : null;
        if (!tokenData) {
            const err = new ValidationError('Invalid or expired upload token');
            err.errorCode = BK_ERROR_CODES.UPLOAD_TOKEN_INVALID;
            throw err;
        }
        const { r2RawKey, fileSize } = tokenData.payload;
        const contentLength = parseInt(request.headers.get('content-length') || '0');
        if (contentLength > VIDEO_CONSTANTS.MAX_DIRECT_UPLOAD_BYTES) {
            throw new PayloadTooLargeError('File too large for direct upload; use presigned URL (R2 API tokens required)');
        }
        if (contentLength > fileSize * 1.1) throw new PayloadTooLargeError('File larger than declared size');
        try {
            const bucket = this.env[RAW_BUCKET];
            if (!bucket) {
                const err = new AppError('R2 raw-uploads bucket not configured', 503, 'R2_CONFIG');
                err.errorCode = BK_ERROR_CODES.R2_BUCKET_NOT_FOUND;
                throw err;
            }
            const obj = await bucket.put(r2RawKey, request.body, {
                httpMetadata: { contentType: request.headers.get('content-type') || 'video/mp4' },
                customMetadata: { uploadMethod: 'direct-proxy', originalSize: String(contentLength) },
            });
            return new Response(JSON.stringify({ success: true, key: r2RawKey, size: obj.size }), {
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        } catch (error) {
            if (error instanceof ValidationError || error instanceof PayloadTooLargeError || error instanceof NotFoundError) throw error;
            logger.error('Direct upload R2 put failed', { message: error?.message });
            throw error;
        }
    }

    /**
     * Multipart POST /api/upload: one file + folder_id per request.
     * Creates job with folder_id, uploads file to R2, sets upload_confirmed_at.
     * @param {Request} request - multipart/form-data with 'file' and 'folder_id'
     * @param {string} userId - authenticated user
     * @returns {Promise<{ job_id: number, clean_name: string }>}
     */
    async handleMultipartUpload(request, userId) {
        const contentType = request.headers.get('Content-Type') || '';
        if (!contentType.includes('multipart/form-data')) {
            throw new ValidationError('Content-Type must be multipart/form-data');
        }
        const formData = await request.formData();
        const file = formData.get('file') || formData.get('video');
        if (!file || typeof file.stream !== 'function') {
            throw new ValidationError('Missing or invalid file field (use "file" or "video")');
        }
        const rawFolderId = formData.get('folder_id');
        const folderId = rawFolderId === '' || rawFolderId === null || rawFolderId === undefined
            ? null
            : (parseInt(String(rawFolderId).trim(), 10) || null);
        if (folderId !== null && (folderId < 0 || !Number.isInteger(folderId))) {
            throw new ValidationError('folder_id must be a non-negative integer or empty');
        }

        const fileName = file.name || 'video.mp4';
        const fileSize = file.size ?? 0;
        if (fileSize <= 0) throw new ValidationError('File size must be positive');
        if (fileSize > VIDEO_CONSTANTS.MAX_DIRECT_UPLOAD_BYTES) {
            throw new PayloadTooLargeError('File too large for multipart upload; use presigned URL for files over 100 MB');
        }

        const ALLOWED_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
        const ext = (fileName.includes('.') ? fileName.split('.').pop() : '').toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) {
            throw new ValidationError(`Invalid file type: .${ext}. Allowed: ${ALLOWED_EXT.join(', ')}`, [
                { field: 'file', error: `Allowed: ${ALLOWED_EXT.join(', ')}`, error_code: BK_ERROR_CODES.INVALID_FILE_TYPE },
            ]);
        }

        const cleanName = sanitizeFilename(fileName);
        const timestamp = Date.now();
        const r2RawKey = `raw-uploads/${timestamp}-${cleanName}`;

        const job = await this.jobRepo.create({
            original_name: fileName,
            clean_name: cleanName,
            r2_raw_key: r2RawKey,
            quality: '720p',
            file_size_input: fileSize,
            processing_profile: '12',
            uploaded_by: userId,
            tags: '',
            project_name: '',
            notes: '',
            folder_id: folderId,
        });

        const bucket = this.env[RAW_BUCKET];
        if (!bucket) {
            throw new AppError('R2 raw-uploads bucket not configured', 503, 'R2_CONFIG');
        }
        const body = file.stream();
        await bucket.put(r2RawKey, body, {
            httpMetadata: { contentType: file.type || 'video/mp4' },
            customMetadata: { uploadMethod: 'multipart', originalSize: String(fileSize) },
        });

        await this.jobRepo.updateJobFileSizeInput(job.id, fileSize);
        await this.jobRepo.setUploadConfirmed(job.id);

        logger.info('Multipart upload completed', { jobId: job.id, cleanName, folder_id: folderId });
        return {
            job_id: job.id,
            clean_name: cleanName,
            normalized_name: cleanName,
            status: 'uploaded',
            uri: `/api/videos/${job.id}`,
            folder_id: folderId,
        };
    }

    _validateUrlForImport(url) {
        try {
            const u = new URL(url);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ValidationError('URL must use http or https');
            const host = (u.hostname || '').toLowerCase().trim();
            if (!host) throw new ValidationError('Invalid URL host');
            if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]') throw new ValidationError('URL cannot target localhost');
            const metadataHosts = ['169.254.169.254', 'metadata.google.internal', 'metadata.google.com', 'metadata'];
            if (metadataHosts.some(h => host === h || host.endsWith('.' + h))) throw new ValidationError('URL cannot target cloud metadata service');
            if (host === '169.254.169.254') throw new ValidationError('URL cannot target cloud metadata (169.254.169.254)');
            if (host.startsWith('[fe80:') || host.startsWith('fe80:') || host.startsWith('[fd') || host.startsWith('fd')) {
                throw new ValidationError('URL cannot target IPv6 link-local or ULA');
            }
            const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
            const m = host.match(ipv4);
            if (m) {
                const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
                const c = parseInt(m[3], 10);
                const d = parseInt(m[4], 10);
                if ([a, b, c, d].some(n => n < 0 || n > 255)) return;
                if (a === 127) throw new ValidationError('URL cannot target loopback (127.x.x.x)');
                if (a === 10) throw new ValidationError('URL cannot target private network (10.x.x.x)');
                if (a === 192 && b === 168) throw new ValidationError('URL cannot target private network (192.168.x.x)');
                if (a === 172 && b >= 16 && b <= 31) throw new ValidationError('URL cannot target private network (172.16-31.x.x)');
                if (a === 169 && b === 254) throw new ValidationError('URL cannot target link-local (169.254.x.x)');
            }
        } catch (e) {
            if (e instanceof ValidationError) throw e;
            throw new ValidationError('Invalid URL for import');
        }
    }

    _resolveDownloadUrl(rawUrl) {
        try {
            const u = new URL(rawUrl);
            const gd = u.pathname.match(/\/file\/d\/([^/]+)/);
            if (gd) return `https://drive.google.com/uc?export=download&confirm=t&id=${gd[1]}`;
            if (u.hostname.includes('dropbox.com')) {
                u.searchParams.set('dl', '1');
                const host = u.hostname === 'www.dropbox.com' ? 'dl.dropboxusercontent.com' : u.hostname;
                return `${u.protocol}//${host}${u.pathname}${u.search}`;
            }
            return rawUrl;
        } catch {
            return rawUrl;
        }
    }

    /** Drive klasör linki mi? Örn: https://drive.google.com/drive/folders/FOLDER_ID */
    isDriveFolderUrl(url) {
        try {
            const u = new URL(url);
            if (!u.hostname.includes('drive.google.com')) return null;
            const m = u.pathname.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/);
            return m ? { folderId: m[1] } : null;
        } catch {
            return null;
        }
    }

    /** Google Drive API ile klasördeki video dosyalarını listele (public klasör, API key gerekir). */
    async _listDriveFolderVideoFiles(folderId, apiKey) {
        const q = `'${folderId}' in parents`;
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&key=${apiKey}&fields=files(id,name,mimeType)&pageSize=500`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new ValidationError(`Drive API list failed: ${res.status}${errText ? ` ${errText.slice(0, 200)}` : ''}`);
        }
        const data = await res.json().catch(() => ({}));
        const files = Array.isArray(data.files) ? data.files : [];
        return files.filter(f => f.id && f.name && (f.mimeType && f.mimeType.startsWith('video/')));
    }

    /** Klasördeki tüm videolar için tek tek URL_IMPORT_QUEUED job oluştur; agent indirir. */
    async importFromDriveFolder(params, userId) {
        const { folderUrl, quality, tags, projectName, notes, folderId: targetFolderId } = params;
        const apiKey = this.env?.GOOGLE_DRIVE_API_KEY;
        if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
            throw new ValidationError('Google Drive klasör importu için GOOGLE_DRIVE_API_KEY tanımlanmalı.');
        }
        const info = this.isDriveFolderUrl(folderUrl);
        if (!info) throw new ValidationError('Geçerli bir Google Drive klasör linki girin (drive.google.com/drive/folders/…).');
        const MAX_FOLDER_VIDEOS = 100;

        let files;
        const agentWakeUrl = (this.env?.AGENT_WAKE_URL || '').toString().trim();
        const bearerToken = (this.env?.BK_BEARER_TOKEN || '').toString().trim();
        if (agentWakeUrl && bearerToken) {
            try {
                const baseUrl = agentWakeUrl.replace(/\/wakeup\/?$/i, '');
                const driveListUrl = `${baseUrl.replace(/\/$/, '')}/drive-list`;
                const res = await fetch(driveListUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${bearerToken}`,
                    },
                    body: JSON.stringify({ folder_id: info.folderId }),
                });
                if (!res.ok) {
                    const errBody = await res.text().catch(() => '');
                    throw new ValidationError(`Agent drive-list: ${res.status}${errBody ? ` ${errBody.slice(0, 200)}` : ''}`);
                }
                const data = await res.json().catch(() => ({}));
                files = Array.isArray(data.files) ? data.files : [];
            } catch (e) {
                if (e instanceof ValidationError) throw e;
                throw new ValidationError(`Agent drive-list hatası: ${e?.message || String(e)}`);
            }
        } else {
            files = await this._listDriveFolderVideoFiles(info.folderId, apiKey.trim());
        }

        if (files.length === 0) throw new ValidationError('Klasörde video dosyası bulunamadı.');
        if (files.length > MAX_FOLDER_VIDEOS) {
            throw new ValidationError(`En fazla ${MAX_FOLDER_VIDEOS} video eklenebilir; klasörde ${files.length} video var.`);
        }
        const jobs = [];
        const ALLOWED_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
        for (const file of files) {
            const originalName = file.name && /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name) ? file.name : `${file.name || 'video'}.mp4`;
            const cleanName = sanitizeFilename(originalName);
            const sourceUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${file.id}`;
            const job = await this.jobRepo.create({
                original_name: originalName,
                clean_name: cleanName,
                r2_raw_key: 'url-import-pending',
                quality: quality || '720p',
                file_size_input: 0,
                uploaded_by: userId,
                tags: tags || '',
                project_name: projectName || '',
                notes: notes || `Drive klasör: ${folderUrl}`,
                source_url: sourceUrl,
                folder_id: targetFolderId || null,
                status: JOB_STATUS.URL_IMPORT_QUEUED,
            });
            jobs.push({ job_id: job.id, clean_name: cleanName });
            logger.info('Drive folder import job created', { jobId: job.id, cleanName, fileId: file.id });
        }
        return {
            success: true,
            job_id: jobs[0]?.job_id,
            job_count: jobs.length,
            jobs,
            clean_name: jobs.length === 1 ? jobs[0].clean_name : undefined,
            message: `${jobs.length} video kuyruğa alındı. Agent sırayla indirip işleyecek.`,
        };
    }

    _filenameFromUrl(rawUrl) {
        try {
            const pathname = new URL(rawUrl).pathname;
            const part = pathname.split('/').filter(Boolean).pop() || '';
            const name = decodeURIComponent(part).replace(/[?#].*/, '');
            return /\.(mp4|mov|avi|mkv|webm)$/i.test(name) ? name : `url-import-${Date.now()}.mp4`;
        } catch {
            return `url-import-${Date.now()}.mp4`;
        }
    }

    async importFromUrl(params, userId) {
        const { url, quality, tags, projectName, notes, displayName, folderId } = params;
        this._validateUrlForImport(url);
        const downloadUrl = this._resolveDownloadUrl(url);
        const fileName = this._filenameFromUrl(url);
        const ALLOWED_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
        const ext = (fileName.includes('.') ? fileName.split('.').pop() : 'mp4').toLowerCase();
        let originalName = fileName;
        if (displayName && typeof displayName === 'string' && displayName.trim()) {
            const trimmed = displayName.trim();
            const hasExt = ALLOWED_EXT.some(e => trimmed.toLowerCase().endsWith('.' + e));
            originalName = hasExt ? trimmed : `${trimmed}.${ext}`;
        }
        const cleanName = sanitizeFilename(originalName);
        const job = await this.jobRepo.create({
            original_name: originalName,
            clean_name: cleanName,
            r2_raw_key: 'url-import-pending',
            quality: quality || '720p',
            file_size_input: 0,
            uploaded_by: userId,
            tags: tags || '',
            project_name: projectName || '',
            notes: notes || `Source: ${url}`,
            source_url: downloadUrl,
            folder_id: folderId || null,
            status: JOB_STATUS.URL_IMPORT_QUEUED,
        });
        logger.info('URL import job created', { jobId: job.id, cleanName });
        return { success: true, job_id: job.id, clean_name: cleanName, status: JOB_STATUS.URL_IMPORT_QUEUED, uri: `/api/videos/${job.id}`, message: 'URL import queued. Agent will download and process.' };
    }

    async importFromUrlSync(params, userId, env) {
        const { url, quality, processingProfile, tags, projectName, notes, displayName, folderId } = params;
        this._validateUrlForImport(url);
        const downloadUrl = this._resolveDownloadUrl(url);
        const fileName = this._filenameFromUrl(url);
        const ALLOWED_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm'];
        const ext = (fileName.includes('.') ? fileName.split('.').pop() : 'mp4').toLowerCase();
        let originalName = fileName;
        if (displayName && typeof displayName === 'string' && displayName.trim()) {
            const trimmed = displayName.trim();
            const hasExt = ALLOWED_EXT.some(e => trimmed.toLowerCase().endsWith('.' + e));
            originalName = hasExt ? trimmed : `${trimmed}.${ext}`;
        }
        const cleanName = sanitizeFilename(originalName);
        const r2RawKey = `raw-uploads/${Date.now()}-${cleanName}`;

        // #region agent log
        const isGDrive = downloadUrl.includes('drive.google.com');
        fetch('http://127.0.0.1:7244/ingest/6e5419c3-da58-4eff-91a7-eca90285816f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'UploadService.js:importFromUrlSync', message: 'resolved download URL', data: { isGDrive, downloadUrlHost: (() => { try { return new URL(downloadUrl).hostname; } catch { return ''; } })() }, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => {});
        // #endregion

        let response;
        try {
            response = await fetch(downloadUrl, { headers: { 'User-Agent': 'BK-VideoFactory/1.0' }, redirect: 'follow' });
        } catch (fetchErr) {
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/6e5419c3-da58-4eff-91a7-eca90285816f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'UploadService.js:importFromUrlSync', message: 'fetch threw', data: { err: String(fetchErr?.message || fetchErr) }, timestamp: Date.now(), hypothesisId: 'H3' }) }).catch(() => {});
            // #endregion
            throw fetchErr;
        }

        // #region agent log
        const ct = response.headers.get('content-type') || '';
        const cl = response.headers.get('content-length');
        fetch('http://127.0.0.1:7244/ingest/6e5419c3-da58-4eff-91a7-eca90285816f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'UploadService.js:importFromUrlSync', message: 'fetch response', data: { status: response.status, ok: response.ok, contentType: ct.slice(0, 80), contentLength: cl }, timestamp: Date.now(), hypothesisId: 'H2' }) }).catch(() => {});
        // #endregion

        if (!response.ok) throw new ValidationError(`URL fetch failed: ${response.status}`);
        const envToUse = env ?? this.env;
        const rawBucket = envToUse?.[RAW_BUCKET];
        if (!rawBucket) throw new AppError('R2 raw bucket not configured', 503);
        // R2 put() requires a body with known length; always buffer to avoid chunked/stream issues.
        const bodyWithKnownLength = await response.arrayBuffer();
        try {
            await rawBucket.put(r2RawKey, bodyWithKnownLength, {
                httpMetadata: { contentType: response.headers.get('content-type') || 'video/mp4' },
                customMetadata: { source_url: downloadUrl },
            });
        } catch (putErr) {
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/6e5419c3-da58-4eff-91a7-eca90285816f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'UploadService.js:importFromUrlSync', message: 'R2 put failed', data: { err: String(putErr?.message || putErr), r2RawKey }, timestamp: Date.now(), hypothesisId: 'H4' }) }).catch(() => {});
            // #endregion
            throw putErr;
        }
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/6e5419c3-da58-4eff-91a7-eca90285816f', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'UploadService.js:importFromUrlSync', message: 'R2 put ok', data: { r2RawKey }, timestamp: Date.now(), hypothesisId: 'H3' }) }).catch(() => {});
        // #endregion

        const head = await rawBucket.head(r2RawKey);
        const fileSize = head?.size ?? 0;
        const job = await this.jobRepo.create({
            original_name: originalName,
            clean_name: cleanName,
            r2_raw_key: r2RawKey,
            quality: quality || '720p',
            file_size_input: fileSize,
            processing_profile: processingProfile || '12',
            uploaded_by: userId,
            tags: tags || '',
            project_name: projectName || '',
            notes: notes || `Source: ${url}`,
            source_url: downloadUrl,
            folder_id: folderId || null,
            status: JOB_STATUS.PENDING,
        });
        logger.info('URL import sync job created', { jobId: job.id, cleanName });
        return { success: true, job_id: job.id, clean_name: cleanName, status: JOB_STATUS.PENDING, uri: `/api/videos/${job.id}` };
    }
}
