// ============================================================
// 設定：GASの /exec URL
// ============================================================
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyBVswH3dx-jGkbEX-17JXNCjSLdae9sUvvjeG_m0CbSWbNCxkjGZuTC_VCyf8GBoD2RQ/exec';

// ============================================================
// 要素参照
// ============================================================
const els = {
  statusBanner: document.getElementById('status-banner'),
  stageBrand: document.getElementById('stage-brand'),
  videoWrap: document.getElementById('video-wrap'),
  videoFrame: document.getElementById('video-frame'),
  audioStage: document.getElementById('audio-stage'),
  audioStageTitle: document.getElementById('audio-stage-title'),
  audioEl: document.getElementById('audio-el'),
  stageInfo: document.getElementById('stage-info'),
  nowTitle: document.getElementById('now-title'),
  disc: document.querySelector('#audio-stage .disc'),
  waveform: document.querySelector('#audio-stage .waveform'),
  seekBar: document.getElementById('seek-bar'),
  seekCurrent: document.getElementById('seek-current'),
  seekDuration: document.getElementById('seek-duration'),

  trackCount: document.getElementById('track-count'),
  loadingState: document.getElementById('loading-state'),
  errorState: document.getElementById('error-state'),
  emptyState: document.getElementById('empty-state'),
  trackList: document.getElementById('track-list'),
  storageInfo: document.getElementById('storage-info'),
  clearBtn: document.getElementById('clear-btn'),
};

let tracks = [];
let currentTrackId = null;
let savedIds = new Set();

// ============================================================
// IndexedDB ヘルパー
// ============================================================
const DB_NAME = 'offlineMusicDB';
const STORE_NAME = 'tracks';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAllIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const ids = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        ids.push(cursor.key);
        cursor.continue();
      } else {
        resolve(ids);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// オンライン/オフライン表示
// ============================================================
function updateStatusBanner() {
  if (navigator.onLine) {
    els.statusBanner.classList.remove('show');
    els.statusBanner.textContent = '';
  } else {
    els.statusBanner.textContent = 'オフライン: 保存済みの音声のみ再生できます';
    els.statusBanner.classList.add('show');
  }
}
window.addEventListener('online', updateStatusBanner);
window.addEventListener('offline', updateStatusBanner);

// ============================================================
// プレイリスト読み込み
// ============================================================
async function loadPlaylist() {
  els.loadingState.style.display = 'block';
  els.errorState.style.display = 'none';
  els.emptyState.style.display = 'none';

  try {
    if (navigator.onLine) {
      const res = await fetch(`${GAS_URL}?action=list`);
      if (!res.ok) throw new Error('一覧の取得に失敗しました');
      const data = await res.json();
      tracks = data.tracks || [];
      localStorage.setItem('otobako_playlist_cache', JSON.stringify(tracks));
    } else {
      const cached = localStorage.getItem('otobako_playlist_cache');
      tracks = cached ? JSON.parse(cached) : [];
    }
  } catch (err) {
    const cached = localStorage.getItem('otobako_playlist_cache');
    if (cached) {
      tracks = JSON.parse(cached);
    } else {
      els.errorState.textContent = '一覧を取得できませんでした。通信環境を確認してください。';
      els.errorState.style.display = 'block';
      els.loadingState.style.display = 'none';
      return;
    }
  }

  savedIds = new Set(await dbGetAllIds());

  els.loadingState.style.display = 'none';
  els.trackCount.textContent = tracks.length > 0 ? `${tracks.length}曲` : '';

  if (tracks.length === 0) {
    els.emptyState.style.display = 'block';
    return;
  }
  renderTrackList();
  await updateStorageInfo();
}

// ============================================================
// 一覧描画
// ============================================================
function renderTrackList() {
  // 既存の行だけ削除（loading/error/emptyのstate要素は残す）
  els.trackList.querySelectorAll('.track-row').forEach((el) => el.remove());

  tracks.forEach((track, i) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.dataset.id = track.id;
    if (track.id === currentTrackId) row.classList.add('playing');

    const isSaved = savedIds.has(track.id);
    const hasAudio = !!track.audio;
    const hasVideo = !!track.video;

    let subText = '';
    if (hasVideo && hasAudio) subText = isSaved ? '映像・音声（保存済み）' : '映像・音声';
    else if (hasVideo) subText = '映像のみ';
    else if (hasAudio) subText = isSaved ? '音声のみ（保存済み）' : '音声のみ';

    row.innerHTML = `
      <div class="idx">${i + 1}</div>
      <div class="meta">
        <div class="name">${escapeHtml(track.title.trim())}</div>
        <div class="sub">${subText}</div>
      </div>
      <button class="action-btn ${isSaved ? 'saved' : ''}" data-id="${track.id}" ${hasAudio ? '' : 'disabled'} title="${isSaved ? 'オフラインで再生' : '音声を保存'}">
        ${isSaved ? '⏵' : '⬇'}
      </button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.action-btn')) return;
      playTrack(track.id);
    });

    const actionBtn = row.querySelector('.action-btn');
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSaved) {
        playTrackOffline(track.id);
      } else {
        saveTrack(track.id);
      }
    });

    els.trackList.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// 再生処理
// ============================================================
async function playTrack(trackId) {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return;

  currentTrackId = trackId;
  renderTrackList();

  els.stageBrand.classList.add('hidden');
  els.videoWrap.classList.remove('show');
  els.videoFrame.src = '';
  els.audioStage.classList.remove('show');
  els.disc.classList.remove('spin');
  els.audioEl.pause();
  els.audioEl.src = '';
  els.stageInfo.classList.add('show');
  els.nowTitle.textContent = track.title.trim();

  if (navigator.onLine && track.video) {
    els.videoFrame.src = `https://drive.google.com/file/d/${track.video.id}/preview`;
    els.videoWrap.classList.add('show');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    }
    return;
  }

  const saved = await dbGet(trackId);

  if (saved) {
    const url = URL.createObjectURL(saved.blob);
    setupAudioPlayer(url, track.title.trim());
    return;
  }

  if (navigator.onLine && track.audio) {
    els.audioStage.classList.add('show');
    els.audioStageTitle.textContent = '読み込み中…';
    try {
      const res = await fetch(`${GAS_URL}?action=stream&id=${track.audio.id}`);
      const data = await res.json();
      const blob = base64ToBlob(data.base64, data.mime);
      const url = URL.createObjectURL(blob);
      setupAudioPlayer(url, track.title.trim());
    } catch (err) {
      els.audioStageTitle.textContent = '取得に失敗しました';
    }
    return;
  }

  // オフラインかつ未保存
  els.audioStage.classList.add('show');
  els.audioStageTitle.textContent = `${track.title.trim()}\n（未保存のためオフラインで再生できません）`;
}

// 「オフラインで再生」ボタン用：オンライン中でも常に保存済み音声を再生する
async function playTrackOffline(trackId) {
  const track = tracks.find((t) => t.id === trackId);
  if (!track) return;

  const saved = await dbGet(trackId);
  if (!saved) return;

  currentTrackId = trackId;
  renderTrackList();

  els.stageBrand.classList.add('hidden');
  els.videoWrap.classList.remove('show');
  els.videoFrame.src = '';
  els.audioStage.classList.remove('show');
  els.disc.classList.remove('spin');
  els.audioEl.pause();
  els.audioEl.src = '';
  els.stageInfo.classList.add('show');
  els.nowTitle.textContent = track.title.trim();

  const url = URL.createObjectURL(saved.blob);
  setupAudioPlayer(url, track.title.trim());
}

function setupAudioPlayer(url, title) {
  els.audioStage.classList.add('show');
  els.audioStageTitle.textContent = title;

  els.audioEl.src = url;
  els.audioEl.play().catch(() => {});

  els.disc.classList.add('spin');
  els.waveform.classList.remove('paused');

  els.audioEl.onpause = () => {
    els.disc.classList.remove('spin');
    els.waveform.classList.add('paused');
  };
  els.audioEl.onplay = () => {
    els.disc.classList.add('spin');
    els.waveform.classList.remove('paused');
  };

  // 再生終了時、保存済みの次の曲へ自動で進む
  els.audioEl.onended = () => {
    playAdjacentSavedTrack(1);
  };

  // シークバー: 再生位置に合わせて更新
  els.audioEl.onloadedmetadata = () => {
    els.seekBar.max = els.audioEl.duration || 0;
    els.seekDuration.textContent = formatTime(els.audioEl.duration);
  };
  els.audioEl.ontimeupdate = () => {
    if (!isSeeking) {
      els.seekBar.value = els.audioEl.currentTime;
    }
    els.seekCurrent.textContent = formatTime(els.audioEl.currentTime);
  };
  els.seekBar.value = 0;
  els.seekCurrent.textContent = '0:00';
  els.seekDuration.textContent = '0:00';

  updateMediaSession(title);
}

// シークバー操作
let isSeeking = false;
els.seekBar.addEventListener('input', () => {
  isSeeking = true;
  els.seekCurrent.textContent = formatTime(parseFloat(els.seekBar.value));
});
els.seekBar.addEventListener('change', () => {
  els.audioEl.currentTime = parseFloat(els.seekBar.value);
  isSeeking = false;
});

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ============================================================
// バックグラウンド再生対応（Media Session API）
// 画面ロック・通知欄から再生中の曲を表示・操作できるようにする
// ============================================================
function updateMediaSession(title) {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: title,
    artist: 'Otobako',
    album: '保存済みの音声',
    artwork: [
      { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
    ]
  });

  navigator.mediaSession.setActionHandler('play', () => {
    els.audioEl.play().catch(() => {});
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    els.audioEl.pause();
  });
  navigator.mediaSession.setActionHandler('previoustrack', () => {
    playAdjacentSavedTrack(-1);
  });
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    playAdjacentSavedTrack(1);
  });
  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    els.audioEl.currentTime = Math.max(0, els.audioEl.currentTime - (details.seekOffset || 10));
  });
  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    els.audioEl.currentTime = Math.min(els.audioEl.duration || Infinity, els.audioEl.currentTime + (details.seekOffset || 10));
  });
}

// 保存済みの曲の中で、現在再生中の曲の前後にある曲を再生する
function playAdjacentSavedTrack(direction) {
  const savedTracks = tracks.filter((t) => savedIds.has(t.id));
  if (savedTracks.length === 0) return;

  const currentIndex = savedTracks.findIndex((t) => t.id === currentTrackId);
  let nextIndex;
  if (currentIndex === -1) {
    nextIndex = 0;
  } else {
    nextIndex = (currentIndex + direction + savedTracks.length) % savedTracks.length;
  }

  playTrack(savedTracks[nextIndex].id);
}

function base64ToBlob(base64, mime) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: mime });
}

// ============================================================
// 保存
// ============================================================
async function saveTrack(trackId) {
  const track = tracks.find((t) => t.id === trackId);
  if (!track || !track.audio) return;

  if (!navigator.onLine) {
    alert('保存にはオンライン環境が必要です');
    return;
  }

  const btn = els.trackList.querySelector(`.action-btn[data-id="${trackId}"]`);
  if (btn) {
    btn.textContent = '…';
    btn.disabled = true;
  }

  try {
    const res = await fetch(`${GAS_URL}?action=stream&id=${track.audio.id}`);
    const data = await res.json();
    const blob = base64ToBlob(data.base64, data.mime);

    await dbPut({
      id: trackId,
      title: track.title.trim(),
      mime: data.mime,
      blob: blob,
      savedAt: Date.now()
    });

    savedIds.add(trackId);
    renderTrackList();
    await updateStorageInfo();
  } catch (err) {
    alert('保存に失敗しました');
    if (btn) {
      btn.textContent = '⬇';
      btn.disabled = false;
    }
  }
}

els.clearBtn.addEventListener('click', async () => {
  if (!confirm('保存した音声をすべて削除しますか？')) return;
  await dbClearAll();
  savedIds.clear();
  renderTrackList();
  await updateStorageInfo();
});

// ============================================================
// 保存容量の表示
// ============================================================
async function updateStorageInfo() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      els.storageInfo.textContent = `保存容量: 約${formatBytes(usage)} (${savedIds.size}曲)`;
      return;
    } catch (e) {
      // fallthrough
    }
  }
  els.storageInfo.textContent = `保存済み: ${savedIds.size}曲`;
}

function formatBytes(bytes) {
  if (!bytes) return '0MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

// ============================================================
// Service Worker 登録
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ============================================================
// 初期化
// ============================================================
updateStatusBanner();
loadPlaylist();
