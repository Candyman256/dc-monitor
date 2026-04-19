/* ============================================================
   DC Monitor — app.js
   Mobile-first data center monitoring report tool
   ============================================================ */

(() => {
'use strict';

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  fbBase: 'https://bou-dc-monitor-default-rtdb.firebaseio.com',
  geminiModel: 'gemini-1.5-flash',
  geminiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
  maxPhotoEdge: 1600,
  photoQuality: 0.85,
  maxThumbnails: 12,
  autoSaveInterval: 500,
  historyMax: 10,
  qrExpirySec: 120,
};

const LS_KEYS = {
  pin: 'dcm.pin',
  apiKey: 'dcm.geminiKey',
  author: 'dcm.author',
  mailTo: 'dcm.mailTo',
  draft: 'dcm.draft',
  queue: 'dcm.queue',
  history: 'dcm.history',
};

const HQ_CHECKS = ['Access Control', 'Lighting', 'Security Cameras', 'Fire Suppression', 'Clutter & Cleanliness'];
const BRS_CHECKS = ['Access Control', 'Lighting', 'Security Cameras', 'Fire Suppression', 'UPS Room Temp', 'Clutter & Cleanliness'];
const UPS_PARAMS = [
  { key: 'input', label: 'Input (V)', threePhase: true, type: 'voltage' },
  { key: 'output', label: 'Output (V)', threePhase: true, type: 'voltage' },
  { key: 'current', label: 'Current (A)', threePhase: true, type: 'current' },
  { key: 'load', label: 'Load (%)', threePhase: true, type: 'percent' },
  { key: 'power', label: 'Power (kW)', threePhase: true, type: 'kw' },
  { key: 'batVoltage', label: 'Bat. Voltage (V)', threePhase: false, type: 'batVoltage' },
  { key: 'batCurrent', label: 'Bat. Current (A)', threePhase: false, type: 'current' },
  { key: 'batCapacity', label: 'Bat. Capacity (%)', threePhase: false, type: 'percent' },
  { key: 'runtime', label: 'Runtime (min)', threePhase: false, type: 'runtime' },
  { key: 'frequency', label: 'Frequency (Hz)', threePhase: false, type: 'frequency' },
  { key: 'upsTemp', label: 'UPS Temp (°C)', threePhase: false, type: 'temp' },
];

// Validation ranges (min, max, warnBelow, warnAbove)
const VAL = {
  temp: { min: 10, max: 40, ok: [18, 24] },
  voltage: { min: 180, max: 260, ok: [220, 245] },
  batVoltage: { min: 0, max: 600, ok: [200, 450] },
  current: { min: 0, max: 500, ok: [0, 400] },
  percent: { min: 0, max: 100, ok: [0, 100] },
  frequency: { min: 45, max: 55, ok: [49.5, 50.5] },
  kw: { min: 0, max: 500, ok: [0, 400] },
  runtime: { min: 0, max: 9999, ok: [15, 9999] },
};

// ============================================================
// STATE
// ============================================================
const S = {
  pin: null,
  date: null,
  sessionKey: null,
  apiKey: null,
  author: '',
  mailTo: '',
  online: navigator.onLine,
  photos: { hq: [], brs: [] },
  readings: null, // populated at step 2
  activeTab: 'hq',
  currentStep: 1,
  sseSource: null,
  autoSaveTimer: null,
  qrTimer: null,
};

function initReadings() {
  S.readings = {
    hq: {
      ahu: [
        { temp: '', status: 'ok', fromAi: false },
        { temp: '', status: 'ok', fromAi: false },
        { temp: '', status: 'ok', fromAi: false },
      ],
      ups: {
        'UPS A': createUpsData(),
        'UPS B': createUpsData(),
      },
      checks: HQ_CHECKS.reduce((a, c) => (a[c] = 'ok', a), {}),
    },
    brs: {
      ahu: [
        { temp: '', status: 'ok', fromAi: false },
        { temp: '', status: 'ok', fromAi: false },
        { temp: '', status: 'ok', fromAi: false },
      ],
      ups: {
        'UPS 1': createUpsData(),
        'UPS 2': createUpsData(),
      },
      checks: BRS_CHECKS.reduce((a, c) => (a[c] = 'ok', a), {}),
    },
    alert: { title: '', desc: '', owner: '' },
  };
}

function createUpsData() {
  const d = {};
  UPS_PARAMS.forEach(p => {
    if (p.threePhase) d[p.key] = { L1: '', L2: '', L3: '', fromAi: false };
    else d[p.key] = { value: '', fromAi: false };
  });
  return d;
}

// ============================================================
// UTILITIES
// ============================================================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${parseInt(d,10)} ${months[parseInt(m,10)-1]} ${y}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, level = 'info', ms = 2500) {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.level = level;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

function openSheet(id) {
  $(id).hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet(id) {
  $(id).hidden = true;
  document.body.style.overflow = '';
}

// Load external script (lazy)
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  // Check for setup URL in query string (device handoff)
  const params = new URLSearchParams(location.search);
  if (params.has('setup')) {
    try {
      const decoded = atob(params.get('setup'));
      const data = JSON.parse(decoded);
      if (data.p && data.k) {
        // Show confirmation
        const ok = confirm('Load PIN and Gemini API key from setup link onto this device?');
        if (ok) {
          localStorage.setItem(LS_KEYS.pin, data.p);
          localStorage.setItem(LS_KEYS.apiKey, data.k);
          toast('Credentials loaded from setup link', 'success');
        }
      }
      // Remove query string so it doesn't reappear
      history.replaceState({}, '', location.pathname);
    } catch (e) {
      console.warn('Bad setup URL', e);
    }
  }

  // Register service worker (non-blocking)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Set up global listeners
  setupNetListeners();
  setupSheetListeners();
  setupPasteAndDrop();
  setupTabs();
  setupStepNav();
  setupMenu();
  setupSetupFlow();

  // Remove boot overlay
  document.body.style.background = '';
  const boot = $('#boot');
  if (boot) boot.remove();

  // Route to appropriate screen
  const savedPin = localStorage.getItem(LS_KEYS.pin);
  if (!savedPin) {
    showPinScreen();
  } else {
    S.pin = savedPin;
    S.date = todayStr();
    S.sessionKey = await sha256Hex(S.pin + '|' + S.date);
    const apiKey = localStorage.getItem(LS_KEYS.apiKey);
    if (!apiKey) {
      showKeyScreen();
    } else {
      S.apiKey = apiKey;
      enterApp();
    }
  }
}

// ============================================================
// PIN FLOW
// ============================================================
function showPinScreen() {
  hideAll();
  $('#screenPin').hidden = false;
  const input = $('#pinInput');
  input.focus();
  $('#pinSubmit').onclick = submitPin;
  $('#pinEye').onclick = () => togglePwd(input);
  input.onkeydown = e => { if (e.key === 'Enter') submitPin(); };
}

async function submitPin() {
  const v = $('#pinInput').value.trim();
  if (v.length < 4) {
    toast('PIN must be at least 4 digits', 'error');
    return;
  }
  S.pin = v;
  S.date = todayStr();
  S.sessionKey = await sha256Hex(S.pin + '|' + S.date);
  localStorage.setItem(LS_KEYS.pin, v);

  const apiKey = localStorage.getItem(LS_KEYS.apiKey);
  if (!apiKey) {
    showKeyScreen();
  } else {
    S.apiKey = apiKey;
    enterApp();
  }
}

function togglePwd(input) {
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ============================================================
// API KEY FLOW
// ============================================================
function showKeyScreen() {
  hideAll();
  $('#screenKey').hidden = false;
  const input = $('#keyInput');
  input.focus();
  $('#keySubmit').onclick = submitKey;
  $('#keySkip').onclick = () => { S.apiKey = null; enterApp(); };
  $('#keyEye').onclick = () => togglePwd(input);
  input.onkeydown = e => { if (e.key === 'Enter') submitKey(); };
}

function submitKey() {
  const v = $('#keyInput').value.trim();
  if (!v) {
    toast('Enter a Gemini API key or tap Skip', 'error');
    return;
  }
  if (!v.startsWith('AIza')) {
    const go = confirm("That doesn't look like a typical Gemini API key (usually starts with 'AIza'). Continue anyway?");
    if (!go) return;
  }
  S.apiKey = v;
  localStorage.setItem(LS_KEYS.apiKey, v);
  enterApp();
}

function hideAll() {
  $$('.screen, .app').forEach(el => el.hidden = true);
}

// Setup URL flow (receiver side is in boot; sender side is QR share)
function setupSetupFlow() {
  $('#setupUrlApply').onclick = () => {
    const url = $('#setupUrlInput').value.trim();
    try {
      const u = new URL(url);
      const setup = u.searchParams.get('setup');
      if (!setup) throw new Error('No setup parameter');
      const data = JSON.parse(atob(setup));
      if (!data.p || !data.k) throw new Error('Invalid payload');
      localStorage.setItem(LS_KEYS.pin, data.p);
      localStorage.setItem(LS_KEYS.apiKey, data.k);
      toast('Credentials loaded — continue with PIN', 'success');
      $('#pinInput').value = data.p;
    } catch (e) {
      toast('Invalid setup URL', 'error');
    }
  };
}

// ============================================================
// APP ENTRY
// ============================================================
async function enterApp() {
  hideAll();
  initReadings();

  // Populate defaults
  $('#reportDate').value = S.date;
  S.author = localStorage.getItem(LS_KEYS.author) || '';
  S.mailTo = localStorage.getItem(LS_KEYS.mailTo) || 'alfred@bou.or.ug';
  $('#reportAuthor').value = S.author;

  // Update header pin chip
  $('#openMenu .pin-chip-label').textContent = 'PIN ' + '•'.repeat(Math.min(4, S.pin.length));

  $('#app').hidden = false;
  gotoStep(1);

  // Render review structure (hidden until step 2, but built now)
  renderReviewUI();

  // Field listeners for auto-save
  wireFieldListeners();

  // Upload listeners
  wireUploadListeners();

  // Step 3 actions
  wireSendActions();

  // Start Firebase listener for BRS photos
  startFirebaseListener();

  // Drain any pending queue
  drainQueue();

  // Check for resumable draft
  maybeOfferResume();

  // Render history list
  renderHistory();
}

// ============================================================
// STEP NAV
// ============================================================
function setupStepNav() {
  $('#toStep2').onclick = async () => {
    // Save author + trigger extraction if photos exist
    S.author = $('#reportAuthor').value.trim();
    localStorage.setItem(LS_KEYS.author, S.author);
    gotoStep(2);
    await runExtraction();
  };
  $('#backTo1').onclick = () => gotoStep(1);
  $('#toStep3').onclick = () => {
    gotoStep(3);
    refreshPreview();
  };
  $('#backTo2').onclick = () => gotoStep(2);
  $('#refreshPreview').onclick = refreshPreview;
  $('#newReport').onclick = () => {
    if (!confirm('Start a new report? Current data will be saved to history if you haven\'t already.')) return;
    initReadings();
    S.photos = { hq: [], brs: [] };
    renderThumbs();
    renderReviewUI();
    localStorage.removeItem(LS_KEYS.draft);
    gotoStep(1);
  };
}

function gotoStep(n) {
  S.currentStep = n;
  ['step1','step2','step3'].forEach((id, i) => {
    $('#' + id).hidden = (i + 1) !== n;
  });
  // Update step strip
  $$('.step').forEach(el => {
    const sn = parseInt(el.dataset.step, 10);
    el.classList.toggle('step-active', sn === n);
    el.classList.toggle('step-done', sn < n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setupTabs() {
  $$('.tab').forEach(t => {
    t.onclick = () => {
      const tab = t.dataset.tab;
      S.activeTab = tab;
      $$('.tab').forEach(x => x.classList.toggle('tab-active', x === t));
      $$('.tab').forEach(x => x.setAttribute('aria-selected', x === t ? 'true' : 'false'));
      $$('.tab-panel').forEach(p => p.hidden = p.dataset.tabpanel !== tab);
    };
  });
}

// ============================================================
// UPLOADS — Photos
// ============================================================
function wireUploadListeners() {
  $$('input[data-upload]').forEach(inp => {
    inp.addEventListener('change', async e => {
      const site = inp.dataset.upload;
      for (const f of e.target.files) {
        await addPhoto(site, f);
      }
      e.target.value = '';
    });
  });
}

function setupPasteAndDrop() {
  const zone = $('#pasteZone');
  if (!zone) return;

  // Paste
  zone.addEventListener('paste', async e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) await addPhoto('hq', f);
      }
    }
  });

  // Make the whole document catch paste when zone is focused or clicked recently
  let pasteArmed = false;
  zone.addEventListener('click', () => {
    zone.focus();
    pasteArmed = true;
    setTimeout(() => { pasteArmed = false; }, 30000);
  });
  document.addEventListener('paste', async e => {
    if (!pasteArmed && document.activeElement !== zone) return;
    if (S.currentStep !== 1) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) await addPhoto('hq', f);
      }
    }
  });

  // Drag & drop on zone
  ['dragenter','dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  }));
  ['dragleave','drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
  }));
  zone.addEventListener('drop', async e => {
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const f of files) {
      if (f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)) {
        await addPhoto('hq', f);
      }
    }
  });
}

async function addPhoto(site, file) {
  if (S.photos[site].length >= CFG.maxThumbnails) {
    toast(`Max ${CFG.maxThumbnails} photos per site`, 'error');
    return;
  }

  const isHeic = /\.(heic|heif)$/i.test(file.name) || /^image\/(heic|heif)$/i.test(file.type);
  const id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  // Placeholder entry while we process
  const entry = {
    id,
    site,
    type: file.type || (isHeic ? 'image/heic' : 'application/octet-stream'),
    name: file.name || 'image',
    isHeic,
    dataUrl: null,
    originalSize: file.size,
    processedSize: 0,
    state: 'processing', // processing | ready | syncing | synced | queued | error
  };
  S.photos[site].push(entry);
  renderThumbs();

  try {
    if (isHeic) {
      // Pass through without compression (browser may not render, we show placeholder)
      entry.dataUrl = await fileToDataUrl(file);
      entry.processedSize = file.size;
    } else {
      const compressed = await compressImage(file);
      entry.dataUrl = compressed.dataUrl;
      entry.processedSize = compressed.size;
    }
    entry.state = 'ready';
    renderThumbs();
    saveDraft();

    // Sync BRS photos to Firebase so laptop can pick them up
    if (site === 'brs') {
      syncPhotoToFirebase(entry);
    }
  } catch (err) {
    entry.state = 'error';
    entry.error = err.message;
    renderThumbs();
    toast('Failed to process photo: ' + err.message, 'error');
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

async function compressImage(file) {
  // Resize to max edge, JPEG at quality
  const dataUrl = await fileToDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not decode image'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, CFG.maxPhotoEdge / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL('image/jpeg', CFG.photoQuality);
  return { dataUrl: out, size: Math.round(out.length * 0.75) };
}

function renderThumbs() {
  ['hq', 'brs'].forEach(site => {
    const container = $('#' + site + 'Thumbs');
    container.innerHTML = '';
    S.photos[site].forEach(p => {
      const el = document.createElement('div');
      el.className = 'thumb';
      el.dataset.id = p.id;

      if (p.isHeic || !p.dataUrl) {
        el.innerHTML = `<div class="thumb-placeholder">📷<div class="thumb-placeholder-type">${p.isHeic ? 'HEIC' : 'IMG'}</div></div>`;
      } else {
        el.innerHTML = `<img src="${p.dataUrl}" alt="${escapeHtml(p.name)}" />`;
      }

      // State overlay
      if (p.state === 'processing') {
        el.innerHTML += '<div class="thumb-overlay"><div class="thumb-spin"></div></div>';
      } else if (p.state === 'syncing') {
        el.innerHTML += '<div class="thumb-overlay">Syncing</div>';
      } else if (p.state === 'queued') {
        el.innerHTML += '<div class="thumb-overlay" style="background:rgba(245,158,11,0.7)">Queued</div>';
      } else if (p.state === 'error') {
        el.innerHTML += `<div class="thumb-overlay" style="background:rgba(239,68,68,0.7)">Error</div>`;
      }

      el.innerHTML += `<button class="thumb-remove" aria-label="Remove" type="button">×</button>`;
      el.querySelector('.thumb-remove').onclick = e => {
        e.stopPropagation();
        removePhoto(site, p.id);
      };
      container.appendChild(el);
    });
  });
  updateSyncStatusDisplay();
}

function removePhoto(site, id) {
  S.photos[site] = S.photos[site].filter(p => p.id !== id);
  renderThumbs();
  saveDraft();
  if (site === 'brs' && S.online) {
    // Delete from firebase
    fetch(`${CFG.fbBase}/sessions/${S.sessionKey}/photos/${id}.json`, { method: 'DELETE' })
      .catch(() => {});
  }
}

function updateSyncStatusDisplay() {
  const el = $('#brsSyncStatus');
  const brs = S.photos.brs;
  const synced = brs.filter(p => p.state === 'synced').length;
  const queued = brs.filter(p => p.state === 'queued').length;
  const syncing = brs.filter(p => p.state === 'syncing').length;

  if (brs.length === 0) {
    el.textContent = 'No BRS photos yet. Take photos on-site — they sync automatically.';
    el.dataset.state = '';
  } else if (queued > 0) {
    el.textContent = `${queued} photo${queued>1?'s':''} queued for sync (offline)`;
    el.dataset.state = 'queued';
  } else if (syncing > 0) {
    el.textContent = `Syncing ${syncing} photo${syncing>1?'s':''}…`;
    el.dataset.state = '';
  } else if (synced === brs.length) {
    el.textContent = `✓ ${brs.length} photo${brs.length>1?'s':''} synced to session`;
    el.dataset.state = 'synced';
  } else {
    el.textContent = `${brs.length} photo${brs.length>1?'s':''} loaded`;
    el.dataset.state = '';
  }
}

// ============================================================
// FIREBASE SYNC (REST + SSE + OFFLINE QUEUE)
// ============================================================
async function syncPhotoToFirebase(photo) {
  if (!S.online) {
    photo.state = 'queued';
    enqueue({ op: 'put', id: photo.id, data: { name: photo.name, dataUrl: photo.dataUrl, type: photo.type, uploadedAt: Date.now() } });
    renderThumbs();
    return;
  }
  photo.state = 'syncing';
  renderThumbs();
  try {
    const url = `${CFG.fbBase}/sessions/${S.sessionKey}/photos/${photo.id}.json`;
    const body = JSON.stringify({ name: photo.name, dataUrl: photo.dataUrl, type: photo.type, uploadedAt: Date.now() });
    const res = await fetch(url, { method: 'PUT', body });
    if (!res.ok) throw new Error('Firebase HTTP ' + res.status);
    photo.state = 'synced';
    renderThumbs();
  } catch (e) {
    photo.state = 'queued';
    enqueue({ op: 'put', id: photo.id, data: { name: photo.name, dataUrl: photo.dataUrl, type: photo.type, uploadedAt: Date.now() } });
    renderThumbs();
  }
}

function enqueue(item) {
  const q = JSON.parse(localStorage.getItem(LS_KEYS.queue) || '[]');
  q.push({ ...item, queuedAt: Date.now() });
  localStorage.setItem(LS_KEYS.queue, JSON.stringify(q));
  updateMenuCounts();
}

async function drainQueue() {
  if (!S.online) return;
  const q = JSON.parse(localStorage.getItem(LS_KEYS.queue) || '[]');
  if (q.length === 0) return;
  const remaining = [];
  for (const item of q) {
    try {
      if (item.op === 'put') {
        const url = `${CFG.fbBase}/sessions/${S.sessionKey}/photos/${item.id}.json`;
        const res = await fetch(url, { method: 'PUT', body: JSON.stringify(item.data) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        // Mark local photo as synced
        ['hq','brs'].forEach(site => {
          const p = S.photos[site].find(x => x.id === item.id);
          if (p) { p.state = 'synced'; }
        });
      }
    } catch (e) {
      remaining.push(item);
    }
  }
  localStorage.setItem(LS_KEYS.queue, JSON.stringify(remaining));
  renderThumbs();
  updateMenuCounts();
  if (remaining.length === 0 && q.length > 0) {
    toast(`Synced ${q.length} queued photo${q.length>1?'s':''}`, 'success');
  }
}

// SSE live listener for BRS photos
function startFirebaseListener() {
  if (!S.sessionKey) return;
  if (S.sseSource) try { S.sseSource.close(); } catch(e) {}

  const url = `${CFG.fbBase}/sessions/${S.sessionKey}/photos.json`;
  // Use fetch-based polling since EventSource needs specific setup. Do a simple GET first:
  fetch(url).then(r => r.ok ? r.json() : null).then(data => {
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([id, obj]) => {
        // Skip if we already have this photo locally
        const exists = ['hq','brs'].some(site => S.photos[site].some(p => p.id === id));
        if (!exists && obj?.dataUrl) {
          S.photos.brs.push({
            id,
            site: 'brs',
            type: obj.type || 'image/jpeg',
            name: obj.name || 'BRS photo',
            isHeic: /heic|heif/i.test(obj.type || ''),
            dataUrl: obj.dataUrl,
            processedSize: obj.dataUrl.length,
            state: 'synced',
          });
        }
      });
      renderThumbs();
    }
  }).catch(() => {});

  // Poll every 10 seconds for new photos (simpler than SSE wiring, works offline-tolerant)
  clearInterval(startFirebaseListener._poll);
  startFirebaseListener._poll = setInterval(() => {
    if (!S.online || S.currentStep !== 1) return;
    fetch(url).then(r => r.ok ? r.json() : null).then(data => {
      if (data && typeof data === 'object') {
        let added = 0;
        Object.entries(data).forEach(([id, obj]) => {
          const exists = ['hq','brs'].some(site => S.photos[site].some(p => p.id === id));
          if (!exists && obj?.dataUrl) {
            S.photos.brs.push({
              id, site: 'brs', type: obj.type || 'image/jpeg', name: obj.name || 'BRS photo',
              isHeic: /heic|heif/i.test(obj.type || ''), dataUrl: obj.dataUrl,
              processedSize: obj.dataUrl.length, state: 'synced',
            });
            added++;
          }
        });
        if (added > 0) {
          renderThumbs();
          toast(`Received ${added} photo${added>1?'s':''} from BRS`, 'success');
        }
      }
    }).catch(() => {});
  }, 10000);
}

// ============================================================
// NETWORK STATUS
// ============================================================
function setupNetListeners() {
  const update = () => {
    S.online = navigator.onLine;
    const ind = $('#netIndicator');
    if (S.online) {
      ind.hidden = true;
      drainQueue();
    } else {
      ind.hidden = false;
      $('.net-label', ind).textContent = 'Offline';
    }
    updateMenuCounts();
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function updateMenuCounts() {
  const qLen = JSON.parse(localStorage.getItem(LS_KEYS.queue) || '[]').length;
  $('#sheetQueueCount').textContent = String(qLen);
  $('#sheetNetStatus').textContent = S.online ? 'Online' : 'Offline';
  if (S.sessionKey) $('#sheetSessionKey').textContent = S.sessionKey.slice(0, 16) + '…';
}

// ============================================================
// MENU SHEET
// ============================================================
function setupMenu() {
  $('#openMenu').onclick = () => { updateMenuCounts(); openSheet('#menuSheet'); };
  $('#shareSetup').onclick = startShareSetup;
  $('#changeKey').onclick = () => {
    closeSheet('#menuSheet');
    localStorage.removeItem(LS_KEYS.apiKey);
    showKeyScreen();
  };
  $('#retryQueue').onclick = async () => {
    closeSheet('#menuSheet');
    toast('Retrying…', 'info');
    await drainQueue();
  };
  $('#logout').onclick = () => {
    if (!confirm('Sign out and clear PIN + API key on this device? Your drafts and history will be kept.')) return;
    localStorage.removeItem(LS_KEYS.pin);
    localStorage.removeItem(LS_KEYS.apiKey);
    location.reload();
  };
}

function setupSheetListeners() {
  document.addEventListener('click', e => {
    if (e.target.matches('[data-close-sheet]')) {
      const sheet = e.target.closest('.sheet');
      if (sheet) closeSheet('#' + sheet.id);
    }
  });
}

// ============================================================
// QR SHARE SETUP
// ============================================================
async function startShareSetup() {
  closeSheet('#menuSheet');

  if (!S.pin || !S.apiKey) {
    toast('No PIN or API key to share', 'error');
    return;
  }

  const payload = { p: S.pin, k: S.apiKey };
  const encoded = btoa(JSON.stringify(payload));
  const url = `${location.origin}${location.pathname}?setup=${encoded}`;
  $('#qrUrlDisplay').value = url;
  $('#copyQrUrl').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('URL copied', 'success');
    } catch { toast('Copy failed', 'error'); }
  };

  openSheet('#qrSheet');

  // Lazy-load QR lib
  const qrBox = $('#qrBox');
  qrBox.innerHTML = '<div style="color:#888;font-size:12px;padding:60px 20px;text-align:center">Generating QR…</div>';

  try {
    if (!window.qrcode) {
      await loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js');
    }
    const qr = window.qrcode(0, 'L');
    qr.addData(url);
    qr.make();
    qrBox.innerHTML = qr.createSvgTag({ scalable: true });
  } catch (e) {
    qrBox.innerHTML = '<div style="color:#888;font-size:12px;padding:60px 20px;text-align:center">QR unavailable — use Copy URL button below</div>';
  }

  // Countdown
  let remaining = CFG.qrExpirySec;
  clearInterval(S.qrTimer);
  const tick = () => {
    if (remaining <= 0) {
      closeSheet('#qrSheet');
      clearInterval(S.qrTimer);
      toast('Setup link expired', 'info');
      return;
    }
    const m = Math.floor(remaining / 60);
    const s = String(remaining % 60).padStart(2, '0');
    $('#qrCountdown').textContent = `Expires in ${m}:${s}`;
    remaining--;
  };
  tick();
  S.qrTimer = setInterval(tick, 1000);
}

// ============================================================
// REVIEW UI (Step 2)
// ============================================================
function renderReviewUI() {
  ['hq','brs'].forEach(site => {
    // AHU
    const ahuGrid = $(`.ahu-grid[data-ahu-site="${site}"]`);
    ahuGrid.innerHTML = '';
    S.readings[site].ahu.forEach((ahu, idx) => {
      const row = document.createElement('div');
      row.className = 'ahu-row';
      row.innerHTML = `
        <div class="ahu-row-label">AHU ${idx+1}</div>
        <div class="ahu-row-input">
          <input type="text" inputmode="decimal" class="input${ahu.fromAi ? ' input-from-ai' : ''}" data-field="ahu" data-site="${site}" data-idx="${idx}" placeholder="°C" value="${ahu.temp}" />
        </div>
        <div class="ahu-status-toggle" data-site="${site}" data-idx="${idx}">
          <button type="button" data-status="ok" data-active="${ahu.status==='ok'}">OK</button>
          <button type="button" data-status="alert" data-active="${ahu.status==='alert'}">!</button>
          <button type="button" data-status="off" data-active="${ahu.status==='off'}">OFF</button>
        </div>
      `;
      ahuGrid.appendChild(row);
    });

    // UPS
    const upsList = $(`.ups-list[data-ups-site="${site}"]`);
    upsList.innerHTML = '';
    const upsNames = site === 'hq' ? ['UPS A', 'UPS B'] : ['UPS 1', 'UPS 2'];
    upsNames.forEach((name, idx) => {
      const ups = S.readings[site].ups[name];
      const block = document.createElement('div');
      block.className = 'ups-block';
      block.dataset.open = idx === 0 ? 'true' : 'false';
      let rows = '';
      UPS_PARAMS.forEach(p => {
        if (p.threePhase) {
          const v = ups[p.key];
          const aiCls = v.fromAi ? ' input-from-ai' : '';
          rows += `<tr>
            <td class="ups-param">${p.label}</td>
            <td><input type="text" inputmode="decimal" class="${aiCls}" data-field="ups" data-site="${site}" data-ups="${name}" data-param="${p.key}" data-phase="L1" data-type="${p.type}" value="${v.L1}" /></td>
            <td><input type="text" inputmode="decimal" class="${aiCls}" data-field="ups" data-site="${site}" data-ups="${name}" data-param="${p.key}" data-phase="L2" data-type="${p.type}" value="${v.L2}" /></td>
            <td><input type="text" inputmode="decimal" class="${aiCls}" data-field="ups" data-site="${site}" data-ups="${name}" data-param="${p.key}" data-phase="L3" data-type="${p.type}" value="${v.L3}" /></td>
          </tr>`;
        } else {
          const v = ups[p.key];
          const aiCls = v.fromAi ? ' input-from-ai' : '';
          rows += `<tr>
            <td class="ups-param">${p.label}</td>
            <td colspan="3"><input type="text" inputmode="decimal" class="${aiCls} ups-single-input" data-field="ups" data-site="${site}" data-ups="${name}" data-param="${p.key}" data-type="${p.type}" value="${v.value}" /></td>
          </tr>`;
        }
      });
      block.innerHTML = `
        <div class="ups-head" data-toggle-ups>
          <div><span class="ups-head-title">${name}</span><span class="ups-head-sub">${idx===0?'Primary':'Secondary'}</span></div>
          <div class="ups-head-caret">▾</div>
        </div>
        <div class="ups-body">
          <table class="ups-table">
            <thead><tr><th class="ups-param">Parameter</th><th>L1</th><th>L2</th><th>L3</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      block.querySelector('[data-toggle-ups]').onclick = () => {
        block.dataset.open = block.dataset.open === 'true' ? 'false' : 'true';
      };
      upsList.appendChild(block);
    });

    // General Checks
    const checksGrid = $(`.checks-grid[data-checks-site="${site}"]`);
    checksGrid.innerHTML = '';
    const checks = site === 'hq' ? HQ_CHECKS : BRS_CHECKS;
    checks.forEach(c => {
      const row = document.createElement('div');
      row.className = 'check-row';
      row.innerHTML = `
        <div class="check-label">${c}</div>
        <div class="check-toggle" data-site="${site}" data-check="${c}">
          <button type="button" data-status="ok" data-active="${S.readings[site].checks[c]==='ok'}">OK</button>
          <button type="button" data-status="alert" data-active="${S.readings[site].checks[c]==='alert'}">Alert</button>
        </div>
      `;
      checksGrid.appendChild(row);
    });
  });

  // Alert section
  $('#alertTitle').value = S.readings.alert.title;
  $('#alertDesc').value = S.readings.alert.desc;
  $('#alertOwner').value = S.readings.alert.owner;

  // Wire field listeners on review inputs
  wireReviewListeners();
}

function wireReviewListeners() {
  // AHU temp inputs
  $$('input[data-field="ahu"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const { site, idx } = inp.dataset;
      S.readings[site].ahu[idx].temp = inp.value;
      S.readings[site].ahu[idx].fromAi = false;
      inp.classList.remove('input-from-ai');
      validateField(inp, 'temp');
      saveDraft();
    });
  });
  // AHU status toggles
  $$('.ahu-status-toggle').forEach(tg => {
    tg.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        const { site, idx } = tg.dataset;
        const st = b.dataset.status;
        S.readings[site].ahu[idx].status = st;
        tg.querySelectorAll('button').forEach(x => x.dataset.active = (x === b).toString());
        saveDraft();
      };
    });
  });
  // UPS inputs
  $$('input[data-field="ups"]').forEach(inp => {
    inp.addEventListener('input', () => {
      const { site, ups, param, phase, type } = inp.dataset;
      const d = S.readings[site].ups[ups][param];
      if (phase) {
        d[phase] = inp.value;
      } else {
        d.value = inp.value;
      }
      d.fromAi = false;
      inp.classList.remove('input-from-ai');
      validateField(inp, type);
      saveDraft();
    });
  });
  // Check toggles
  $$('.check-toggle').forEach(tg => {
    tg.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        const { site, check } = tg.dataset;
        const st = b.dataset.status;
        S.readings[site].checks[check] = st;
        tg.querySelectorAll('button').forEach(x => x.dataset.active = (x === b).toString());
        saveDraft();
      };
    });
  });
  // Alert fields
  $('#alertTitle').addEventListener('input', e => { S.readings.alert.title = e.target.value; saveDraft(); });
  $('#alertDesc').addEventListener('input', e => { S.readings.alert.desc = e.target.value; saveDraft(); });
  $('#alertOwner').addEventListener('input', e => { S.readings.alert.owner = e.target.value; saveDraft(); });
}

function wireFieldListeners() {
  // Step 1 fields
  $('#reportDate').addEventListener('change', e => { S.date = e.target.value; saveDraft(); });
  $('#reportAuthor').addEventListener('input', e => {
    S.author = e.target.value;
    localStorage.setItem(LS_KEYS.author, S.author);
    saveDraft();
  });
  // Step 3 fields
  $('#mailTo').addEventListener('input', e => { S.mailTo = e.target.value; localStorage.setItem(LS_KEYS.mailTo, S.mailTo); });
}

// ============================================================
// VALIDATION
// ============================================================
function validateField(inp, type) {
  const v = parseFloat(inp.value);
  if (inp.value.trim() === '' || isNaN(v)) {
    inp.classList.remove('input-warn');
    removeWarn(inp);
    return;
  }
  const range = VAL[type];
  if (!range) return;

  const warn = (msg) => {
    inp.classList.add('input-warn');
    let msgEl = inp.parentElement.querySelector('.field-warn-msg') || inp.nextElementSibling;
    if (!msgEl || !msgEl.classList?.contains('field-warn-msg')) {
      msgEl = document.createElement('div');
      msgEl.className = 'field-warn-msg';
      inp.parentElement.appendChild(msgEl);
    }
    msgEl.textContent = msg;
  };

  if (v < range.min || v > range.max) {
    warn(`Outside expected ${range.min}–${range.max}`);
  } else if (v < range.ok[0] || v > range.ok[1]) {
    warn(`Outside normal ${range.ok[0]}–${range.ok[1]}`);
  } else {
    inp.classList.remove('input-warn');
    removeWarn(inp);
  }
}

function removeWarn(inp) {
  const msgEl = inp.parentElement.querySelector('.field-warn-msg');
  if (msgEl) msgEl.remove();
}

// ============================================================
// AUTO-SAVE / RESUME
// ============================================================
const saveDraft = debounce(() => {
  if (!S.sessionKey) return;
  const draft = {
    sessionKey: S.sessionKey,
    date: S.date,
    author: S.author,
    savedAt: Date.now(),
    readings: S.readings,
    photos: {
      hq: S.photos.hq.map(p => ({ id: p.id, name: p.name, dataUrl: p.dataUrl, type: p.type, isHeic: p.isHeic, state: 'synced' })),
      brs: S.photos.brs.map(p => ({ id: p.id, name: p.name, dataUrl: p.dataUrl, type: p.type, isHeic: p.isHeic, state: 'synced' })),
    },
  };
  try {
    localStorage.setItem(LS_KEYS.draft, JSON.stringify(draft));
  } catch (e) {
    // Quota exceeded — drop photos from draft
    try {
      draft.photos = { hq: [], brs: [] };
      localStorage.setItem(LS_KEYS.draft, JSON.stringify(draft));
    } catch {}
  }
}, CFG.autoSaveInterval);

function maybeOfferResume() {
  const raw = localStorage.getItem(LS_KEYS.draft);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (draft.sessionKey !== S.sessionKey) return; // different PIN/date
    // Check if draft has meaningful content
    const hasContent = draft.readings &&
      (JSON.stringify(draft.readings) !== JSON.stringify(freshReadings()) ||
       draft.photos?.hq?.length || draft.photos?.brs?.length);
    if (!hasContent) return;

    const banner = $('#resumeBanner');
    const t = new Date(draft.savedAt);
    $('#resumeTime').textContent = `Draft from ${t.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
    banner.hidden = false;

    $('#resumeLoad').onclick = () => {
      S.readings = draft.readings;
      if (draft.photos?.hq) S.photos.hq = draft.photos.hq;
      if (draft.photos?.brs) S.photos.brs = draft.photos.brs;
      renderReviewUI();
      renderThumbs();
      banner.hidden = true;
      toast('Draft restored', 'success');
    };
    $('#resumeDiscard').onclick = () => {
      localStorage.removeItem(LS_KEYS.draft);
      banner.hidden = true;
    };
  } catch (e) {
    localStorage.removeItem(LS_KEYS.draft);
  }
}

function freshReadings() {
  const old = S.readings;
  initReadings();
  const fresh = S.readings;
  S.readings = old;
  return fresh;
}

// ============================================================
// GEMINI EXTRACTION
// ============================================================
async function runExtraction() {
  const allPhotos = [...S.photos.hq, ...S.photos.brs].filter(p => p.dataUrl && p.state !== 'error' && p.state !== 'processing');
  if (allPhotos.length === 0) return;
  if (!S.apiKey) {
    showExtractStatus('No API key — fill values manually. Tap the menu to add a Gemini key.', 'warn');
    return;
  }

  showExtractStatus(`Reading ${allPhotos.length} photo${allPhotos.length>1?'s':''} with Gemini…`, 'info');

  try {
    // Call Gemini with all photos in parallel (up to 10 at a time in one call)
    // Group per site so we get site-tagged results
    const hqPhotos = S.photos.hq.filter(p => p.dataUrl && !p.isHeic);
    const brsPhotos = S.photos.brs.filter(p => p.dataUrl);

    const results = { hq: null, brs: null };
    const errors = [];

    if (hqPhotos.length) {
      try {
        results.hq = await callGemini(hqPhotos, 'hq');
      } catch (e) { errors.push({ site: 'HQ', err: e }); }
    }
    if (brsPhotos.length) {
      try {
        results.brs = await callGemini(brsPhotos, 'brs');
      } catch (e) { errors.push({ site: 'BRS', err: e }); }
    }

    // Apply results
    let applied = 0;
    if (results.hq) applied += applyExtraction('hq', results.hq);
    if (results.brs) applied += applyExtraction('brs', results.brs);

    renderReviewUI();

    if (errors.length > 0) {
      const msg = errors.length === 2 ? 'Extraction failed for both sites' : `Extraction failed for ${errors[0].site}`;
      showExtractStatus(msg + ' — fill values manually or show details', 'error', errors[0].err);
    } else if (applied === 0) {
      showExtractStatus('No readable values found — please fill manually', 'warn');
    } else {
      showExtractStatus(`✓ Extracted ${applied} values. Blue fields are from AI — verify before sending.`, 'success');
    }
  } catch (e) {
    showExtractStatus('Extraction error — fill values manually', 'error', e);
  }
}

async function callGemini(photos, siteTag) {
  const systemPrompt = `You are reading data center monitoring panel images for the ${siteTag.toUpperCase()} site.
Extract these readings if visible and return ONLY a JSON object matching this schema:

{
  "ahu": [ { "index": 1, "temp": 22.5, "status": "ok" } ],  // status: "ok" | "alert" | "off"
  "ups": {
    "${siteTag === 'hq' ? 'UPS A' : 'UPS 1'}": {
      "input": { "L1": 240, "L2": 238, "L3": 241 },
      "output": { "L1": 240, "L2": 240, "L3": 240 },
      "current": { "L1": 10.2, "L2": 9.8, "L3": 10.1 },
      "load": { "L1": 40, "L2": 38, "L3": 39 },
      "power": { "L1": 4.1, "L2": 3.9, "L3": 4.0 },
      "batVoltage": 408,
      "batCurrent": 0.5,
      "batCapacity": 100,
      "runtime": 45,
      "frequency": 50.0,
      "upsTemp": 28
    }
  }
}

Rules:
- Only include fields you can clearly read from the images.
- Omit any field you cannot read — do NOT guess.
- Voltages are typically 200-250V, frequency 49-51Hz, AHU temp 18-24°C normal.
- For AHU: index is the AHU number (1, 2, 3). status is "ok" if temp is in range and unit is running; "alert" if temp is elevated; "off" if the unit display shows off/zero.
- UPS names for HQ are "UPS A" and "UPS B". For BRS they are "UPS 1" and "UPS 2".
- Return ONLY the JSON object — no markdown, no commentary, no backticks.`;

  const parts = [{ text: systemPrompt }];
  photos.forEach(p => {
    // Extract base64 from dataUrl
    const match = p.dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (match) {
      parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
    }
  });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };

  const res = await fetch(`${CFG.geminiEndpoint}?key=${encodeURIComponent(S.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let hint = '';
    if (res.status === 400) hint = 'Bad request — check API key format or image content';
    else if (res.status === 401 || res.status === 403) hint = 'API key invalid or lacks permission';
    else if (res.status === 429) hint = 'Rate limit hit — wait a minute and retry';
    else if (res.status >= 500) hint = 'Gemini server error — retry later';
    const err = new Error(`Gemini HTTP ${res.status}${hint ? ': ' + hint : ''}`);
    err.details = `Status: ${res.status}\nEndpoint: ${CFG.geminiEndpoint}\n\nResponse:\n${text.slice(0, 2000)}`;
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    const err = new Error('Empty response from Gemini');
    err.details = JSON.stringify(data, null, 2).slice(0, 2000);
    throw err;
  }

  try {
    // Strip code fences if present
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(cleaned);
  } catch (e) {
    const err = new Error('Could not parse Gemini JSON response');
    err.details = `Raw response:\n${text.slice(0, 2000)}`;
    throw err;
  }
}

function applyExtraction(site, extracted) {
  let count = 0;

  // AHU
  if (Array.isArray(extracted.ahu)) {
    extracted.ahu.forEach(a => {
      if (!a || typeof a.index !== 'number') return;
      const idx = a.index - 1;
      if (idx < 0 || idx >= 3) return;
      if (typeof a.temp === 'number') {
        S.readings[site].ahu[idx].temp = String(a.temp);
        S.readings[site].ahu[idx].fromAi = true;
        count++;
      }
      if (['ok','alert','off'].includes(a.status)) {
        S.readings[site].ahu[idx].status = a.status;
      }
    });
  }

  // UPS
  if (extracted.ups && typeof extracted.ups === 'object') {
    Object.entries(extracted.ups).forEach(([name, vals]) => {
      const target = S.readings[site].ups[name];
      if (!target) return;
      UPS_PARAMS.forEach(p => {
        const val = vals[p.key];
        if (val == null) return;
        if (p.threePhase && typeof val === 'object') {
          ['L1','L2','L3'].forEach(ph => {
            if (typeof val[ph] === 'number') {
              target[p.key][ph] = String(val[ph]);
              target[p.key].fromAi = true;
              count++;
            }
          });
        } else if (!p.threePhase && typeof val === 'number') {
          target[p.key].value = String(val);
          target[p.key].fromAi = true;
          count++;
        }
      });
    });
  }

  return count;
}

function showExtractStatus(msg, level, err) {
  const el = $('#extractStatus');
  el.hidden = false;
  el.dataset.level = level;
  el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  if (err) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = 'Show details';
    btn.onclick = () => showErrorSheet('Extraction error', err);
    el.appendChild(btn);
  }
}

function showErrorSheet(title, err) {
  $('#errSheetTitle').textContent = title;
  $('#errSummary').textContent = err.message || String(err);
  $('#errPre').textContent = err.details || err.stack || 'No additional details';
  $('#errCopy').onclick = async () => {
    try {
      const txt = `${err.message || err}\n\n${err.details || err.stack || ''}`;
      await navigator.clipboard.writeText(txt);
      toast('Details copied', 'success');
    } catch { toast('Copy failed', 'error'); }
  };
  openSheet('#errSheet');
}

// ============================================================
// REPORT GENERATION (HTML for email + preview)
// ============================================================
function generateReportHtml() {
  const date = S.date || todayStr();
  const dateStr = fmtDate(date);
  const author = (S.author || 'TI&O Engineer').trim();
  const r = S.readings;

  const hqAlert = hasAlert('hq');
  const brsAlert = hasAlert('brs');
  const mainAlert = r.alert.title.trim() || r.alert.desc.trim();

  // Build subject line for email (not in HTML but returned for mailto)
  const subject = `DC Monitoring Report — ${dateStr}`;

  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DC Monitoring Report — ${escapeHtml(dateStr)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#1a202c;line-height:1.5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f6fa;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="680" style="width:100%;max-width:680px;margin:0 auto;background:#ffffff;">

      <!-- Banner -->
      <tr><td style="background:#0b2558;padding:20px 28px;color:#ffffff;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="font-size:13px;letter-spacing:0.4px;text-transform:uppercase;font-weight:600;color:#93c5fd;">
              Bank of Uganda
            </td>
            <td align="right" style="font-size:12px;color:#bfdbfe;">${escapeHtml(dateStr)}</td>
          </tr>
          <tr><td colspan="2" style="font-size:14px;color:#ffffff;padding-top:4px;">
            Technology Infrastructure &amp; Operations Department
          </td></tr>
        </table>
      </td></tr>

      <!-- Hero -->
      <tr><td style="background:linear-gradient(135deg,#1e3a8a,#3b82f6);padding:32px 28px;color:#ffffff;">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:600;color:#bfdbfe;margin-bottom:8px;">
          Data Center Status Report
        </div>
        <div style="font-size:26px;font-weight:600;letter-spacing:-0.3px;margin-bottom:6px;">
          HQ &amp; BRS
        </div>
        <div style="font-size:13px;color:#bfdbfe;">
          Prepared by ${escapeHtml(author)}
        </div>
      </td></tr>

      <!-- Site Overview -->
      <tr><td style="padding:24px 28px 8px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;margin-bottom:12px;">
          Site Overview
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="50%" style="padding-right:6px;vertical-align:top;">
              ${siteOverviewCard('HQ', hqAlert)}
            </td>
            <td width="50%" style="padding-left:6px;vertical-align:top;">
              ${siteOverviewCard('BRS', brsAlert)}
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Temperature -->
      <tr><td style="padding:16px 28px 8px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;margin-bottom:12px;">
          Server Room Temperature
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="50%" style="padding-right:6px;vertical-align:top;">
              ${ahuSection('HQ', r.hq.ahu)}
            </td>
            <td width="50%" style="padding-left:6px;vertical-align:top;">
              ${ahuSection('BRS', r.brs.ahu)}
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- UPS -->
      <tr><td style="padding:16px 28px 8px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;margin-bottom:12px;">
          UPS Status
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            ${upsCard('HQ', 'UPS A', r.hq.ups['UPS A'])}
            ${upsCard('HQ', 'UPS B', r.hq.ups['UPS B'])}
            ${upsCard('BRS', 'UPS 1', r.brs.ups['UPS 1'])}
            ${upsCard('BRS', 'UPS 2', r.brs.ups['UPS 2'])}
          </tr>
        </table>
      </td></tr>

      <!-- General Checks -->
      <tr><td style="padding:16px 28px 8px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;margin-bottom:12px;">
          General Checks
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="50%" style="padding-right:6px;vertical-align:top;">
              ${checksCard('HQ', r.hq.checks, HQ_CHECKS)}
            </td>
            <td width="50%" style="padding-left:6px;vertical-align:top;">
              ${checksCard('BRS', r.brs.checks, BRS_CHECKS)}
            </td>
          </tr>
        </table>
      </td></tr>

      ${mainAlert ? `
      <!-- Active Alert -->
      <tr><td style="padding:16px 28px 8px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#dc2626;margin-bottom:12px;">
          ⚠ Active Alert
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;">
          <tr><td style="padding:16px 18px;">
            <div style="font-size:15px;font-weight:600;color:#991b1b;margin-bottom:6px;">
              ${escapeHtml(r.alert.title || 'Alert')}
            </div>
            ${r.alert.desc ? `<div style="font-size:13px;color:#7f1d1d;line-height:1.5;margin-bottom:10px;">${escapeHtml(r.alert.desc).replace(/\n/g,'<br>')}</div>` : ''}
            ${r.alert.owner ? `<div style="display:inline-block;padding:4px 10px;background:#fee2e2;color:#991b1b;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.3px;">Owner: ${escapeHtml(r.alert.owner)}</div>` : ''}
          </td></tr>
        </table>
      </td></tr>
      ` : ''}

      <!-- Footer -->
      <tr><td style="padding:24px 28px 28px;">
        <div style="border-top:1px solid #e5e7eb;padding-top:16px;text-align:center;font-size:11px;color:#94a3b8;letter-spacing:0.3px;">
          Prepared by ${escapeHtml(author)} &middot; TI&amp;O Department &middot; Bank of Uganda &middot; Confidential
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { html: body, subject };
}

function siteOverviewCard(site, alert) {
  const color = site === 'HQ' ? '#3b82f6' : '#8b5cf6';
  const bg = site === 'HQ' ? '#eff6ff' : '#f5f3ff';
  const borderColor = site === 'HQ' ? '#bfdbfe' : '#ddd6fe';
  const statusBg = alert ? '#fef2f2' : '#f0fdf4';
  const statusColor = alert ? '#991b1b' : '#166534';
  const statusBorder = alert ? '#fecaca' : '#bbf7d0';
  const statusText = alert ? '⚠ Alert Detected' : '✓ All Systems Normal';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${bg};border:1px solid ${borderColor};border-radius:8px;overflow:hidden;">
      <tr><td style="background:${color};height:4px;"></td></tr>
      <tr><td style="padding:14px 16px;">
        <div style="display:inline-block;padding:3px 10px;background:${color};color:#fff;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-bottom:10px;">${site}</div>
        <div style="padding:6px 10px;background:${statusBg};border:1px solid ${statusBorder};border-radius:6px;color:${statusColor};font-size:12px;font-weight:600;">
          ${statusText}
        </div>
      </td></tr>
    </table>
  `;
}

function ahuSection(site, ahus) {
  const color = site === 'HQ' ? '#3b82f6' : '#8b5cf6';
  const rows = ahus.map((a, i) => {
    const temp = parseFloat(a.temp);
    const isValid = !isNaN(temp);
    const isNormal = isValid && temp >= 18 && temp <= 24 && a.status === 'ok';
    const isOff = a.status === 'off';
    const badgeBg = isOff ? '#f1f5f9' : (isNormal ? '#f0fdf4' : '#fef3c7');
    const badgeColor = isOff ? '#64748b' : (isNormal ? '#166534' : '#854d0e');
    const badgeBorder = isOff ? '#cbd5e1' : (isNormal ? '#bbf7d0' : '#fde68a');
    const badgeText = isOff ? 'OFF' : (a.status === 'alert' ? '!' : (isValid ? 'OK' : '—'));

    // Bar: 18-24 normal, map to percentage
    let barPct = 0;
    let barColor = '#94a3b8';
    if (isValid) {
      barPct = Math.min(100, Math.max(0, ((temp - 14) / (30 - 14)) * 100));
      if (temp < 18) barColor = '#3b82f6';
      else if (temp > 24) barColor = '#ef4444';
      else barColor = '#22c55e';
    }
    const tempDisplay = isValid ? `${temp.toFixed(1)}°C` : (isOff ? 'Off' : '—');

    return `
      <tr><td style="padding:10px 0;border-top:${i===0?'none':'1px solid #e5e7eb'};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="font-size:12px;color:#475569;font-weight:500;width:46px;">AHU ${i+1}</td>
            <td style="padding:0 10px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#e5e7eb;height:6px;border-radius:3px;overflow:hidden;">
                <tr><td style="background:${barColor};height:6px;width:${barPct}%;"></td></tr>
              </table>
            </td>
            <td align="right" style="font-size:13px;font-weight:600;color:#1e293b;width:62px;">${tempDisplay}</td>
            <td align="right" style="width:36px;padding-left:8px;">
              <span style="display:inline-block;padding:2px 8px;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};border-radius:999px;font-size:10px;font-weight:700;">${badgeText}</span>
            </td>
          </tr>
        </table>
      </td></tr>
    `;
  }).join('');

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <tr><td style="background:${color};height:3px;"></td></tr>
      <tr><td style="padding:12px 16px 6px;">
        <div style="font-size:11px;letter-spacing:0.4px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:4px;">${site} Server Room</div>
        ${rows}
      </td></tr>
    </table>
  `;
}

function upsCard(site, name, ups) {
  const hasData = hasUpsData(ups);
  const color = site === 'HQ' ? '#3b82f6' : '#8b5cf6';

  if (!hasData) {
    return `<td width="25%" style="padding:0 3px;vertical-align:top;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <tr><td style="background:${color};height:3px;"></td></tr>
        <tr><td style="padding:12px 10px;text-align:center;">
          <div style="font-size:11px;font-weight:700;color:${color};letter-spacing:0.4px;margin-bottom:4px;">${name}</div>
          <div style="font-size:10px;color:#94a3b8;">OK · No readings</div>
        </td></tr>
      </table>
    </td>`;
  }

  const battery = parseFloat(ups.batCapacity?.value) || 0;
  const runtime = parseFloat(ups.runtime?.value) || 0;
  const freq = parseFloat(ups.frequency?.value) || 0;
  const loadAvg = avgOfPhases(ups.load);
  const batBarColor = battery > 80 ? '#22c55e' : (battery > 40 ? '#f59e0b' : '#ef4444');

  return `<td width="25%" style="padding:0 3px;vertical-align:top;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <tr><td style="background:${color};height:3px;"></td></tr>
      <tr><td style="padding:12px 10px;">
        <div style="font-size:11px;font-weight:700;color:${color};letter-spacing:0.4px;margin-bottom:8px;">${name}</div>
        ${battery > 0 ? `
          <div style="font-size:10px;color:#64748b;margin-bottom:2px;">Battery</div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#e5e7eb;height:5px;border-radius:3px;margin-bottom:2px;">
            <tr><td style="background:${batBarColor};height:5px;width:${Math.min(battery,100)}%;"></td></tr>
          </table>
          <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:6px;">${battery.toFixed(0)}%</div>
        ` : ''}
        ${runtime > 0 ? `<div style="font-size:10px;color:#64748b;">Runtime</div><div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:4px;">${runtime.toFixed(0)} min</div>` : ''}
        ${loadAvg != null ? `<div style="font-size:10px;color:#64748b;">Load avg</div><div style="font-size:12px;font-weight:600;color:#1e293b;margin-bottom:4px;">${loadAvg.toFixed(0)}%</div>` : ''}
        ${freq > 0 ? `<div style="font-size:10px;color:#64748b;">Freq</div><div style="font-size:12px;font-weight:600;color:#1e293b;">${freq.toFixed(1)} Hz</div>` : ''}
      </td></tr>
    </table>
  </td>`;
}

function checksCard(site, checks, order) {
  const color = site === 'HQ' ? '#3b82f6' : '#8b5cf6';
  const rows = order.map(c => {
    const st = checks[c] || 'ok';
    const badge = st === 'alert'
      ? `<span style="display:inline-block;padding:2px 9px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:999px;font-size:10px;font-weight:700;">Alert</span>`
      : `<span style="display:inline-block;padding:2px 9px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;border-radius:999px;font-size:10px;font-weight:700;">OK</span>`;
    return `
      <tr><td style="padding:7px 0;font-size:12px;color:#475569;">${escapeHtml(c)}</td>
      <td align="right" style="padding:7px 0;">${badge}</td></tr>
    `;
  }).join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <tr><td style="background:${color};height:3px;"></td></tr>
      <tr><td style="padding:12px 16px;">
        <div style="font-size:11px;letter-spacing:0.4px;text-transform:uppercase;font-weight:600;color:#64748b;margin-bottom:6px;">${site}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
      </td></tr>
    </table>
  `;
}

function hasUpsData(ups) {
  if (!ups) return false;
  return UPS_PARAMS.some(p => {
    if (p.threePhase) {
      return ups[p.key]?.L1 || ups[p.key]?.L2 || ups[p.key]?.L3;
    } else {
      return ups[p.key]?.value;
    }
  });
}

function hasAlert(site) {
  const r = S.readings[site];
  const ahuAlert = r.ahu.some(a => a.status === 'alert' || a.status === 'off');
  const checkAlert = Object.values(r.checks).some(v => v === 'alert');
  return ahuAlert || checkAlert;
}

function avgOfPhases(v) {
  if (!v) return null;
  const nums = ['L1','L2','L3'].map(p => parseFloat(v[p])).filter(n => !isNaN(n));
  if (nums.length === 0) return null;
  return nums.reduce((a,b) => a+b, 0) / nums.length;
}

// ============================================================
// STEP 3 — Preview & Send
// ============================================================
function refreshPreview() {
  const { html } = generateReportHtml();
  const frame = $('#previewFrame');
  frame.srcdoc = html;

  // Prefill mailTo/subject
  if (!$('#mailTo').value) $('#mailTo').value = S.mailTo;
  $('#mailSubject').value = `DC Monitoring Report — ${fmtDate(S.date)}`;
}

function wireSendActions() {
  $('#copyHtml').onclick = copyAsHtml;
  $('#downloadEml').onclick = downloadEml;
  $('#downloadHtml').onclick = downloadHtmlFile;
  $('#saveToHistory').onclick = saveReportToHistory;
}

async function copyAsHtml() {
  const { html } = generateReportHtml();
  try {
    if (!navigator.clipboard?.write) throw new Error('Clipboard API unavailable');
    const blob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([htmlToPlainText(html)], { type: 'text/plain' });
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })
    ]);
    toast('✓ Copied as HTML — paste into a new Outlook email', 'success', 4000);
  } catch (e) {
    // Fallback: copy as plain text HTML source
    try {
      await navigator.clipboard.writeText(html);
      toast('Copied HTML source — paste into Outlook\'s edit HTML mode', 'info', 4000);
    } catch {
      toast('Copy failed — use Download HTML instead', 'error');
    }
  }
}

function htmlToPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}

function downloadEml() {
  const { html, subject } = generateReportHtml();
  const to = $('#mailTo').value.trim() || S.mailTo;
  const subj = $('#mailSubject').value.trim() || subject;

  // Build an RFC-822 .eml with HTML body
  const boundary = '----=_Part_' + Math.random().toString(36).slice(2);
  const eml = [
    'MIME-Version: 1.0',
    `To: ${to}`,
    `Subject: ${subj}`,
    'X-Unsent: 1',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    htmlToPlainText(html).replace(/=/g, '=3D'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(html))).replace(/(.{76})/g, '$1\n'),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const blob = new Blob([eml], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DC-Report-${S.date}.eml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Downloaded — double-click the .eml to open in Outlook', 'success', 4000);
}

function downloadHtmlFile() {
  const { html } = generateReportHtml();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DC-Report-${S.date}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('HTML file downloaded', 'success');
}

// ============================================================
// REPORT HISTORY
// ============================================================
function saveReportToHistory() {
  const { html } = generateReportHtml();
  const hist = JSON.parse(localStorage.getItem(LS_KEYS.history) || '[]');
  const summary = buildSummary();
  hist.unshift({
    id: 'r_' + Date.now(),
    date: S.date,
    savedAt: Date.now(),
    author: S.author,
    summary,
    html,
  });
  // Trim to max
  while (hist.length > CFG.historyMax) hist.pop();
  try {
    localStorage.setItem(LS_KEYS.history, JSON.stringify(hist));
    renderHistory();
    toast('Report saved to history', 'success');
  } catch (e) {
    toast('Storage full — delete older reports first', 'error');
  }
}

function buildSummary() {
  const hqA = hasAlert('hq');
  const brsA = hasAlert('brs');
  if (hqA && brsA) return 'Alerts on HQ and BRS';
  if (hqA) return 'Alert on HQ';
  if (brsA) return 'Alert on BRS';
  return 'All systems normal';
}

function renderHistory() {
  const list = $('#historyList');
  const hist = JSON.parse(localStorage.getItem(LS_KEYS.history) || '[]');
  list.innerHTML = '';
  hist.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.innerHTML = `
      <div class="history-meta">
        <div class="history-date">${fmtDate(item.date)}</div>
        <div class="history-sub">${escapeHtml(item.summary || '')} · ${new Date(item.savedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
      </div>
      <div class="history-actions">
        <button type="button" data-act="view">👁</button>
        <button type="button" data-act="copy">⎘</button>
        <button type="button" data-act="delete">🗑</button>
      </div>
    `;
    row.querySelector('[data-act="view"]').onclick = () => {
      const frame = $('#previewFrame');
      frame.srcdoc = item.html;
      frame.scrollIntoView({ behavior: 'smooth' });
    };
    row.querySelector('[data-act="copy"]').onclick = async () => {
      try {
        const blob = new Blob([item.html], { type: 'text/html' });
        const tb = new Blob([htmlToPlainText(item.html)], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': tb })]);
        toast('Copied from history', 'success');
      } catch {
        try { await navigator.clipboard.writeText(item.html); toast('Copied HTML source', 'info'); }
        catch { toast('Copy failed', 'error'); }
      }
    };
    row.querySelector('[data-act="delete"]').onclick = () => {
      if (!confirm('Delete this saved report?')) return;
      const h2 = JSON.parse(localStorage.getItem(LS_KEYS.history) || '[]').filter(x => x.id !== item.id);
      localStorage.setItem(LS_KEYS.history, JSON.stringify(h2));
      renderHistory();
    };
    list.appendChild(row);
  });
}

})();
