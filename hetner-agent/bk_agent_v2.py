#!/usr/bin/env python3
"""
BK-VF Hetner Agent v2 — Unified Python Agent (Ultra-HQ v4)
4 parallel render, state machine, kademeli derin uyku (hibernasyon).

Features:
- 4 concurrent video render (ThreadPoolExecutor max_workers=4)
- Kademeli derin uyku: idle 3600s -> 2 cevapsız heartbeat 21600s -> 86400s
- Active gear: wakeup/job triggers 300s window, claim every 60 seconds (never 1s)
- Wakeup server 8080
- FFmpeg Native: CRF 14 -preset slow, scale lanczos, -pix_fmt yuv420p, -movflags +faststart
- Thumbnail: -ss 00:00:05, -vf scale=360:-2
- Output suffix: -1080.mp4 / -720.mp4
- SSRF protection on download URLs
"""

import os
import sys
import time
import json
import logging
import shutil
import subprocess
import requests
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List
import tempfile
import socket
import ipaddress
from urllib.parse import urlparse, urljoin
import re
import signal
from queue import Queue, Empty
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    import psutil
except ImportError:
    psutil = None

from video_config import VIDEO_CONSTANTS

# ─── Cross-platform hardware telemetry (Windows 10 + Linux) ───────────────────
def get_system_health(temp_dir: Optional[Path] = None) -> Dict:
    """
    Real-time CPU, RAM and disk metrics. Uses psutil; safe defaults if psutil missing.
    Returns: cpu_percent, ram_total_gb, ram_used_gb, ram_available_gb,
             disk_total_gb, disk_used_gb, disk_free_gb [, disk_read_bytes, disk_write_bytes ]
    """
    empty = {
        'cpu_percent': 0.0,
        'ram_total_gb': 0.0,
        'ram_used_gb': 0.0,
        'ram_available_gb': 0.0,
        'disk_total_gb': 0.0,
        'disk_used_gb': 0.0,
        'disk_free_gb': 0.0,
    }
    if not psutil:
        logger.debug("[Telemetry] psutil not available; returning safe defaults")
        return empty
    try:
        cpu = psutil.cpu_percent(interval=0.1)
        mem = psutil.virtual_memory()
        ram_total_gb = mem.total / (1024 ** 3)
        ram_used_gb = mem.used / (1024 ** 3)
        ram_available_gb = mem.available / (1024 ** 3)
        path = temp_dir or Path(CONFIG['temp_dir'])
        try:
            disk = psutil.disk_usage(str(path))
            disk_total_gb = disk.total / (1024 ** 3)
            disk_used_gb = disk.used / (1024 ** 3)
            disk_free_gb = disk.free / (1024 ** 3)
        except Exception:
            disk_total_gb = disk_used_gb = disk_free_gb = 0.0
        out = {
            'cpu_percent': round(cpu, 1),
            'ram_total_gb': round(ram_total_gb, 2),
            'ram_used_gb': round(ram_used_gb, 2),
            'ram_available_gb': round(ram_available_gb, 2),
            'disk_total_gb': round(disk_total_gb, 2),
            'disk_used_gb': round(disk_used_gb, 2),
            'disk_free_gb': round(disk_free_gb, 2),
        }
        try:
            io = psutil.disk_io_counters()
            if io:
                out['disk_read_bytes'] = getattr(io, 'read_bytes', 0) or 0
                out['disk_write_bytes'] = getattr(io, 'write_bytes', 0) or 0
        except Exception:
            pass
        return out
    except Exception as e:
        logger.warning(f"[Telemetry] get_system_health failed: {e}")
        return empty


# Nice priority for FFmpeg (Unix only) — Entegra gets CPU when needed
def _subprocess_preexec_nice():
    if sys.platform != 'win32':
        try:
            os.nice(15)
        except Exception:
            pass


def _wrap_io_priority(cmd: List[str]) -> List[str]:
    """Linux: prepend ionice -c 3 / nice -n 15 for idle I/O + low CPU priority.
    Windows: no command wrapping — priority applied via _apply_windows_priority() after Popen."""
    if sys.platform != 'win32':
        return ['ionice', '-c', '3', 'nice', '-n', '15'] + cmd
    return cmd


def _apply_windows_priority(pid: int) -> None:
    """Windows-only: lower CPU to BELOW_NORMAL and I/O to IOPRIO_LOW via psutil. No-op on Linux/missing psutil."""
    if sys.platform != 'win32' or not psutil:
        return
    try:
        p = psutil.Process(pid)
        p.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
        if hasattr(p, 'ionice') and hasattr(psutil, 'IOPRIO_LOW'):
            p.ionice(psutil.IOPRIO_LOW)
    except Exception as e:
        logger.debug(f"[Priority] Windows priority set failed pid={pid}: {e}")

# Configuration
CONFIG = {
    'api_base_url': os.getenv('BK_API_BASE_URL', 'https://v.bilgekarga.tr'),
    'bearer_token': os.getenv('BK_BEARER_TOKEN', ''),
    'worker_id': os.getenv('BK_WORKER_ID', f'hetner-{uuid.uuid4().hex[:8]}'),
    'ffmpeg_path': os.getenv('FFMPEG_PATH', 'ffmpeg'),
    'temp_dir': os.getenv('TEMP_DIR', 'C:/temp/video-processing'),

    # Parallel processing
    'max_concurrent_jobs': int(os.getenv('MAX_CONCURRENT_JOBS', '4')),

    # Polling kademeleri (saniye) — hiçbir koşulda 1 saniye yok
    # 1. Active: /wakeup veya son 5 dk içinde iş → 60 sn
    'active_wait': int(os.getenv('ACTIVE_WAIT', '60')),
    'active_gear_duration': int(os.getenv('ACTIVE_GEAR_DURATION', '300')),
    # 2. Idle: 5 dk geçti → 3600 sn (1 saat)
    'idle_wait': int(os.getenv('IDLE_WAIT', '3600')),
    'idle_heartbeat_interval': int(os.getenv('IDLE_HEARTBEAT_INTERVAL', '3600')),
    # 3. Deep sleep 1: 2 saat iş yok → 21600 sn (6 saat)
    'idle_to_deep_threshold': int(os.getenv('IDLE_TO_DEEP_THRESHOLD', '7200')),
    'deep1_wait': int(os.getenv('DEEP1_WAIT', '21600')),
    # 4. Deep sleep 2: sessizlik sürerse → 86400 sn (24 saat)
    'deep2_wait': int(os.getenv('DEEP2_WAIT', '86400')),

    'wakeup_port': int(os.getenv('WAKEUP_PORT', '8080')),

    # Stealth heartbeat: every 10 minutes, no log on success
    'stealth_heartbeat_interval': int(os.getenv('STEALTH_HEARTBEAT_INTERVAL', '600')),

    # Processing — sync with hetner-agent/video_config.py (mirrors src/config/config.js)
    'max_file_size': VIDEO_CONSTANTS['MAX_FILE_SIZE_BYTES'],
    'max_url_download_bytes': VIDEO_CONSTANTS['MAX_URL_DOWNLOAD_BYTES'],
    'timeout_minutes': VIDEO_CONSTANTS['JOB_PROCESSING_TIMEOUT_MINUTES'],
    'ram_warning_gb': VIDEO_CONSTANTS['RAM_WARNING_GB'],
    'ram_critical_gb': VIDEO_CONSTANTS['RAM_CRITICAL_GB'],
    # Legacy profile → CRF (new presets use crf_10, crf_12, etc. and parse number from name)
    'ffmpeg_crf_map': {
        'native': 14,
        'ultra': 16,
        'dengeli': 14,
        'kucuk_dosya': 18,
    },
    'thumbnail_scale': VIDEO_CONSTANTS['THUMBNAIL_SCALE'],
    'cdn_base_url': os.getenv('CDN_BASE_URL', 'https://cdn.bilgekarga.tr'),

    # Samaritan: Wakeup, Status (6h), Ping (5min)
    'telegram_token': os.getenv('TELEGRAM_TOKEN', ''),
    'telegram_chat_id': os.getenv('TELEGRAM_CHAT_ID', ''),
    'telegram_poll_interval': int(os.getenv('TELEGRAM_POLL_INTERVAL', '5')),
    'samaritan_secret': os.getenv('SAMARITAN_SECRET', ''),
    'status_interval': int(os.getenv('SAMARITAN_STATUS_INTERVAL', '21600')),  # 6 hours
    'ping_interval': int(os.getenv('SAMARITAN_PING_INTERVAL', '300')),  # 5 minutes
    # Shadow channel: when Telegram fails, send same message here (e.g. Discord webhook)
    'fallback_webhook_url': os.getenv('FALLBACK_WEBHOOK_URL', '') or os.getenv('DISCORD_WEBHOOK_URL', ''),

    # Job recovery: on startup, retry interrupted jobs if set
    'auto_resume_interrupted': os.getenv('AUTO_RESUME_INTERRUPTED', '').lower() in ('1', 'true', 'yes'),

    # Logging
    'log_level': os.getenv('LOG_LEVEL', 'DEBUG'),
    'log_file': os.getenv('LOG_FILE', 'C:/logs/bk-vf-agent-v2.log'),
}

logging.basicConfig(
    level=getattr(logging, CONFIG['log_level']),
    format='%(asctime)s - %(threadName)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(CONFIG['log_file']),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class BKVFAgentV2:
    """BK-VF Hetner Agent v2 — stealth idle, active gear, web-optimized FFmpeg."""

    def __init__(self):
        self.worker_id = CONFIG['worker_id']
        self.api_base_url = CONFIG['api_base_url']
        self.bearer_token = CONFIG['bearer_token']
        self.ffmpeg_path = CONFIG['ffmpeg_path']
        self.temp_dir = Path(CONFIG['temp_dir'])
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        self.max_concurrent = self._compute_max_concurrent()
        self.job_queue = Queue()
        self.active_jobs = {}
        self.lock = threading.Lock()
        self.mode = 'idle'
        self.active_gear_until = 0.0
        self.last_claim_time = 0.0
        self.last_job_time = time.time()
        self.wakeup_event = threading.Event()
        self.last_heartbeat = None
        self.running = True
        self.heartbeat_no_response_count = 0
        self._url_download_semaphore = threading.Semaphore(1)  # Concurrency 1 for URL download
        self._active_procs = {}  # {job_id: Popen} — FFmpeg handles for RAM watchdog kill
        self._ram_critical = False
        self._ram_critical_time = 0.0
        self._start_time = time.time()
        self._paused = False  # C2: when True, do not claim new jobs (current/queue continue)

        self._validate_config()
        self._cleanup_orphan_files()
        logger.info(f"BK-VF Agent v2 initialized. Worker ID: {self.worker_id}, max_concurrent: {self.max_concurrent}")

    def _cleanup_orphan_files(self) -> None:
        """Remove orphan .part, .mov, .mp4 files older than 1 hour from temp_dir (recursive)."""
        # #region agent log
        try:
            p = Path(__file__).resolve().parents[1] / '.cursor' / 'debug.log'
            with open(p, 'a', encoding='utf-8') as f:
                f.write(json.dumps({"location": "bk_agent_v2:_cleanup_orphan_files", "message": "entry", "data": {"temp_dir": str(self.temp_dir), "exists": self.temp_dir.exists()}, "timestamp": int(time.time() * 1000), "hypothesisId": "H4"}) + "\n")
        except Exception:
            pass
        # #endregion
        if not self.temp_dir.exists():
            return
        cutoff = time.time() - 3600
        allowed = ('.part', '.mov', '.mp4')
        removed = 0
        try:
            for p in self.temp_dir.rglob('*'):
                if p.is_file() and p.suffix.lower() in allowed:
                    try:
                        if p.stat().st_mtime < cutoff:
                            p.unlink()
                            removed += 1
                    except OSError as e:
                        logger.warning(f"Orphan cleanup: could not remove {p}: {e}")
        except Exception as e:
            # #region agent log
            try:
                logp = Path(__file__).resolve().parents[1] / '.cursor' / 'debug.log'
                with open(logp, 'a', encoding='utf-8') as f:
                    f.write(json.dumps({"location": "bk_agent_v2:_cleanup_orphan_files", "message": "rglob error", "data": {"error": str(e), "temp_dir": str(self.temp_dir)}, "timestamp": int(time.time() * 1000), "hypothesisId": "H4"}) + "\n")
            except Exception:
                pass
            # #endregion
            logger.warning(f"Orphan cleanup error: {e}")
        if removed:
            logger.info(f"Orphan cleanup: removed {removed} stale files from temp/")

    def _compute_max_concurrent(self) -> int:
        """Compute max_concurrent from CPU and RAM (FFmpeg ~4 GB per job)."""
        env_val = os.getenv('MAX_CONCURRENT_JOBS', '').strip()
        if env_val and env_val.isdigit():
            return max(1, min(16, int(env_val)))
        if not psutil:
            return CONFIG['max_concurrent_jobs']
        try:
            health = get_system_health(self.temp_dir)
            ram_available_gb = health.get('ram_available_gb') or health.get('ram_total_gb') or 0
            cpu_count = psutil.cpu_count() or 4
            # FFmpeg ~4 GB per job; leave 1 CPU for system
            n = min(
                max(1, cpu_count - 1),
                max(1, int(ram_available_gb // 4)) if ram_available_gb > 0 else 1,
                8,
            )
            logger.info(f"[DYNAMIC] CPU={cpu_count}, RAM={ram_available_gb:.1f}GB -> max_concurrent={n}")
            return n
        except Exception as e:
            logger.warning(f"[DYNAMIC] Concurrency compute failed: {e}, using config default")
            return CONFIG['max_concurrent_jobs']

    def _validate_config(self):
        if not self.bearer_token:
            logger.error("BK_BEARER_TOKEN not set")
            sys.exit(1)
        try:
            r = subprocess.run(
                _wrap_io_priority([self.ffmpeg_path, '-version']),
                capture_output=True, text=True, timeout=5
            )
            if r.returncode != 0:
                logger.error("FFmpeg not found")
                sys.exit(1)
        except Exception as e:
            logger.error(f"FFmpeg check failed: {e}")
            sys.exit(1)

    def _make_api_request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Optional[Dict]:
        url = f"{self.api_base_url}{endpoint}"
        headers = {
            'Authorization': f'Bearer {self.bearer_token}',
            'Content-Type': 'application/json',
            'User-Agent': f'BK-VF-Agent/{self.worker_id}',
            'x-worker-id': self.worker_id,
        }
        body_summary = ''
        if isinstance(data, dict):
            safe = {k: ('***' if k.lower() in ('bearer_token', 'token', 'authorization', 'password') else v)
                    for k, v in data.items()}
            body_summary = str(safe)[:300]
        logger.debug(f"API request: {method} {url} body={body_summary}")
        try:
            if method == 'POST':
                r = requests.post(url, headers=headers, json=data, timeout=60, allow_redirects=False)
            else:
                r = requests.get(url, headers=headers, timeout=30, allow_redirects=False)
            logger.debug(f"API response: {method} {endpoint} status={r.status_code}")
            if r.status_code == 302:
                logger.error(
                    f"API {method} {endpoint}: 302 redirect. v.bilgekarga.tr must NOT redirect /api/* to another domain. "
                    "Fix: Cloudflare/domain rule: exclude /api from redirect to bilgekarga.com.tr"
                )
                return None
            if r.status_code == 204:
                return None
            r.raise_for_status()
            ct = (r.headers.get('Content-Type') or '').lower()
            if 'application/json' not in ct and r.content:
                logger.error(
                    f"API {method} {endpoint}: response is not JSON (Content-Type: {ct}). "
                    "Check that v.bilgekarga.tr/api is served by the Worker, not redirected."
                )
                return None
            return r.json() if r.content else None
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 302:
                logger.error(
                    "API redirect (302). v.bilgekarga.tr must not redirect /api requests. "
                    "Configure domain so /api/* goes to the Worker."
                )
            else:
                logger.error(f"API {method} {endpoint}: {e}")
            return None
        except Exception as e:
            logger.error(f"API {method} {endpoint}: {e}")
            return None

    def _update_job_status(self, job_id: int, status: str) -> bool:
        data = {'job_id': job_id, 'worker_id': self.worker_id, 'status': status}
        return self._make_api_request('POST', '/api/jobs/status', data) is not None

    def fail_job(self, job_id: int, error_message: str, stage: str = '', ffmpeg_output: str = '') -> bool:
        data = {
            'job_id': job_id,
            'worker_id': self.worker_id,
            'error_message': error_message,
            'retry_count': 0,
            'status': 'FAILED',
            'stage': stage,
            'ffmpeg_output': ffmpeg_output[:4000] if ffmpeg_output else '',
        }
        return self._make_api_request('POST', '/api/jobs/fail', data) is not None

    def _validate_download_url(self, url: str) -> bool:
        """SSRF shield: allow-list (known CDN/hosts only); block private/loopback, cloud metadata, IPv6.
        Hardened against DNS rebinding, cloud metadata endpoints, and IPv6 (resolve IPv4 only)."""
        # Allow-list: known CDN and storage hostnames (exact or *.domain)
        ALLOWED_HOSTS = (
            'cdn.bilgekarga.tr',
            'r2.cloudflarestorage.com',
            'cloudflarestorage.com',
            'cloudflare.com',
            'amazonaws.com',
            's3.amazonaws.com',
            'drive.google.com',
            'google.com',
            'googleapis.com',
            'dropbox.com',
            'dropboxusercontent.com',
        )
        # Block cloud metadata (hostnames and literal IPs): GCP, AWS, Azure, Alibaba, etc.
        METADATA_HOSTS = (
            '169.254.169.254',
            'metadata',
            'metadata.google.internal',
            'metadata.google.com',
            'instance-data.ec2.internal',
            'metadata.azure.com',
            '100.100.100.200',  # Alibaba cloud metadata
        )
        try:
            u = urlparse(url)
            if u.scheme not in ('http', 'https'):
                return False
            host = (u.hostname or u.netloc.split(':')[0] or '').strip()
            if not host:
                return False
            host_lower = host.lower()

            # Block cloud metadata hostnames and IPs
            if host_lower in METADATA_HOSTS or any(host_lower.endswith('.' + h) for h in METADATA_HOSTS):
                return False
            # Block if host is a literal metadata IP (e.g. 169.254.169.254, 100.100.100.200)
            try:
                if ipaddress.ip_address(host).is_private or host == '169.254.169.254' or host == '100.100.100.200':
                    return False
            except ValueError:
                pass  # not an IP, continue

            # Allow-list: host must match one of the allowed domains (exact or suffix)
            if not any(host_lower == h or host_lower.endswith('.' + h) for h in ALLOWED_HOSTS):
                return False

            # Resolve with IPv4 only (AF_INET) to avoid IPv6 loopback/link-local/metadata and DNS rebinding
            try:
                addrs = socket.getaddrinfo(host, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
            except socket.gaierror:
                return False
            for res in addrs:
                _, _, _, _, sockaddr = res
                ip_str = sockaddr[0] if isinstance(sockaddr, (list, tuple)) else sockaddr
                if not ip_str:
                    continue
                try:
                    addr = ipaddress.ip_address(ip_str)
                except ValueError:
                    return False  # unexpected if AF_INET
                if addr.is_private or addr.is_loopback or addr.is_link_local or ip_str in ('169.254.169.254', '100.100.100.200'):
                    return False
            return True
        except Exception:
            return False

    def _transform_url(self, url: str) -> str:
        """Google Drive confirm token, Dropbox ?dl=1."""
        u = urlparse(url)
        if not u.hostname:
            return url
        host = u.hostname.lower()
        if 'drive.google.com' in host and '/file/d/' in url:
            m = re.search(r'/file/d/([a-zA-Z0-9_-]+)', url)
            if m:
                fid = m.group(1)
                try:
                    sess = requests.Session()
                    sess.headers.update({'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
                    r = sess.get(f'https://drive.google.com/uc?export=download&id={fid}', timeout=30)
                    r.raise_for_status()
                    token = None
                    for mt in re.finditer(r'confirm=([0-9A-Za-z_-]+)', r.text):
                        token = mt.group(1)
                        break
                    if token:
                        return f'https://drive.google.com/uc?export=download&id={fid}&confirm={token}'
                    return f'https://drive.google.com/uc?export=download&id={fid}&confirm=t'
                except Exception as e:
                    logger.warning(f"Google Drive transform failed: {e}, using original URL")
                    return url
        if 'dropbox.com' in host:
            qs = u.query or ''
            if 'dl=0' in qs:
                return url.replace('dl=0', 'dl=1')
            if 'dl=' not in qs:
                sep = '&' if '?' in url else '?'
                return url + sep + 'dl=1'
        return url

    def _update_download_progress(self, job_id: int, downloaded: int, total: Optional[int]) -> None:
        """Report download progress to API."""
        pct = round((downloaded / total * 100) if total and total > 0 else 0, 1)
        data = {
            'job_id': job_id,
            'worker_id': self.worker_id,
            'status': 'DOWNLOADING',
            'download_bytes': downloaded,
            'download_total': total or 0,
            'download_progress': pct,
        }
        self._make_api_request('POST', '/api/jobs/status', data)

    def _download(self, url: str, dest: Path, job_id: int) -> bool:
        """HEAD pre-check, disk quota 2x file size, 5GB limit, chunk 1MB, .part file, progress API."""
        part_path = dest.parent / (dest.name + '.part')
        try:
            if not self._validate_download_url(url):
                self.fail_job(job_id, "SSRF: blocked URL", stage='download')
                return False
            transformed = self._transform_url(url)
            max_bytes = CONFIG['max_url_download_bytes']
            chunk_size = 1024 * 1024
            content_length = None
            try:
                head = requests.head(transformed, timeout=30, allow_redirects=True)
                if head.status_code == 200:
                    cl = head.headers.get('Content-Length')
                    if cl:
                        content_length = int(cl)
                        if content_length > max_bytes:
                            self.fail_job(job_id, "5 GB limit aşıldı", stage='download')
                            return False
            except Exception:
                pass
            file_size = content_length or max_bytes
            try:
                usage = shutil.disk_usage(str(self.temp_dir))
                if usage.free < 2 * file_size:
                    self.fail_job(
                        job_id,
                        "Yetersiz disk alanı (en az 2× dosya boyutu gerekli)",
                        stage='download'
                    )
                    return False
            except Exception as e:
                logger.warning(f"[Disk] disk_usage check failed: {e}")
            self._update_job_status(job_id, 'DOWNLOADING')
            r = requests.get(transformed, stream=True, timeout=120)
            r.raise_for_status()
            total = content_length or int(r.headers.get('Content-Length', 0) or 0)
            if total and total > max_bytes:
                self.fail_job(job_id, "5 GB limit aşıldı", stage='download')
                return False
            downloaded = 0
            last_pct = -1
            with open(part_path, 'wb') as f:
                for chunk in r.iter_content(chunk_size=chunk_size):
                    if not chunk:
                        continue
                    downloaded += len(chunk)
                    if downloaded > max_bytes:
                        part_path.unlink(missing_ok=True)
                        self.fail_job(job_id, "5 GB limit aşıldı", stage='download')
                        return False
                    f.write(chunk)
                    pct = round((downloaded / total * 100) if total and total > 0 else 0, 1)
                    if pct != last_pct and (int(pct) % 10 == 0 or pct >= 99):
                        self._update_download_progress(job_id, downloaded, total)
                        last_pct = pct
            part_path.rename(dest)
            return True
        except Exception as e:
            part_path.unlink(missing_ok=True)
            self.fail_job(job_id, str(e), stage='download')
            return False

    def _url_import_done(self, job_id: int, r2_raw_key: str, file_size: int) -> bool:
        data = {'job_id': job_id, 'worker_id': self.worker_id, 'r2_raw_key': r2_raw_key, 'file_size_input': file_size}
        return self._make_api_request('POST', '/api/jobs/url-import-done', data) is not None

    def _upload_to_r2(self, path: Path, job_id: int, bucket: str, key: str, content_type: str = 'video/mp4') -> Optional[str]:
        payload = {'job_id': job_id, 'worker_id': self.worker_id, 'bucket': bucket, 'key': key, 'content_type': content_type}
        resp = self._make_api_request('POST', '/api/jobs/presigned-upload', payload)
        if not resp or 'upload_url' not in resp:
            return None
        try:
            with open(path, 'rb') as f:
                r = requests.put(resp['upload_url'], data=f, timeout=600)
            r.raise_for_status()
            cdn_base = CONFIG['cdn_base_url'].rstrip('/')
            # Ensure absolute HTTPS URL — never write a relative path or bare domain to DB
            if not cdn_base.startswith('https://') and not cdn_base.startswith('http://'):
                cdn_base = 'https://' + cdn_base
            public_url = f"{cdn_base}/{key.lstrip('/')}"
            return public_url
        except Exception as e:
            logger.error(f"R2 upload failed: {e}")
            return None

    def _process_video(self, job: Dict, input_path: Path, work_dir: Path) -> Optional[Dict]:
        """
        Process video based on processing_profile. Native: no bitrate/FPS override; only CRF + preset.
        web_opt/web_optimize = -c:v copy -an; crf_10..crf_18 = -crf N -preset slow (scale from quality).
        """
        job_id = job['id']
        quality = job.get('quality', '720p')
        profile = job.get('processing_profile', 'crf_14')
        qmap = {'original': 'original', '720p': '720', '1080p': '1080', '2k': '2k', '4k': '4k'}
        res_suffix = qmap.get(quality, '1080' if quality == '1080p' else '720')
        base_clean = job['clean_name'].replace('.mp4', '').replace('.mov', '')
        output_filename = f"{base_clean}-{res_suffix}.mp4"
        output_file = work_dir / output_filename

        try:
            self._update_job_status(job_id, 'CONVERTING')

            meta = {}
            try:
                probe = subprocess.run(
                    _wrap_io_priority(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', str(input_path)]),
                    capture_output=True, text=True, timeout=15
                )
                if probe.returncode == 0:
                    d = json.loads(probe.stdout)
                    fmt = d.get('format', {})
                    dur_sec = float(fmt.get('duration', 0) or 0)
                    file_bytes = int(fmt.get('size', 0) or 0) or input_path.stat().st_size
                    meta['duration_sec'] = dur_sec
                    meta['file_bytes'] = file_bytes
                    for s in d.get('streams', []):
                        if s.get('codec_type') == 'video':
                            w = int(s.get('width', 0) or 0)
                            h = int(s.get('height', 0) or 0)
                            meta['width'] = w
                            meta['height'] = h
                            meta['vertical'] = h > w
                            raw_br = int(s.get('bit_rate', 0) or fmt.get('bit_rate', 0) or 0)
                            meta['bitrate'] = raw_br // 1000 if raw_br else 0
                            meta['fps'] = self._parse_fps(s.get('r_frame_rate', '30'))
                            break
            except Exception:
                pass
            meta.setdefault('bitrate', 0)
            meta.setdefault('fps', 30)
            meta.setdefault('vertical', False)
            meta.setdefault('width', 1920)
            meta.setdefault('height', 1080)
            meta.setdefault('duration_sec', 0)
            meta.setdefault('file_bytes', 0)

            if meta['bitrate'] <= 0 and meta['duration_sec'] > 0 and meta['file_bytes'] > 0:
                meta['bitrate'] = int((meta['file_bytes'] * 8) / meta['duration_sec']) // 1000

            # Scale filter: original / web_opt = no scale; else quality-based
            vert = meta['vertical']
            scale_map = {
                '720p': ('scale=720:-2:flags=lanczos', 'scale=-2:720:flags=lanczos'),
                '1080p': ('scale=1080:-2:flags=lanczos', 'scale=-2:1080:flags=lanczos'),
                '2k': ('scale=1440:-2:flags=lanczos', 'scale=-2:1440:flags=lanczos'),
                '4k': ('scale=2160:-2:flags=lanczos', 'scale=-2:2160:flags=lanczos'),
            }
            res_map = {'720p': ('720x1280', '1280x720'), '1080p': ('1080x1920', '1920x1080'),
                       '2k': ('1440x2560', '2560x1440'), '4k': ('2160x3840', '3840x2160')}
            if quality in scale_map and quality != 'original':
                sc_vert, sc_hor = scale_map[quality]
                scale_str = sc_vert if vert else sc_hor
                target_res = res_map[quality][0] if vert else res_map[quality][1]
            else:
                scale_str = None
                target_res = f"{meta['width']}x{meta['height']}"

            # Build FFmpeg cmd — no -b:v, -maxrate, -minrate, -bufsize, -r, -vsync (Bitrate/FPS: source preserved)
            if profile in ('web_opt', 'web_optimize'):
                cmd = [
                    self.ffmpeg_path, '-i', str(input_path),
                    '-c:v', 'copy', '-an', '-movflags', '+faststart',
                    '-y', str(output_file),
                ]
            else:
                # CRF from profile: crf_10 -> 10, crf_14 -> 14, etc.; legacy from ffmpeg_crf_map
                if profile.startswith('crf_'):
                    try:
                        crf = int(profile.split('_')[1])
                    except (ValueError, IndexError):
                        crf = 14
                else:
                    crf_map = CONFIG.get('ffmpeg_crf_map', {'native': 14, 'ultra': 16, 'dengeli': 14, 'kucuk_dosya': 18})
                    crf = crf_map.get(profile, 14)
                if scale_str:
                    cmd = [
                        self.ffmpeg_path, '-i', str(input_path),
                        '-vf', scale_str,
                        '-c:v', 'libx264', '-crf', str(crf), '-preset', 'slow', '-an',
                        '-movflags', '+faststart',
                        '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
                        '-y', str(output_file),
                    ]
                else:
                    cmd = [
                        self.ffmpeg_path, '-i', str(input_path),
                        '-c:v', 'libx264', '-crf', str(crf), '-preset', 'slow', '-an',
                        '-movflags', '+faststart',
                        '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
                        '-y', str(output_file),
                    ]
            cmd_str = ' '.join(cmd)
            start = time.time()
            _popen_flags = subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == 'win32' else 0
            _ffmpeg_proc = subprocess.Popen(
                _wrap_io_priority(cmd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                creationflags=_popen_flags,
            )
            _apply_windows_priority(_ffmpeg_proc.pid)
            self._active_procs[job_id] = _ffmpeg_proc
            try:
                _ffmpeg_stdout, _ffmpeg_stderr = _ffmpeg_proc.communicate(
                    timeout=CONFIG['timeout_minutes'] * 60
                )
            except subprocess.TimeoutExpired:
                _ffmpeg_proc.kill()
                _ffmpeg_proc.wait()
                self.fail_job(job_id, "FFmpeg timeout", stage='convert')
                return None
            finally:
                self._active_procs.pop(job_id, None)
            elapsed = int(time.time() - start)

            if _ffmpeg_proc.returncode != 0:
                ffmpeg_err = _ffmpeg_stderr or _ffmpeg_stdout or ''
                logger.debug(f"FFmpeg stderr: {ffmpeg_err}")
                self.fail_job(job_id, "FFmpeg failed", stage='convert', ffmpeg_output=ffmpeg_err)
                return None

            self._update_job_status(job_id, 'UPLOADING')
            r2_key = f"videos/{datetime.now().year}/{datetime.now().month:02d}/{job_id}_{output_filename}"
            public_url = self._upload_to_r2(output_file, job_id, 'public', r2_key)
            if not public_url:
                self.fail_job(job_id, "R2 upload failed", stage='upload')
                return None

            meta_out = {}
            try:
                probe2 = subprocess.run(
                    _wrap_io_priority(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', str(output_file)]),
                    capture_output=True, text=True, timeout=10
                )
                if probe2.returncode == 0:
                    d2 = json.loads(probe2.stdout)
                    for s in d2.get('streams', []):
                        if s.get('codec_type') == 'video':
                            meta_out['resolution'] = f"{s.get('width', 0)}x{s.get('height', 0)}"
                            meta_out['frame_rate'] = self._parse_fps(s.get('r_frame_rate', '30'))
                            break
                    if 'format' in d2 and 'duration' in d2['format']:
                        meta_out['duration'] = int(float(d2['format']['duration']))
            except Exception:
                pass

            thumbnail_key = None
            try:
                thumb_filename = output_filename.replace('.mp4', '-thumb.jpg')
                thumb_file = work_dir / thumb_filename
                thumb_scale = CONFIG.get('thumbnail_scale', '360:-2')
                thumb_cmd = [
                    self.ffmpeg_path,
                    '-ss', '00:00:05',
                    '-i', str(output_file),
                    '-vframes', '1',
                    '-vf', f'scale={thumb_scale}',
                    '-q:v', '3',
                    '-y', str(thumb_file),
                ]
                thumb_result = subprocess.run(
                    _wrap_io_priority(thumb_cmd),
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                if thumb_result.returncode == 0 and thumb_file.exists():
                    thumb_r2_key = f"thumbnails/{job_id}/{thumb_filename}"
                    thumb_url = self._upload_to_r2(thumb_file, job_id, 'public', thumb_r2_key, 'image/jpeg')
                    if thumb_url:
                        thumbnail_key = thumb_r2_key
                        logger.info(f"Thumbnail generated and uploaded: {thumbnail_key}")
            except Exception as thumb_err:
                logger.warning("Thumbnail step skipped: %s", thumb_err)

            logger.info("Bitrate/FPS: Kaynak Korundu")
            return {
                'public_url': public_url,
                'file_size_output': output_file.stat().st_size,
                'duration': meta_out.get('duration', 0),
                'processing_time_seconds': elapsed,
                'resolution': meta_out.get('resolution', target_res),
                'bitrate': meta_out.get('bitrate', meta['bitrate']),
                'codec': 'h264',
                'frame_rate': meta_out.get('frame_rate', meta['fps']),
                'audio_codec': 'aac',
                'audio_bitrate': 128,
                'ffmpeg_command': cmd_str,
                'ffmpeg_output': (_ffmpeg_stdout or '') + (_ffmpeg_stderr or ''),
                'thumbnail_key': thumbnail_key,
                'clean_name': output_filename,
            }
        except subprocess.TimeoutExpired:
            self.fail_job(job_id, "FFmpeg timeout", stage='convert')
            return None
        except Exception as e:
            self.fail_job(job_id, str(e), stage='convert')
            return None

    def _parse_fps(self, raw: str) -> float:
        try:
            if '/' in str(raw):
                n, d = str(raw).split('/', 1)
                return round(int(n) / int(d), 2) if int(d) else 30.0
            return float(raw)
        except (ValueError, ZeroDivisionError):
            return 30.0

    def _complete_job(self, job_id: int, result: Dict) -> bool:
        data = {
            'job_id': job_id,
            'worker_id': self.worker_id,
            'public_url': result['public_url'],
            'file_size_output': result['file_size_output'],
            'duration': result['duration'],
            'processing_time_seconds': result['processing_time_seconds'],
            'resolution': result['resolution'],
            'bitrate': result['bitrate'],
            'codec': result['codec'],
            'frame_rate': result['frame_rate'],
            'audio_codec': result['audio_codec'],
            'audio_bitrate': result['audio_bitrate'],
            'ffmpeg_command': result['ffmpeg_command'],
            'ffmpeg_output': result.get('ffmpeg_output', ''),
            'thumbnail_key': result.get('thumbnail_key'),
            'clean_name': result.get('clean_name'),
        }
        return self._make_api_request('POST', '/api/jobs/complete', data) is not None

    def _process_single_job(self, job: Dict) -> bool:
        job_id = job['id']
        with self.lock:
            self.active_jobs[job_id] = threading.current_thread().name
        try:
            with tempfile.TemporaryDirectory(prefix=f"bk-{job_id}-", dir=str(self.temp_dir)) as tmp:
                work_dir = Path(tmp)
                temp_input = work_dir / "input.mp4"

                checkpoint = (job.get('processing_checkpoint') or '').strip()
                source_url = job.get('source_url')
                download_url = job.get('download_url')
                r2_raw_key = (job.get('r2_raw_key') or '').strip()

                # Idempotent resume: if download_done checkpoint exists and raw is already in R2,
                # skip re-downloading from external source.
                can_resume = (
                    checkpoint == 'download_done'
                    and r2_raw_key
                    and r2_raw_key != 'url-import-pending'
                )

                if source_url:
                    if can_resume and download_url:
                        # Raw already in R2; use presigned URL from claim response (faster, internal)
                        logger.info(f"[Checkpoint] Job {job_id}: download_done — downloading from R2 (key={r2_raw_key})")
                        with self._url_download_semaphore:
                            if not self._download(download_url, temp_input, job_id):
                                return False
                    else:
                        # Normal: fetch from external source → upload to R2 raw bucket
                        with self._url_download_semaphore:
                            if not self._download(source_url, temp_input, job_id):
                                return False
                        file_size = temp_input.stat().st_size
                        r2_raw = f"raw-uploads/{int(time.time())}-{job_id}-{job['clean_name']}"
                        if not self._upload_to_r2(temp_input, job_id, 'raw', r2_raw):
                            self.fail_job(job_id, "Failed to upload raw to R2", stage='upload')
                            return False
                        if not self._url_import_done(job_id, r2_raw, file_size):
                            self.fail_job(job_id, "url-import-done failed", stage='upload')
                            return False
                        self._update_job_checkpoint(job_id, 'download_done')
                else:
                    if can_resume and download_url:
                        # Direct upload already in R2; re-download from presigned URL
                        logger.info(f"[Checkpoint] Job {job_id}: download_done — re-downloading from R2 presigned URL")
                        with self._url_download_semaphore:
                            if not self._download(download_url, temp_input, job_id):
                                return False
                    else:
                        if not download_url:
                            self.fail_job(job_id, "Missing download_url", stage='download')
                            return False
                        with self._url_download_semaphore:
                            if not self._download(download_url, temp_input, job_id):
                                return False
                        self._update_job_checkpoint(job_id, 'download_done')

                result = self._process_video(job, temp_input, work_dir)
                if not result:
                    return False
                if not self._complete_job(job_id, result):
                    self.fail_job(job_id, "complete_job failed", stage='complete')
                    return False
                self._send_asset_preview_telegram(job, result)
                logger.info(f"Job {job_id} completed")
                return True
        except Exception as e:
            self.fail_job(job_id, str(e), stage='unknown')
            return False
        finally:
            with self.lock:
                self.active_jobs.pop(job_id, None)

    def _ensure_disk_space_for_job(self, job: Dict) -> bool:
        """Guard Protocol: require at least 2× file size free before accepting job. Return False if insufficient."""
        file_size = job.get('file_size_input')
        if file_size is not None and isinstance(file_size, (int, float)):
            file_size = int(file_size)
        else:
            url = job.get('source_url') or job.get('download_url')
            if url:
                try:
                    transformed = self._transform_url(url)
                    head = requests.head(transformed, timeout=15, allow_redirects=True)
                    if head.status_code == 200:
                        cl = head.headers.get('Content-Length')
                        if cl:
                            file_size = int(cl)
                except Exception:
                    pass
            if file_size is None or file_size <= 0:
                file_size = CONFIG['max_url_download_bytes']
        try:
            usage = shutil.disk_usage(str(self.temp_dir))
            if usage.free < 2 * file_size:
                logger.warning("[Guard] Insufficient disk: free=%s, required 2×=%s", usage.free, 2 * file_size)
                return False
            return True
        except Exception as e:
            logger.warning(f"[Guard] disk_usage check failed: {e}")
            return False

    def _update_job_checkpoint(self, job_id: int, checkpoint: str) -> None:
        """Persist processing_checkpoint to D1 via Worker API (fire-and-forget; non-fatal on failure)."""
        try:
            self._make_api_request('POST', '/api/jobs/checkpoint', {
                'job_id': job_id,
                'worker_id': self.worker_id,
                'checkpoint': checkpoint,
            })
        except Exception as e:
            logger.debug(f"[Checkpoint] update failed job={job_id} checkpoint={checkpoint}: {e}")

    def claim_job(self) -> Optional[Dict]:
        r = self._make_api_request('POST', '/api/jobs/claim', {'worker_id': self.worker_id})
        if r and r.get('id'):
            return r
        return None

    def send_heartbeat(self, status: str = 'ACTIVE') -> bool:
        with self.lock:
            active = len(self.active_jobs)
        data = {
            'status': status,
            'current_job_id': list(self.active_jobs.keys())[0] if self.active_jobs else None,
            'active_jobs': active,
            'queue_size': self.job_queue.qsize(),
            'ip_address': self._get_ip(),
            'version': '2.0',
        }
        ok = self._make_api_request('POST', '/api/heartbeat', data) is not None
        if ok:
            self.last_heartbeat = datetime.now()
        return ok

    def _get_ip(self) -> str:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return 'unknown'

    def _report_system_alert(self, status: str, message: str) -> bool:
        """Report system alert (warning/critical) to Worker API for D1 system_alerts."""
        data = {'status': status, 'message': message}
        return self._make_api_request('POST', '/api/system/alerts', data) is not None

    def _send_alert(self, text: str) -> bool:
        """
        Central alerting: try Telegram first; on ConnectionError, Timeout or 5xx
        send the same message to fallback webhook (e.g. Discord). Returns True if at least one succeeded.
        """
        token = CONFIG.get('telegram_token') or ''
        chat_id = CONFIG.get('telegram_chat_id') or ''
        telegram_ok = False
        if token and chat_id:
            try:
                r = requests.post(
                    f'https://api.telegram.org/bot{token}/sendMessage',
                    json={'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML'},
                    timeout=10
                )
                if r.status_code == 200:
                    telegram_ok = True
                elif r.status_code >= 500:
                    raise requests.RequestException(f"Telegram API {r.status_code}")
            except (requests.RequestException, requests.Timeout, requests.ConnectionError) as e:
                logger.warning(f"[Samaritan] Telegram send failed: {e}")
        if telegram_ok:
            return True
        fallback_url = CONFIG.get('fallback_webhook_url') or ''
        if not fallback_url:
            return False
        try:
            plain = re.sub(r'<[^>]+>', '', text)
            payload = {'content': plain[:2000]}
            r = requests.post(fallback_url, json=payload, timeout=10)
            if r.status_code in (200, 204):
                logger.info("[Samaritan] Shadow channel delivered (fallback webhook)")
                return True
            logger.warning(f"[Samaritan] Fallback webhook returned {r.status_code}")
        except Exception as e:
            logger.warning(f"[Samaritan] Fallback webhook failed: {e}")
        return False

    def _send_telegram(self, text: str) -> bool:
        """Send Telegram message (HTML). Uses _send_alert so fallback webhook is used on Telegram failure."""
        return self._send_alert(text)

    def _send_asset_preview_telegram(self, job: Dict, result: Dict) -> None:
        """Send ASSET ACQUIRED preview (thumbnail + caption) to Telegram. Fire-and-forget."""
        token = CONFIG.get('telegram_token') or ''
        chat_id = CONFIG.get('telegram_chat_id') or ''
        if not token or not chat_id:
            return
        video_name = result.get('clean_name', job.get('clean_name', 'unknown'))
        duration = result.get('duration', 0)
        thumbnail_key = result.get('thumbnail_key')
        cdn_base = CONFIG.get('cdn_base_url', 'https://cdn.bilgekarga.tr').rstrip('/')
        caption = (
            '> 🎬 <b>ASSET ACQUIRED</b>\n'
            f'[ > ] <b>FILE:</b> {video_name}\n'
            f'[ > ] <b>DURATION:</b> {duration}s\n'
            '> <b>STATUS:</b> READY FOR DEPLOYMENT.'
        )
        try:
            if thumbnail_key:
                photo_url = f'{cdn_base}/{thumbnail_key}'
                r = requests.post(
                    f'https://api.telegram.org/bot{token}/sendPhoto',
                    json={'chat_id': chat_id, 'photo': photo_url, 'caption': caption, 'parse_mode': 'HTML'},
                    timeout=15
                )
                if r.status_code != 200:
                    self._send_telegram(caption)
            else:
                self._send_telegram(caption)
        except Exception as e:
            logger.warning(f"[Samaritan] Asset preview send failed: {e}")
            self._send_telegram(caption)

    def _samaritan_wakeup(self) -> None:
        """One-time wakeup message on startup (POI format)."""
        if not self._send_telegram(
            '🟢 SYSTEM ONLINE | NODE: Primary Core'
        ):
            logger.debug("[Samaritan] Wakeup message skipped (no Telegram config)")

    def _samaritan_status_loop(self) -> None:
        """Every 6h: CPU, RAM, Disk, Uptime to Telegram."""
        interval = CONFIG.get('status_interval', 21600)
        while self.running:
            time.sleep(interval)
            if not self.running:
                break
            try:
                health = get_system_health(self.temp_dir)
                cpu = health.get('cpu_percent', 0)
                ram_used = health.get('ram_used_gb', 0)
                ram_total = health.get('ram_total_gb', 0)
                disk_free = health.get('disk_free_gb', 0)
                uptime_h = (time.time() - self._start_time) / 3600
                text = (
                    f'💠 <b>ROUTINE CHECK: NODE STABILITY</b> | '
                    f'CPU: %{int(cpu)} | RAM: {ram_used:.1f}/{ram_total:.1f} GB | '
                    f'DISK FREE: {disk_free:.1f} GB | UPTIME: {uptime_h:.1f}h | STATUS: OPTIMAL'
                )
                self._send_telegram(text)
            except Exception as e:
                logger.warning(f"[Samaritan] Status loop error: {e}")

    def _samaritan_ping_loop(self) -> None:
        """Every 5 min: send telemetry (CPU, RAM, Uptime, Jobs) to Edge /api/samaritan/ping."""
        interval = CONFIG.get('ping_interval', 300)
        secret = CONFIG.get('samaritan_secret') or ''
        if not secret:
            logger.debug("[Samaritan] Ping loop disabled (no SAMARITAN_SECRET)")
            return
        url = f"{self.api_base_url}/api/samaritan/ping"
        headers = {'X-Samaritan-Secret': secret, 'Content-Type': 'application/json'}
        while self.running:
            time.sleep(interval)
            if not self.running:
                break
            try:
                health = get_system_health(self.temp_dir)
                cpu = health.get('cpu_percent', 0)
                ram_used = health.get('ram_used_gb', 0)
                uptime_h = (time.time() - self._start_time) / 3600
                with self.lock:
                    jobs = len(self.active_jobs)
                payload = {
                    'cpu': round(float(cpu), 1),
                    'ram': round(float(ram_used), 2),
                    'uptime_hours': round(uptime_h, 2),
                    'jobs': jobs,
                    'node': 'Primary Core',
                    'timestamp': datetime.now().isoformat(),
                }
                r = requests.post(url, headers=headers, json=payload, timeout=15)
                if r.status_code != 200:
                    logger.debug(f"[Samaritan] Ping failed: {r.status_code}")
            except Exception as e:
                logger.debug(f"[Samaritan] Ping error: {e}")

    def _interrupt_active_jobs(self, stage: str = 'ram_critical') -> None:
        """Terminate running FFmpeg subprocesses immediately, then mark jobs as Interrupted in D1."""
        with self.lock:
            job_ids = list(self.active_jobs.keys())
            procs = dict(self._active_procs)
        # Kill FFmpeg first to release RAM before waiting for API calls
        for job_id, proc in procs.items():
            if proc is None or proc.poll() is not None:
                continue
            try:
                proc.terminate()
                logger.info(f"[Interrupt] SIGTERM → FFmpeg pid={proc.pid} job={job_id}")
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    proc.kill()
                    logger.info(f"[Interrupt] SIGKILL → FFmpeg pid={proc.pid} job={job_id}")
                except Exception:
                    pass
            except Exception as e:
                logger.warning(f"[Interrupt] terminate failed job={job_id}: {e}")
                try:
                    proc.kill()
                except Exception:
                    pass
        # Then notify D1
        for job_id in job_ids:
            try:
                data = {'job_id': job_id, 'worker_id': self.worker_id, 'stage': stage}
                self._make_api_request('POST', '/api/jobs/interrupt', data)
            except Exception as e:
                logger.warning(f"[RAM] Interrupt job {job_id} failed: {e}")

    def _ram_watchdog_loop(self) -> None:
        """RAM threshold: warning at config GB, critical = graceful shutdown (no new claims, finish current jobs, then stop)."""
        if not psutil:
            logger.warning("[RAM] psutil not installed; RAM watchdog disabled")
            return
        ram_warning_gb = CONFIG.get('ram_warning_gb', 28.0)
        ram_critical_gb = CONFIG.get('ram_critical_gb', 31.5)
        last_warning = 0.0
        interval = 30
        while self.running and not self._ram_critical:
            time.sleep(interval)
            if not self.running:
                break
            try:
                health = get_system_health(self.temp_dir)
                ram_used_gb = health.get('ram_used_gb', 0)
                if ram_used_gb >= ram_critical_gb:
                    msg_critical = '🔺 RAM CRITICAL — graceful shutdown (finish current jobs, then stop)'
                    logger.critical(f"[RAM] {msg_critical} ({ram_used_gb:.1f} GB >= {ram_critical_gb} GB)")
                    self._ram_critical = True
                    self._report_system_alert('critical', msg_critical)
                    self._send_telegram(msg_critical)
                    self.wakeup_event.set()
                    return
                if ram_used_gb > ram_warning_gb and (time.time() - last_warning) > 300:
                    msg_warning = '⚠️ SYSTEM ANOMALY'
                    self._report_system_alert('warning', msg_warning)
                    self._send_telegram(msg_warning)
                    last_warning = time.time()
                    logger.warning(f"[RAM] {msg_warning} ({ram_used_gb:.1f} GB > {ram_warning_gb} GB)")
            except Exception as e:
                logger.warning(f"[RAM] Watchdog error: {e}")

    def _stealth_heartbeat_loop(self) -> None:
        """Background thread: heartbeat every 10 minutes. Silent on success, error log only on failure."""
        interval = CONFIG['stealth_heartbeat_interval']
        while self.running:
            time.sleep(interval)
            if not self.running:
                break
            ok = self.send_heartbeat()
            if not ok:
                logger.error("[STEALTH] Heartbeat failed")

    def _start_wakeup_server(self):
        agent = self
        expected_token = (self.bearer_token or '').strip()

        class WakeupHandler(BaseHTTPRequestHandler):
            def handle(self):
                try:
                    super().handle()
                except (ConnectionResetError, BrokenPipeError):
                    pass

            def do_POST(self):
                if self.path == '/wakeup':
                    if expected_token:
                        auth = self.headers.get('Authorization', '').strip()
                        if not auth.startswith('Bearer ') or auth[7:].strip() != expected_token:
                            logger.warning("Wakeup reddedildi: Gecersiz veya eksik Token")
                            self.send_response(401)
                            self.end_headers()
                            self.wfile.write(b'Unauthorized')
                            return
                    with agent.lock:
                        agent.mode = 'active'
                        agent.active_gear_until = time.time() + CONFIG['active_gear_duration']
                        agent.last_claim_time = 0.0
                    agent.wakeup_event.set()
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'OK')
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, format, *args):
                logger.debug("Wakeup server request: %s", args[2] if len(args) >= 3 else args)

        srv = HTTPServer(('0.0.0.0', CONFIG['wakeup_port']), WakeupHandler)
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        logger.info(f"Wakeup server on port {CONFIG['wakeup_port']}")

    def _worker_loop(self, worker_id: int):
        while self.running:
            try:
                job = self.job_queue.get(timeout=60)
                if job is None:
                    break
                self._process_single_job(job)
                self.job_queue.task_done()
            except Empty:
                continue
            except Exception as e:
                logger.error(f"Worker {worker_id} error: {e}")

    def _telegram_c2_loop(self) -> None:
        """Background: long-poll Telegram getUpdates; handle /status, /pause, /resume. Only process messages from telegram_chat_id."""
        token = CONFIG.get('telegram_token') or ''
        chat_id = CONFIG.get('telegram_chat_id') or ''
        if not token or not chat_id:
            logger.debug("[C2] Telegram C2 disabled (no token or chat_id)")
            return
        allowed_chat = str(chat_id).strip()
        poll_interval = max(2, CONFIG.get('telegram_poll_interval', 5))
        offset = 0
        base = f'https://api.telegram.org/bot{token}'
        while self.running:
            try:
                r = requests.get(
                    f'{base}/getUpdates',
                    params={'offset': offset, 'timeout': 30},
                    timeout=35
                )
                if r.status_code == 409:
                    logger.warning(
                        "[C2] Telegram 409: Webhook is set, getUpdates cannot be used. "
                        "/status works via Worker webhook (send /status to bot). "
                        "To use agent /pause and /resume, remove webhook: setWebhook?url="
                    )
                    time.sleep(300)
                    continue
                if r.status_code != 200:
                    time.sleep(poll_interval)
                    continue
                data = r.json()
                if not data.get('ok'):
                    time.sleep(poll_interval)
                    continue
                for upd in data.get('result', []):
                    offset = upd.get('update_id', offset) + 1
                    msg = upd.get('message') or upd.get('edited_message')
                    if not msg:
                        continue
                    if str(msg.get('chat', {}).get('id')) != allowed_chat:
                        continue
                    text = (msg.get('text') or '').strip().lower()
                    if text == '/status':
                        health = get_system_health(self.temp_dir)
                        with self.lock:
                            active_ids = list(self.active_jobs.keys())
                            queue_size = self.job_queue.qsize()
                        uptime_h = (time.time() - self._start_time) / 3600
                        paused_str = 'PAUSED' if self._paused else 'ACTIVE'
                        lines = [
                            '🔎 <b>SAMARITAN STATUS</b>',
                            f'[ > ] <b>NODE:</b> {self.worker_id}',
                            f'[ > ] <b>CPU:</b> %{health.get("cpu_percent", 0):.0f}',
                            f'[ > ] <b>RAM:</b> {health.get("ram_used_gb", 0):.1f} / {health.get("ram_total_gb", 0):.1f} GB',
                            f'[ > ] <b>DISK FREE:</b> {health.get("disk_free_gb", 0):.1f} GB',
                            f'[ > ] <b>ACTIVE JOBS:</b> {len(active_ids)}',
                            f'[ > ] <b>QUEUE:</b> {queue_size}',
                            f'[ > ] <b>UPTIME:</b> {uptime_h:.1f}h',
                            f'[ ! ] <b>MODE:</b> {paused_str}',
                        ]
                        if active_ids:
                            lines.append('[ > ] <b>JOB IDs:</b> ' + ', '.join(str(j) for j in active_ids))
                        self._send_alert('\n'.join(lines))
                    elif text == '/pause':
                        self._paused = True
                        self._send_alert('⏸ <b>PAUSE</b> — New jobs disabled. Current work and queue will finish.')
                    elif text == '/resume':
                        self._paused = False
                        self._send_alert('▶ <b>RESUME</b> — Accepting new jobs again.')
            except Exception as e:
                logger.debug(f"[C2] getUpdates error: {e}")
                time.sleep(poll_interval)
        logger.debug("[C2] Telegram C2 loop stopped")

    def _recover_interrupted_jobs(self) -> None:
        """On startup: fetch INTERRUPTED jobs, notify via Telegram; optionally auto-resume (PENDING)."""
        try:
            r = self._make_api_request('GET', '/api/jobs/interrupted?limit=100')
            if not r or not isinstance(r.get('jobs'), list):
                return
            jobs = r['jobs']
            if not jobs:
                return
            count = len(jobs)
            logger.info(f"[Recovery] Found {count} interrupted job(s)")
            self._send_telegram(
                f"⚠️ <b>INTERRUPTED JOBS</b>: {count} job(s) found. "
                "Retry via dashboard or set AUTO_RESUME_INTERRUPTED=1 to auto-resume on next start."
            )
            if CONFIG.get('auto_resume_interrupted'):
                job_ids = [j['id'] for j in jobs]
                ret = self._make_api_request('POST', '/api/jobs/interrupted/retry', {'job_ids': job_ids})
                if ret and ret.get('retried'):
                    logger.info(f"[Recovery] Auto-resumed {ret.get('retried')} interrupted job(s)")
                    self._send_telegram(f"✅ Auto-resumed {ret.get('retried')} interrupted job(s).")
        except Exception as e:
            logger.warning(f"[Recovery] Interrupted jobs check failed: {e}")

    def run(self):
        logger.info("BK-VF Agent v2 starting (stealth idle + active gear)")
        self._samaritan_wakeup()
        self._start_wakeup_server()
        self._recover_interrupted_jobs()

        stealth_t = threading.Thread(target=self._stealth_heartbeat_loop, name="StealthHeartbeat", daemon=True)
        stealth_t.start()

        status_t = threading.Thread(target=self._samaritan_status_loop, name="SamaritanStatus", daemon=True)
        status_t.start()

        ping_t = threading.Thread(target=self._samaritan_ping_loop, name="SamaritanPing", daemon=True)
        ping_t.start()

        if psutil:
            ram_t = threading.Thread(target=self._ram_watchdog_loop, name="RAMWatchdog", daemon=True)
            ram_t.start()

        if CONFIG.get('telegram_token') and CONFIG.get('telegram_chat_id'):
            c2_t = threading.Thread(target=self._telegram_c2_loop, name="TelegramC2", daemon=True)
            c2_t.start()

        workers = []
        for i in range(self.max_concurrent):
            t = threading.Thread(target=self._worker_loop, args=(i + 1,), name=f"Worker-{i+1}")
            t.start()
            workers.append(t)

        last_hb = 0
        try:
            while self.running:
                now = time.time()
                with self.lock:
                    active = len(self.active_jobs)
                    mode = self.mode
                    gear_until = self.active_gear_until
                    last_job = self.last_job_time

                if mode == 'active' and now >= gear_until:
                    with self.lock:
                        self.mode = 'idle'

                with self.lock:
                    mode = self.mode
                    gear_until = self.active_gear_until

                if self._ram_critical and active == 0 and self.job_queue.empty():
                    logger.info("[RAM] Graceful shutdown: no active jobs left, stopping.")
                    self.running = False
                    self.wakeup_event.set()
                    break
                if mode == 'active' and now < gear_until:
                    wait = CONFIG['active_wait']
                    self.heartbeat_no_response_count = 0
                    if now - last_hb >= 30:
                        if self.send_heartbeat():
                            last_hb = now
                    if (not self._ram_critical
                            and not self._paused
                            and active < self.max_concurrent
                            and (now - self.last_claim_time) >= CONFIG['active_wait']):
                        self._make_api_request('POST', '/api/jobs/mark-zombies', {})
                        job = self.claim_job()
                        with self.lock:
                            self.last_claim_time = now
                            if job:
                                if not self._ensure_disk_space_for_job(job):
                                    self.fail_job(
                                        job['id'],
                                        "Yetersiz disk alanı (en az 2× dosya boyutu gerekli)",
                                        stage='claim'
                                    )
                                else:
                                    self.job_queue.put(job)
                                    self.last_job_time = now
                                    self.active_gear_until = now + CONFIG['active_gear_duration']
                            elif now >= self.active_gear_until:
                                self.mode = 'idle'
                elif self.heartbeat_no_response_count >= 3:
                    wait = CONFIG['deep2_wait']
                    if now - last_hb >= CONFIG['idle_heartbeat_interval']:
                        if self.send_heartbeat():
                            self.heartbeat_no_response_count = 0
                            last_hb = now
                        else:
                            last_hb = now
                elif (now - last_job) >= CONFIG['idle_to_deep_threshold']:
                    wait = CONFIG['deep1_wait']
                    if now - last_hb >= CONFIG['idle_heartbeat_interval']:
                        if self.send_heartbeat():
                            self.heartbeat_no_response_count = 0
                            last_hb = now
                        else:
                            self.heartbeat_no_response_count += 1
                            if self.heartbeat_no_response_count >= 2:
                                logger.info("[HIBERNASYON] 2 cevapsız heartbeat -> 6 saat bekleme")
                            if self.heartbeat_no_response_count >= 3:
                                logger.info("[HIBERNASYON] 3 cevapsız -> 24 saat bekleme")
                            last_hb = now
                else:
                    wait = CONFIG['idle_wait']
                    if now - last_hb >= CONFIG['idle_heartbeat_interval']:
                        if self.send_heartbeat():
                            self.heartbeat_no_response_count = 0
                            last_hb = now
                        else:
                            self.heartbeat_no_response_count += 1
                            if self.heartbeat_no_response_count >= 2:
                                logger.info("[HIBERNASYON] 2 cevapsız heartbeat -> 6 saat bekleme")
                            if self.heartbeat_no_response_count >= 3:
                                logger.info("[HIBERNASYON] Derin uyku -> 24 saat bekleme")
                            last_hb = now
                    if self.mode == 'idle':
                        logger.info("[IDLE] %d sn sonra kontrol.", wait)

                self.wakeup_event.wait(timeout=wait)
                self.wakeup_event.clear()
        except KeyboardInterrupt:
            pass
        finally:
            self.running = False
            for _ in workers:
                self.job_queue.put(None)
            for t in workers:
                t.join(timeout=5)
            logger.info("BK-VF Agent v2 stopped")


def main():
    agent = BKVFAgentV2()

    def _on_sigterm(*_):
        logger.info("SIGTERM received. Stopping agent gracefully.")
        agent.running = False

    if hasattr(signal, 'SIGTERM'):
        try:
            signal.signal(signal.SIGTERM, _on_sigterm)
        except (ValueError, OSError):
            pass

    try:
        agent.run()
    except KeyboardInterrupt:
        agent.running = False


if __name__ == '__main__':
    main()
