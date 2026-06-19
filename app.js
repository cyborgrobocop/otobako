// ============================================================
// 認証設定（SHA-256ハッシュ値。元の文字列はここには存在しない）
// ============================================================
const AUTH = {
  idHash: '5b58364478de8d6689f717a7a8a839f8c0fe16cf76e6fa55b0a959be623e7de4',
  pwHash: '6b9c0cacfa675d11684a0aaf62cb731e4dcd29943c88544320f477e8086edc8f',
};

// ============================================================
// プレイリストの場所
// ============================================================
const PLAYLIST_URL = './music/playlist.json';

// ============================================================
// SHA-256ハッシュ生成（Web Crypto API）
// ============================================================
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// ログイン処理
// ============================================================
const loginScreen = document.getElementById('login-screen');
const appEl       = document.getElementById('app');
const loginIdEl   = document.getElementById('login-id');
const loginPwEl   = document.getElementById('login-pw');
const loginBtn    = document.getElementById('login-btn');
const loginError  = document.getElementById('login-error');

// セッションストレージでログイン状態を保持（タブを閉じるとリセット）
function isLoggedIn() {
  return localStorage.getItem('otobako_auth') === '1';
}

function showApp() {
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  loadPlaylist();
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  appEl.classList.add('hidden');
}

loginBtn.addEventListener('click', attemptLogin);
loginPwEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptLogin();
});
loginIdEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginPwEl.focus();
});

async function attemptLogin() {
  const idVal = loginIdEl.value.trim();
  const pwVal = loginPwEl.value;

  if (!idVal || !pwVal) {
    loginError.textContent = 'IDとパスワードを入力してください';
    return;
  }

  loginBtn.textContent = '確認中…';
  loginBtn.disabled = true;
  loginError.textContent = '';

  const [idH, pwH] = await Promise.all([sha256(idVal), sha256(pwVal)]);

  // 一定時間待つ（総当たり対策・UX的にも自然）
  await new Promise(r => setTimeout(r, 400));

  if (idH === AUTH.idHash && pwH === AUTH.pwHash) {
    localStorage.setItem('otobako_auth', '1');
    showApp();
  } else {
    loginError.textContent = 'IDまたはパスワードが正しくありません';
    loginPwEl.value = '';
    loginPwEl.focus();
  }

  loginBtn.textContent = 'ログイン';
  loginBtn.disabled = false;
}

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('otobako_auth');
  els.audioEl.pause();
  stopVisualizer();
  showLogin();
});

// 起動時にログイン済みかチェック
if (isLoggedIn()) {
  showApp();
} else {
  showLogin();
}

// ============================================================
// 要素参照
// ============================================================
const els = {
  statusBanner: document.getElementById('status-banner'),
  visualizer:   document.getElementById('visualizer'),
  nowTitle:     document.getElementById('now-title'),
  nowArtist:    document.getElementById('now-artist'),
  seekBar:      document.getElementById('seek-bar'),
  seekCurrent:  document.getElementById('seek-current'),
  seekDuration: document.getElementById('seek-duration'),
  backBtn:      document.getElementById('back-btn'),
  playBtn:      document.getElementById('play-btn'),
  playIcon:     document.getElementById('play-icon'),
  playLabel:    document.getElementById('play-label'),
  fwdBtn:       document.getElementById('fwd-btn'),
  shuffleBtn:   document.getElementById('shuffle-btn'),
  shuffleLabel: document.getElementById('shuffle-label'),
  audioEl:      document.getElementById('audio-el'),
  trackCount:   document.getElementById('track-count'),
  loadingState: document.getElementById('loading-state'),
  errorState:   document.getElementById('error-state'),
  emptyState:   document.getElementById('empty-state'),
  trackList:    document.getElementById('track-list'),
  storageInfo:  document.getElementById('storage-info'),
  clearBtn:     document.getElementById('clear-btn'),
};

let tracks = [];
let currentTrackId = null;
let savedIds = new Set();

// ============================================================
// ビジュアライザー（Web Audio API・音に反応する円形）
// フォアグラウンド時のみ動作。バックグラウンド時は自動停止し
// <audio>要素が直接OSのメディアセッションを担当するため
// バックグラウンド再生は維持される。
// ============================================================
let audioCtx = null;
let analyser = null;
let source = null;
let vizAnimId = null;
let isVisualizerRunning = false;

function initAudioContext() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.82;
    // <audio>とAnalyserを繋ぐ（出力先はAnalyser経由でdestinationへ）
    source = audioCtx.createMediaElementSource(els.audioEl);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch (e) {
    audioCtx = null;
  }
}

// バックグラウンド時はvisibilitychangeでCanvasのrAFを止める
// （<audio>の再生は止めない）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // バックグラウンド: ビジュアライザーのアニメーションだけ止める
    if (vizAnimId) { cancelAnimationFrame(vizAnimId); vizAnimId = null; }
    isVisualizerRunning = false;
  } else {
    // フォアグラウンド復帰: 再生中ならビジュアライザー再開
    if (!els.audioEl.paused) startVisualizer();
  }
});

function startVisualizer() {
  if (isVisualizerRunning) return;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  isVisualizerRunning = true;
  drawFrame();
}

function stopVisualizer() {
  isVisualizerRunning = false;
  if (vizAnimId) { cancelAnimationFrame(vizAnimId); vizAnimId = null; }
  drawIdle();
}

function drawIdle() {
  const canvas = els.visualizer;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const baseR = W * 0.28;
  const bars = 48;

  ctx.clearRect(0, 0, W, H);

  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR);
  grd.addColorStop(0, 'rgba(217, 162, 75, 0.18)');
  grd.addColorStop(1, 'rgba(217, 162, 75, 0.03)');
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, baseR + 18, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(217, 162, 75, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * (baseR + 2);
    const y1 = cy + Math.sin(angle) * (baseR + 2);
    const x2 = cx + Math.cos(angle) * (baseR + 6);
    const y2 = cy + Math.sin(angle) * (baseR + 6);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = 'rgba(217, 162, 75, 0.25)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function drawFrame() {
  if (!isVisualizerRunning) return;
  vizAnimId = requestAnimationFrame(drawFrame);

  const canvas = els.visualizer;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const baseR = W * 0.28;
  const bars = 48;

  // analyserがない場合はアイドル表示
  if (!analyser) { drawIdle(); return; }

  const dataArr = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(dataArr);

  ctx.clearRect(0, 0, W, H);

  const avgVol = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;

  const glowR = baseR * (0.9 + (avgVol / 255) * 0.2);
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  grd.addColorStop(0, `rgba(217, 162, 75, ${0.12 + (avgVol / 255) * 0.22})`);
  grd.addColorStop(1, 'rgba(217, 162, 75, 0.02)');
  ctx.beginPath();
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(217, 162, 75, 0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  for (let i = 0; i < bars; i++) {
    const dataIndex = Math.floor((i / bars) * dataArr.length * 0.75);
    const val = dataArr[dataIndex] / 255;
    const barH = 5 + val * (W * 0.30);
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;

    const hue = 30 + val * 20;
    const lightness = 55 + val * 15;
    const alpha = 0.45 + val * 0.55;

    const x1 = cx + Math.cos(angle) * (baseR + 3);
    const y1 = cy + Math.sin(angle) * (baseR + 3);
    const x2 = cx + Math.cos(angle) * (baseR + 3 + barH);
    const y2 = cy + Math.sin(angle) * (baseR + 3 + barH);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = `hsla(${hue}, 85%, ${lightness}%, ${alpha})`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// ============================================================
// IndexedDB
// ============================================================
const DB_NAME = 'offlineMusicDB';
const STORE_NAME = 'tracks';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAllIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const ids = [];
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (c) { ids.push(c.key); c.continue(); } else resolve(ids);
    };
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
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
// オンライン/オフライン
// ============================================================
function updateStatusBanner() {
  if (navigator.onLine) {
    els.statusBanner.classList.remove('show');
  } else {
    els.statusBanner.textContent = 'オフライン: 保存済みの曲のみ再生できます';
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
    const res = await fetch(PLAYLIST_URL);
    if (!res.ok) throw new Error();
    const data = await res.json();
    tracks = data.tracks || [];
    localStorage.setItem('otobako_playlist', JSON.stringify(tracks));
  } catch {
    const cached = localStorage.getItem('otobako_playlist');
    if (cached) {
      tracks = JSON.parse(cached);
    } else {
      els.errorState.textContent = 'プレイリストを取得できませんでした。';
      els.errorState.style.display = 'block';
      els.loadingState.style.display = 'none';
      return;
    }
  }

  savedIds = new Set(await dbGetAllIds());
  els.loadingState.style.display = 'none';
  els.trackCount.textContent = `${tracks.length}曲`;
  if (tracks.length === 0) { els.emptyState.style.display = 'block'; return; }
  renderTrackList();
  await updateStorageInfo();
  drawIdle();
}

// ============================================================
// 一覧描画
// ============================================================
function renderTrackList() {
  els.trackList.querySelectorAll('.track-row').forEach(el => el.remove());

  tracks.forEach((track, i) => {
    const isSaved = savedIds.has(track.id);
    const row = document.createElement('div');
    row.className = 'track-row' + (track.id === currentTrackId ? ' playing' : '');
    row.dataset.id = track.id;

    row.innerHTML = `
      <div class="idx">${i + 1}</div>
      <div class="meta">
        <div class="name">${escapeHtml(track.title)}</div>
        <div class="sub">${isSaved ? '保存済み' : 'オンライン再生'}</div>
      </div>
      <button class="action-btn ${isSaved ? 'saved' : ''}" data-id="${track.id}"
        title="${isSaved ? 'オフラインで再生' : '保存'}">
        ${isSaved ? '⏵' : '⬇'}
      </button>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.action-btn')) return;
      playTrack(track.id);
    });

    row.querySelector('.action-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      isSaved ? playTrackOffline(track.id) : saveTrack(track.id);
    });

    els.trackList.appendChild(row);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ============================================================
// 再生（オンライン）
// ============================================================
async function playTrack(trackId) {
  const track = tracks.find(t => t.id === trackId);
  if (!track) return;

  const saved = await dbGet(trackId);
  if (saved) { playTrackOffline(trackId); return; }

  if (!navigator.onLine) { alert('オフラインです。先に保存してください。'); return; }

  currentTrackId = trackId;
  renderTrackList();
  els.nowTitle.textContent = track.title;
  els.nowArtist.textContent = track.artist || '';
  updateStageBg(track);

  initAudioContext();
  els.audioEl.src = track.file;
  els.audioEl.play().catch(() => {});
  startVisualizer();
  updateMediaSession(track);
}

// ============================================================
// 再生（オフライン/保存済み）
// ============================================================
async function playTrackOffline(trackId) {
  const track = tracks.find(t => t.id === trackId);
  if (!track) return;

  const saved = await dbGet(trackId);
  if (!saved) return;

  currentTrackId = trackId;
  renderTrackList();
  els.nowTitle.textContent = track.title;
  els.nowArtist.textContent = track.artist || '';
  updateStageBg(track);

  initAudioContext();
  els.audioEl.src = URL.createObjectURL(saved.blob);
  els.audioEl.play().catch(() => {});
  startVisualizer();
  updateMediaSession(track);
}

// ============================================================
// コントロール
// ============================================================
els.playBtn.addEventListener('click', () => {
  if (!els.audioEl.src) return;
  els.audioEl.paused ? els.audioEl.play().catch(() => {}) : els.audioEl.pause();
});

els.backBtn.addEventListener('click', () => {
  els.audioEl.currentTime = Math.max(0, els.audioEl.currentTime - 5);
});

els.fwdBtn.addEventListener('click', () => {
  els.audioEl.currentTime = Math.min(els.audioEl.duration || 0, els.audioEl.currentTime + 5);
});

els.audioEl.addEventListener('play', () => {
  els.playIcon.textContent = '⏸';
  els.playLabel.textContent = '一時停止';
  startVisualizer();
});

els.audioEl.addEventListener('pause', () => {
  els.playIcon.textContent = '▶';
  els.playLabel.textContent = '再生';
  stopVisualizer();
});

els.audioEl.addEventListener('ended', () => {
  stopVisualizer();
  playAdjacentTrack(1);
});

// ============================================================
// シークバー
// ============================================================
let isSeeking = false;

els.audioEl.addEventListener('loadedmetadata', () => {
  els.seekBar.max = els.audioEl.duration || 0;
  els.seekDuration.textContent = formatTime(els.audioEl.duration);
});

els.audioEl.addEventListener('timeupdate', () => {
  if (!isSeeking) {
    els.seekBar.value = els.audioEl.currentTime;
    els.seekCurrent.textContent = formatTime(els.audioEl.currentTime);
  }
});

els.seekBar.addEventListener('input', () => {
  isSeeking = true;
  els.seekCurrent.textContent = formatTime(parseFloat(els.seekBar.value));
});

els.seekBar.addEventListener('change', () => {
  els.audioEl.currentTime = parseFloat(els.seekBar.value);
  isSeeking = false;
});

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ============================================================
// ============================================================
// 前後の曲 / シャッフル
// ============================================================
let isShuffleOn = false;

function playAdjacentTrack(dir) {
  if (tracks.length === 0) return;
  if (isShuffleOn) {
    // シャッフルON: 現在の曲以外からランダムに選ぶ
    const others = tracks.filter(t => t.id !== currentTrackId);
    const next = others.length > 0
      ? others[Math.floor(Math.random() * others.length)]
      : tracks[0];
    playTrack(next.id);
  } else {
    const idx = tracks.findIndex(t => t.id === currentTrackId);
    if (idx === -1) return;
    playTrack(tracks[(idx + dir + tracks.length) % tracks.length].id);
  }
}

els.shuffleBtn.addEventListener('click', () => {
  isShuffleOn = !isShuffleOn;
  els.shuffleBtn.classList.toggle('active', isShuffleOn);
  els.shuffleLabel.textContent = isShuffleOn ? 'ON' : 'シャッフル';
});

// ============================================================
// Media Session（バックグラウンド再生）
// ============================================================
// ============================================================
// 背景画像切り替え（曲ごと）
// ============================================================
function updateStageBg(track) {
  const stage = document.getElementById('stage');
  if (track.bg) {
    stage.style.backgroundImage = `url('${track.bg}')`;
  } else {
    stage.style.backgroundImage = '';
  }
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || 'Otobako',
    artwork: [
      { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
    ]
  });
  navigator.mediaSession.setActionHandler('play',  () => els.audioEl.play().catch(() => {}));
  navigator.mediaSession.setActionHandler('pause', () => els.audioEl.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => playAdjacentTrack(-1));
  navigator.mediaSession.setActionHandler('nexttrack',     () => playAdjacentTrack(1));
  navigator.mediaSession.setActionHandler('seekbackward', d => {
    els.audioEl.currentTime = Math.max(0, els.audioEl.currentTime - (d.seekOffset || 5));
  });
  navigator.mediaSession.setActionHandler('seekforward', d => {
    els.audioEl.currentTime = Math.min(els.audioEl.duration || 0, els.audioEl.currentTime + (d.seekOffset || 5));
  });
}

// ============================================================
// 保存
// ============================================================
async function saveTrack(trackId) {
  const track = tracks.find(t => t.id === trackId);
  if (!track) return;
  if (!navigator.onLine) { alert('保存にはオンライン環境が必要です'); return; }

  const btn = els.trackList.querySelector(`.action-btn[data-id="${trackId}"]`);
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  try {
    const res = await fetch(track.file);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    await dbPut({ id: trackId, title: track.title, blob, savedAt: Date.now() });
    savedIds.add(trackId);
    renderTrackList();
    await updateStorageInfo();
  } catch {
    alert('保存に失敗しました');
    if (btn) { btn.textContent = '⬇'; btn.disabled = false; }
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
// 保存容量
// ============================================================
async function updateStorageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage } = await navigator.storage.estimate();
      els.storageInfo.textContent = `保存容量: 約${formatBytes(usage)} (${savedIds.size}曲)`;
      return;
    }
  } catch { /**/ }
  els.storageInfo.textContent = `保存済み: ${savedIds.size}曲`;
}

function formatBytes(bytes) {
  if (!bytes) return '0MB';
  const mb = bytes / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(1)}MB` : `${(mb / 1024).toFixed(2)}GB`;
}

// ============================================================
// Service Worker
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

updateStatusBanner();
