// ============================================================
// 設定：GASの /exec URL をここに設定してください
// ============================================================
const GAS_URL = 'ここに GAS の /exec URL を入れる';

// ============================================================
// 要素参照
// ============================================================
const els = {
  statusBanner: document.getElementById('status-banner'),
  nowPlayingName: document.getElementById('now-playing-name'),
  mediaFrame: document.getElementById('media-frame'),
  audioEl: document.getElementById('audio-el'),
  playerControls: document.getElementById('player-controls'),
  loadingState: document.getElementById('loading-state'),
  errorState: document.getElementById('error-state'),
  emptyState: document.getElementById('empty-state'),
  trackList: document.getElementById('track-list'),
  storageInfo: document.getElementById('storage-info'),
  clearBtn: document.getElementById('clear-btn'),
};

let tracks = [];
let currentTrackId = null;
let savedIds = new Set(); // IndexedDBに保存済みのトラックID

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
    els.statusBanner.classList.remove('show', 'offline');
    els.statusBanner.textContent = '';
  } else {
    els.statusBanner.textContent = 'オフライン: 保存済みの音声のみ再生できます';
    els.statusBanner.classList.add('show', 'offline');
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
      // 取得できた一覧はオフライン時のためにローカルへ保持
      localStorage.setItem('otobako_playlist_cache', JSON.stringify(tracks));
    } else {
      // オフライン時はキャッシュした一覧を使う
      const cached = localStorage.getItem('otobako_playlist_cache');
      tracks = cached ? JSON.parse(cached) : [];
    }
  } catch (err) {
    // 通信失敗時もキャッシュがあれば使う
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
  els.trackList.innerHTML = '';
  tracks.forEach((track) => {
    const card = document.createElement('div');
    card.className = 'track-card';
    card.dataset.id = track.id;
    if (track.id === currentTrackId) card.classList.add('playing');

    const isSaved = savedIds.has(track.id);
    const hasAudio = !!track.audio;
    const hasVideo = !!track.video;

    card.innerHTML = `
      <div class="play-icon">${track.id === currentTrackId ? '♪' : '▶'}</div>
      <div class="meta">
        <div class="name">${escapeHtml(track.title)}</div>
        <div class="sub">
          ${hasVideo ? '<span class="badge">映像あり</span>' : '<span class="badge">映像なし</span>'}
          ${hasAudio ? (isSaved ? '<span class="badge saved">保存済み</span>' : '<span class="badge">音声あり</span>') : '<span class="badge">音声なし</span>'}
        </div>
      </div>
      <button class="save-btn ${isSaved ? 'saved' : ''}" data-id="${track.id}" ${hasAudio ? '' : 'disabled'} title="音声を保存">
        ${isSaved ? '✓' : '⬇'}
      </button>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.save-btn')) return; // 保存ボタンは別処理
      playTrack(track.id);
    });

    const saveBtn = card.querySelector('.save-btn');
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSave(track.id);
    });

    els.trackList.appendChild(card);
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
  els.nowPlayingName.textContent = track.title;
  renderTrackList();

  // 既存の再生を止める
  els.audioEl.pause();
  els.audioEl.src = '';
  els.audioEl.classList.add('hidden');
  els.mediaFrame.innerHTML = '';
  els.mediaFrame.classList.remove('audio-only');
  els.playerControls.innerHTML = '';

  if (navigator.onLine && track.video) {
    // ---- オンライン: 動画をDrive iframeで埋め込み ----
    const iframe = document.createElement('iframe');
    iframe.src = `https://drive.google.com/file/d/${track.video.id}/preview`;
    iframe.setAttribute('allow', 'autoplay');
    els.mediaFrame.appendChild(iframe);
    els.playerControls.innerHTML = `<span class="pill on">映像再生中（オンライン）</span>`;
    return;
  }

  // ---- オフライン、または映像なし: 音声再生 ----
  const saved = await dbGet(trackId);

  if (saved) {
    const url = URL.createObjectURL(saved.blob);
    setupAudioPlayer(url, '保存した音声を再生中');
    return;
  }

  if (navigator.onLine && track.audio) {
    // 未保存だがオンライン: GAS経由でストリーム取得して再生（保存はしない）
    els.playerControls.innerHTML = `<span class="pill">読み込み中…</span>`;
    try {
      const res = await fetch(`${GAS_URL}?action=stream&id=${track.audio.id}`);
      const data = await res.json();
      const blob = base64ToBlob(data.base64, data.mime);
      const url = URL.createObjectURL(blob);
      setupAudioPlayer(url, '音声を再生中（オンライン）');
    } catch (err) {
      els.playerControls.innerHTML = `<span class="pill">音声の取得に失敗しました</span>`;
    }
    return;
  }

  // オフラインかつ未保存
  els.mediaFrame.classList.add('audio-only');
  els.mediaFrame.innerHTML = buildWaveform(true);
  els.playerControls.innerHTML = `<span class="pill">オフラインのため再生できません（未保存）</span>`;
}

function setupAudioPlayer(url, label) {
  els.mediaFrame.classList.add('audio-only');
  els.mediaFrame.innerHTML = buildWaveform(false);

  els.audioEl.src = url;
  els.audioEl.classList.remove('hidden');
  els.audioEl.play().catch(() => {});

  els.playerControls.innerHTML = `<span class="pill on">${label}</span>`;

  const waveform = els.mediaFrame.querySelector('.waveform');
  els.audioEl.onplay = () => waveform && waveform.classList.remove('paused');
  els.audioEl.onpause = () => waveform && waveform.classList.add('paused');
}

function buildWaveform(paused) {
  return `<div class="waveform ${paused ? 'paused' : ''}">
    ${Array.from({ length: 7 }).map(() => '<div class="bar"></div>').join('')}
  </div>`;
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
// 保存 / 削除
// ============================================================
async function toggleSave(trackId) {
  const track = tracks.find((t) => t.id === trackId);
  if (!track || !track.audio) return;

  if (savedIds.has(trackId)) {
    await dbDelete(trackId);
    savedIds.delete(trackId);
    renderTrackList();
    await updateStorageInfo();
    return;
  }

  if (!navigator.onLine) {
    alert('保存にはオンライン環境が必要です');
    return;
  }

  const btn = els.trackList.querySelector(`.save-btn[data-id="${trackId}"]`);
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
      title: track.title,
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
