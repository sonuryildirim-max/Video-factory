"""
Video constants — sync with src/config/config.js VIDEO_CONSTANTS.
Deployment: set env vars to override.
- Size/time: MAX_FILE_SIZE, MAX_URL_DOWNLOAD_BYTES, TIMEOUT_MINUTES, VIDEO_JOB_MAX_RETRIES
- RAM: RAM_WARNING_GB (default 28), RAM_CRITICAL_GB (default 31.5)
- FFmpeg: FFMPEG_CRF_ULTRA (16), FFMPEG_CRF_DENGELI (18), FFMPEG_CRF_KUCUK_DOSYA (24), THUMBNAIL_SCALE (360:-2)
"""
import os

def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default

def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default

VIDEO_CONSTANTS = {
    'MAX_FILE_SIZE_BYTES': int(os.getenv('MAX_FILE_SIZE', str(1024 * 1024 * 1024))),        # 1GB agent processing limit
    'MAX_URL_DOWNLOAD_BYTES': int(os.getenv('MAX_URL_DOWNLOAD_BYTES', str(5 * 1024 * 1024 * 1024))),  # 5 GB
    'JOB_PROCESSING_TIMEOUT_MINUTES': int(os.getenv('TIMEOUT_MINUTES', '60')),
    'JOB_MAX_RETRIES': int(os.getenv('VIDEO_JOB_MAX_RETRIES', '3')),
    'RAM_WARNING_GB': _float_env('RAM_WARNING_GB', 28.0),
    'RAM_CRITICAL_GB': _float_env('RAM_CRITICAL_GB', 31.5),
    # FFmpeg CRF per profile (ultra=highest quality, kucuk_dosya=smaller file)
    'FFMPEG_CRF_ULTRA': _int_env('FFMPEG_CRF_ULTRA', 16),
    'FFMPEG_CRF_DENGELI': _int_env('FFMPEG_CRF_DENGELI', 18),
    'FFMPEG_CRF_KUCUK_DOSYA': _int_env('FFMPEG_CRF_KUCUK_DOSYA', 24),
    'THUMBNAIL_SCALE': os.getenv('THUMBNAIL_SCALE', '360:-2'),
}
