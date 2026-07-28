/* ===================================================================
   app.js – Gia Đình HaHa
   All pages share this single script; routing by pathname.
=================================================================== */

// ─── CONFIG ───────────────────────────────────────────────────────
const CREDENTIALS = { username: 'admin', password: 'hoivotri' };
const STORAGE_KEY  = 'ticketVaultData';

// ─── EVENT EMOJIS ────────────────────────────────────────────────
const EVENT_EMOJIS = ['✈️','🏖️','🏔️','🌸','🎡','🗺️','🚂','⛵','🏝️','🎆'];
const TICKET_ICONS = {
  'Vé máy bay':    '✈️',
  'Vé tàu':        '🚂',
  'Vé xe':         '🚌',
  'Vé khách sạn':  '🏨',
  'Vé tham quan':  '🎡',
  'Vé sự kiện':    '🎤',
  'Vé phà/tàu biển':'⛴️',
  'Khác':          '📄',
};

// ─── STORAGE HELPERS ─────────────────────────────────────────────
window.APP_DATA = null;

async function fetchServerData() {
  try {
    const res = await fetch('/api/getData');
    if (res.ok) {
      const serverData = await res.json();
      const localDataStr = localStorage.getItem(STORAGE_KEY);
      const localData = localDataStr ? JSON.parse(localDataStr) : { events: [] };

      // Migration: If server is empty but local has data, upload local to server
      if ((!serverData.events || serverData.events.length === 0) && localData.events && localData.events.length > 0) {
        console.log('Migrating local data to cloud...');
        window.APP_DATA = localData;
        normalizeData(window.APP_DATA);
        await syncServerData(window.APP_DATA);
      } else {
        window.APP_DATA = serverData;
        // Gán id còn thiếu cho dữ liệu cũ; nếu có thay đổi thì lưu lại lên máy chủ để
        // mọi máy dùng chung một bộ id ổn định (phục vụ xoá/sửa theo id).
        const changed = normalizeData(window.APP_DATA);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(window.APP_DATA));
        if (changed) await syncServerData(window.APP_DATA);
      }
    }
  } catch (e) {
    console.error('Lỗi tải dữ liệu', e);
  }
}

async function syncServerData(data) {
  try {
    await fetch('/api/saveData', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.error('Lỗi lưu dữ liệu', e);
  }
}

function normalizeData(data) {
  // Gán id ổn định cho event/vé/hoá đơn cũ (dữ liệu trước đây lưu không có id từng mục)
  // để có thể xoá/sửa theo id. Idempotent: chỉ điền chỗ còn thiếu.
  let changed = false;
  if (!data || !Array.isArray(data.events)) return changed;
  data.events.forEach(ev => {
    if (!ev.id) { ev.id = uuid(); changed = true; }
    if (!Array.isArray(ev.tickets))  ev.tickets  = [];
    if (!Array.isArray(ev.invoices)) ev.invoices = [];
    ev.tickets.forEach(t   => { if (!t.id)  { t.id  = uuid(); changed = true; } });
    ev.invoices.forEach(iv => { if (!iv.id) { iv.id = uuid(); changed = true; } });
  });
  return changed;
}

function loadData() {
  if (!window.APP_DATA) {
    try { window.APP_DATA = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { events: [] }; }
    catch { window.APP_DATA = { events: [] }; }
  }
  // Backfill id cho dữ liệu cũ. Nếu có gán mới thì GHI NGAY xuống localStorage để id ổn
  // định giữa các lần tải trang (nếu không, mỗi lần load lại sẽ sinh id khác → link
  // event.html?id=... bị lệch và văng về dashboard ở chế độ local không có API).
  if (normalizeData(window.APP_DATA)) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(window.APP_DATA)); } catch (_) {}
  }
  return window.APP_DATA;
}

function saveData(data) {
  window.APP_DATA = data;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } // Giữ backup local
  catch (e) { console.error('Không lưu được backup local (có thể hết dung lượng):', e); }
  return syncServerData(data); // trả promise để nơi gọi có thể await
}

/**
 * Ghi AN TOÀN: lấy lại bản dữ liệu mới nhất từ máy chủ, áp thao tác lên bản đó rồi mới lưu.
 * Tránh ghi đè mất dữ liệu người khác vừa thêm/xoá (last-write-wins).
 * mutator(data) nhận cả cục dữ liệu mới nhất và chỉnh sửa trực tiếp trên đó.
 */
async function mutateData(mutator, { spinner = true } = {}) {
  if (spinner) showGlobalSpinner('💾 Đang lưu...');
  try {
    let data;
    try {
      const res = await fetch('/api/getData');
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.events)) data = json;
      }
    } catch (_) { /* offline / chạy local không có API → dùng bản hiện có */ }

    if (!data) data = loadData();            // fallback: bản trong RAM / localStorage
    if (!Array.isArray(data.events)) data.events = [];
    normalizeData(data);                     // bảo đảm mọi mục đều có id

    mutator(data);                           // áp thao tác lên bản mới nhất

    await saveData(data);
    return data;
  } finally {
    if (spinner) hideGlobalSpinner();
  }
}

// ─── SPINNER & SYNC HELPERS ──────────────────────────────────────
function showGlobalSpinner(msg = '⏳ Đang đồng bộ dữ liệu...') {
  if (document.getElementById('global-spinner')) return;
  const spinner = document.createElement('div');
  spinner.id = 'global-spinner';
  spinner.innerHTML = `<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.7);backdrop-filter:blur(3px);z-index:9999;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:bold;color:var(--primary);text-align:center;padding:20px;">${msg}</div>`;
  document.body.appendChild(spinner);
}
function hideGlobalSpinner() {
  document.getElementById('global-spinner')?.remove();
}

async function handleManualSync() {
  showGlobalSpinner('🚀 Đang làm mới dữ liệu từ máy chủ...');
  await fetchServerData();
  hideGlobalSpinner();
  window.location.reload();
}

// ─── AUTH ─────────────────────────────────────────────────────────
function isLoggedIn() { return sessionStorage.getItem('session') === 'true'; }
function requireAuth() {
  if (!isLoggedIn()) { window.location.href = '/'; }
}
function logout() {
  sessionStorage.removeItem('session');
  window.location.href = '/';
}

// ─── UTILS ────────────────────────────────────────────────────────
function uuid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
// Định dạng "H:i d/m/Y" (giờ:phút 24h, rồi ngày/tháng/năm) — vd 14:30 23/07/2026
function formatTimeThenDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
}
function formatCurrency(num) {
  if (!num && num !== 0) return '';
  // ',' ngăn cách hàng nghìn, '.' cho phần thập phân
  return Number(num).toLocaleString('en-US') + ' ₫';
}

// Lấy số thuần từ chuỗi tiền có dấu ',' (vd "1,500,000" → "1500000")
function parseAmount(str) {
  return String(str ?? '').replace(/[^\d]/g, '');
}

// Tự thêm ',' ngăn hàng nghìn khi gõ vào ô tiền (giữ vị trí con trỏ theo số chữ số)
function attachThousandsInput(input) {
  if (!input || input.dataset.thousands === '1') return;
  input.dataset.thousands = '1';
  input.addEventListener('input', () => {
    const raw = input.value;
    const caret = input.selectionStart;
    const digitsBeforeCaret = raw.slice(0, caret).replace(/[^\d]/g, '').length;
    const digits = raw.replace(/[^\d]/g, '');
    const formatted = digits ? Number(digits).toLocaleString('en-US') : '';
    input.value = formatted;
    // đặt lại con trỏ sau đúng số chữ số như trước
    let pos = 0, count = 0;
    while (pos < formatted.length && count < digitsBeforeCaret) {
      if (/\d/.test(formatted[pos])) count++;
      pos++;
    }
    try { input.setSelectionRange(pos, pos); } catch (_) {}
  });
}
// Chuỗi cho input datetime-local theo GIỜ ĐỊA PHƯƠNG (toISOString là UTC nên không dùng)
function nowLocalDateTime() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// Hiển thị người dùng: trống hoặc chọn hết cả nhóm → "Cả nhóm" (cho gọn)
function formatUsersDisplay(users, members) {
  users = users || [];
  members = members || [];
  if (!users.length) return 'Cả nhóm';
  if (members.length && members.every(m => users.includes(m))) return 'Cả nhóm';
  return users.join(', ');
}
function randomEmoji() {
  return EVENT_EMOJIS[Math.floor(Math.random() * EVENT_EMOJIS.length)];
}

function populateUsersFields(ev, checkboxContainerId, selectPayerId) {
  const cbContainer = document.getElementById(checkboxContainerId);
  const selectPayer = document.getElementById(selectPayerId);
  if (!ev) return;
  const members = ev.members || [];
  if (cbContainer) {
    // Mặc định tích sẵn tất cả người dùng.
    cbContainer.innerHTML = members.map(m => `
      <label class="member-checkbox-label">
        <input type="checkbox" value="${escHtml(m)}" name="${checkboxContainerId}_cb" checked />
        ${escHtml(m)}
      </label>
    `).join('');
  }
  if (selectPayer) {
    selectPayer.innerHTML = `<option value="">-- Chọn người chi --</option>` + 
      members.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
  }
}

function getSelectedCheckboxValues(checkboxName) {
  const cbs = document.querySelectorAll(`input[name="${checkboxName}"]:checked`);
  return Array.from(cbs).map(cb => cb.value);
}

// ─── FORM VALIDATION (vé / hoá đơn) ───────────────────────────────
function clearFormErrors(form) {
  if (!form) return;
  form.querySelectorAll('.field-error-msg').forEach(el => el.remove());
  form.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));
}

function showFieldError(el, msg) {
  const group = el?.closest('.form-group') || el?.parentElement;
  if (!group) return;
  group.classList.add('has-error');
  if (!group.querySelector('.field-error-msg')) {
    const div = document.createElement('div');
    div.className = 'field-error-msg';
    div.textContent = msg;
    group.appendChild(div);
  }
}

// Bắt buộc: tên, tiền (>0), người chi. Người dùng KHÔNG bắt buộc (trống = cả nhóm).
// Người chi chỉ bắt buộc khi chuyến đi có thành viên để chọn.
function validateExpenseForm(form, { nameId, amountId, payerId }) {
  clearFormErrors(form);
  let firstInvalid = null;
  const fail = (el, msg) => { showFieldError(el, msg); if (!firstInvalid) firstInvalid = el; };

  const nameEl = document.getElementById(nameId);
  if (!nameEl.value.trim()) fail(nameEl, '⚠️ Vui lòng nhập thông tin này');

  const amountEl = document.getElementById(amountId);
  const amt = Number(parseAmount(amountEl.value));
  if (!parseAmount(amountEl.value) || amt <= 0) fail(amountEl, '⚠️ Nhập số tiền lớn hơn 0');

  const payerEl = document.getElementById(payerId);
  const hasPayerOptions = payerEl && payerEl.querySelectorAll('option').length > 1;
  if (hasPayerOptions && !payerEl.value) fail(payerEl, '⚠️ Vui lòng chọn người chi');

  if (firstInvalid) {
    firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
    try { firstInvalid.focus({ preventScroll: true }); } catch (_) {}
  }
  return !firstInvalid;
}

// ─── MODAL HELPERS ────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

function initModalCloseButtons() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
}

// ─── MULTI-FILE INPUT (accumulates files across picks) ─────────────────
// pendingFiles: Map<inputId, Array<{name, type, url?, data?}>>
//   url  → ảnh gốc đã upload lên Vercel Blob (giữ nguyên chất lượng)
//   data → base64 nhúng (fallback khi chạy local/không có API, hoặc upload lỗi)
const pendingFiles = {};

// ─── UPLOAD ẢNH LÊN VERCEL BLOB (client-upload) ───────────────────────────
// SDK được vendor sẵn ở /vendor/vercel-blob-client.js (không phụ thuộc CDN lúc chạy).
// Nạp lười (chỉ khi thật sự upload) để không làm chậm tải trang.
let _blobUploadFn = null;
async function getBlobUpload() {
  if (_blobUploadFn) return _blobUploadFn;
  const mod = await import('/vendor/vercel-blob-client.js');
  _blobUploadFn = mod.upload;
  return _blobUploadFn;
}

// Đưa 1 file vào giỏ: thử upload thẳng lên Blob → {url, type, name} (giữ nguyên ảnh gốc).
// Không có API (chạy local/static) hoặc lỗi → fallback base64 {data, type, name} như cũ.
async function ingestFile(file) {
  try {
    const upload = await getBlobUpload();
    const blob = await upload(file.name, file, {
      access: 'public',
      handleUploadUrl: '/api/uploadImage',
      contentType: file.type || undefined,
      clientPayload: window.UPLOAD_SECRET || undefined,
    });
    return { url: blob.url, type: file.type || 'application/octet-stream', name: file.name };
  } catch (e) {
    console.warn('Upload Blob thất bại, dùng base64 tạm:', e && e.message);
    const data = await readFileAsBase64(file);
    return { data, type: file.type, name: file.name };
  }
}

// Nguồn hiển thị của 1 file ảnh: ưu tiên URL (Blob) rồi tới base64 (dữ liệu cũ).
function imgSrc(img) {
  return (img && (img.url || img.data)) || '';
}

// Gom URL Blob của 1 vé/hoá đơn (để xoá khi xoá mục). Bỏ qua ảnh base64/cũ.
function collectImageUrls(item) {
  const urls = [];
  (item && item.images || []).forEach(im => { if (im && im.url) urls.push(im.url); });
  if (item && typeof item.image === 'string' && /^https?:/.test(item.image)) urls.push(item.image);
  return urls;
}

// Xoá 1 file trên Blob (fire-and-forget; chạy local không có API thì bỏ qua).
function deleteBlobUrl(url) {
  if (!url) return;
  fetch('/api/deleteImage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }).catch(() => {});
}

function setupMultiFileInput(inputId, previewId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  pendingFiles[inputId] = pendingFiles[inputId] || [];

  input.addEventListener('change', async () => {
    const files = Array.from(input.files);
    if (files.length) await ingestFiles(files, inputId, previewId);
    input.value = ''; // reset so same file can be re-added
  });

  const zone = input.closest('.file-drop-zone');
  if (zone) {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      if (files.length) await ingestFiles(files, inputId, previewId);
    });
  }
}

// Upload/nhúng nhiều file, có spinner (ảnh gốc có thể nặng nên upload mất chút thời gian).
async function ingestFiles(files, inputId, previewId) {
  showGlobalSpinner('⬆️ Đang tải ảnh lên...');
  try {
    for (const file of files) {
      pendingFiles[inputId].push(await ingestFile(file));
    }
  } finally {
    hideGlobalSpinner();
  }
  renderMultiFilePreview(inputId, previewId);
}

function renderMultiFilePreview(inputId, previewId) {
  const preview = document.getElementById(previewId);
  if (!preview) return;
  const files = pendingFiles[inputId] || [];
  if (!files.length) { preview.innerHTML = ''; return; }

  preview.innerHTML = files.map((f, i) => {
    const isImg = f.type.startsWith('image/');
    return `
      <div class="mfp-item" data-index="${i}">
        ${isImg
          ? `<img src="${imgSrc(f)}" alt="${escHtml(f.name)}" class="mfp-thumb" onclick="openPreviewGallery('${inputId}', ${i})" />`
          : `<div class="mfp-pdf" onclick="openPreviewGallery('${inputId}', ${i})">📄</div>`
        }
        <span class="mfp-name">${escHtml(f.name)}</span>
        <button class="mfp-remove" onclick="removePendingFile('${inputId}','${previewId}',${i})" title="Xóa file">✕</button>
      </div>`;
  }).join('');
}

window.removePendingFile = function(inputId, previewId, idx) {
  if (pendingFiles[inputId]) {
    const removed = pendingFiles[inputId].splice(idx, 1)[0];
    if (removed && removed.url) deleteBlobUrl(removed.url); // xoá file vừa gỡ khỏi kho
    renderMultiFilePreview(inputId, previewId);
  }
};

// Dọn giỏ khi MỞ form / HUỶ: các ảnh đã lỡ upload mà không dùng → xoá khỏi kho (tránh rác).
function clearPendingFiles(inputId, previewId) {
  (pendingFiles[inputId] || []).forEach(f => { if (f.url) deleteBlobUrl(f.url); });
  pendingFiles[inputId] = [];
  renderMultiFilePreview(inputId, previewId);
}

// Dọn giỏ SAU KHI LƯU THÀNH CÔNG: URL đã được gắn vào vé/hoá đơn nên KHÔNG xoá khỏi kho.
function consumePendingFiles(inputId, previewId) {
  pendingFiles[inputId] = [];
  renderMultiFilePreview(inputId, previewId);
}

// ─── FILE INPUT PREVIEW (single, backward compat) ───────────────────────
function setupFilePreview(inputId, previewId) {
  const input   = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) { preview.classList.add('hidden'); preview.innerHTML = ''; return; }
    preview.classList.remove('hidden');

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => {
        preview.innerHTML = `
          <img src="${e.target.result}" alt="preview" />
          <span class="file-preview-name">${file.name}</span>
          <button class="file-preview-remove" onclick="clearFileInput('${inputId}','${previewId}')">✕</button>`;
      };
      reader.readAsDataURL(file);
    } else {
      preview.innerHTML = `
        <span style="font-size:28px">📄</span>
        <span class="file-preview-name">${file.name}</span>
        <button class="file-preview-remove" onclick="clearFileInput('${inputId}','${previewId}')">✕</button>`;
    }
  });

  const zone = input.closest('.file-drop-zone');
  if (zone) {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop',      e => { e.preventDefault(); zone.classList.remove('drag-over'); input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); });
  }
}

function clearFileInput(inputId, previewId) {
  const input = document.getElementById(inputId);
  if (input) { input.value = ''; input.dispatchEvent(new Event('change')); }
}

// Read file as base64
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(base64, type) {
  try {
    const parts = base64.split(';base64,');
    const contentType = type || parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  } catch (e) {
    console.error('Lỗi chuyển đổi base64 to blob', e);
    return null;
  }
}

// ─── GALLERY IMAGE VIEWER ────────────────────────────────────────────────
let _viewerImages = [];  // [{data, type}]
let _viewerIndex  = 0;

window.viewImages = function(images, startIndex) {
  _viewerImages = images.map(img => ({
    url:  img.url,
    data: img.data,
    type: img.type || 'image/jpeg',
    name: img.name || 'file'
  }));
  _viewerIndex = startIndex || 0;
  _showViewerSlide();
  openModal('modalViewImage');
};

// Backward compat: single image
window.viewImage = function(src) {
  viewImages([{ data: src, type: 'image/jpeg' }], 0);
};

window.openPreviewGallery = function(inputId, imgIdx) {
  const files = pendingFiles[inputId] || [];
  viewImages(files, imgIdx);
};

function _showViewerSlide() {
  const img     = document.getElementById('viewerImg');
  const pdf     = document.getElementById('viewerPdf');
  const counter = document.getElementById('viewerCounter');
  const prev    = document.getElementById('viewerPrev');
  const next    = document.getElementById('viewerNext');
  const openBtn = document.getElementById('viewerOpenBtn');

  if (!img || !pdf) return;

  const cur = _viewerImages[_viewerIndex];
  if (!cur) return;

  const src   = imgSrc(cur);
  const isImg = (cur.type || '').startsWith('image/');
  const isPdf = (cur.type || '') === 'application/pdf' || src.startsWith('data:application/pdf');

  if (isImg) {
    img.src = src;
    img.classList.remove('hidden');
    pdf.classList.add('hidden');
    pdf.src = '';
  } else if (isPdf) {
    pdf.src = src;
    pdf.classList.remove('hidden');
    img.classList.add('hidden');
    img.src = '';
  } else {
    img.classList.add('hidden');
    pdf.classList.add('hidden');
  }

  if (openBtn) {
    if (src.startsWith('data:')) {
      const blob = base64ToBlob(src, cur.type);
      openBtn.href = blob ? URL.createObjectURL(blob) : src;
    } else {
      openBtn.href = src || '#';
    }
    
    if (isPdf) {
      openBtn.setAttribute('download', cur.name || 'file.pdf');
    } else {
      openBtn.removeAttribute('download');
    }
  }

  const total = _viewerImages.length;
  if (counter) counter.textContent = total > 1 ? `${_viewerIndex + 1} / ${total}` : '';
  if (prev) prev.style.display = total > 1 ? 'flex' : 'none';
  if (next) next.style.display = total > 1 ? 'flex' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('viewerPrev')?.addEventListener('click', e => {
    e.stopPropagation();
    _viewerIndex = (_viewerIndex - 1 + _viewerImages.length) % _viewerImages.length;
    _showViewerSlide();
  });
  document.getElementById('viewerNext')?.addEventListener('click', e => {
    e.stopPropagation();
    _viewerIndex = (_viewerIndex + 1) % _viewerImages.length;
    _showViewerSlide();
  });
  // Keyboard nav
  document.addEventListener('keydown', e => {
    const viewer = document.getElementById('modalViewImage');
    if (!viewer || viewer.classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft')  { _viewerIndex = (_viewerIndex - 1 + _viewerImages.length) % _viewerImages.length; _showViewerSlide(); }
    if (e.key === 'ArrowRight') { _viewerIndex = (_viewerIndex + 1) % _viewerImages.length; _showViewerSlide(); }
    if (e.key === 'Escape') closeModal('modalViewImage');
  });
});

/* ==================================================================
   app.js – Gia Đình HaHa
================================================================== */
function initLoginPage() {
  // Already logged in → go to dashboard
  if (isLoggedIn()) { window.location.href = '/dashboard.html'; return; }

  const form       = document.getElementById('loginForm');
  const errBox     = document.getElementById('loginError');
  const toggleBtn  = document.getElementById('togglePwd');
  const pwdInput   = document.getElementById('password');

  if (!form) return;

  toggleBtn?.addEventListener('click', () => {
    const isText = pwdInput.type === 'text';
    pwdInput.type = isText ? 'password' : 'text';
    toggleBtn.textContent = isText ? '👁️' : '🙈';
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = pwdInput.value;

    if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
      sessionStorage.setItem('session', 'true');
      window.location.href = '/dashboard.html';
    } else {
      errBox.classList.remove('hidden');
      form.querySelector('input').focus();
      setTimeout(() => errBox.classList.add('hidden'), 3500);
    }
  });
}

/* ==================================================================
   PAGE: DASHBOARD (dashboard.html)
================================================================== */
function initDashboardPage() {
  requireAuth();

  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  document.getElementById('syncBtn')?.addEventListener('click', handleManualSync);

  const grid       = document.getElementById('eventGrid');
  const emptyState = document.getElementById('emptyState');
  const fabCreate  = document.getElementById('fabCreate');
  const formCreate = document.getElementById('formCreateEvent');
  const memberInput= document.getElementById('memberInput');
  const addMember  = document.getElementById('addMemberBtn');
  const memberTags = document.getElementById('memberTags');

  let pendingMembers = [];
  let pendingDeleteId = null;

  initModalCloseButtons();
  document.querySelectorAll('.amount-input').forEach(attachThousandsInput);

  // Open create modal
  fabCreate?.addEventListener('click', () => {
    pendingMembers = [];
    renderMemberTags();
    formCreate?.reset();
    openModal('modalCreateEvent');
    document.getElementById('eventName')?.focus();
  });

  // Member input
  function addMemberFromInput() {
    const val = memberInput.value.trim();
    if (!val) return;
    pendingMembers.push(val);
    memberInput.value = '';
    memberInput.focus();
    renderMemberTags();
  }

  addMember?.addEventListener('click', addMemberFromInput);
  memberInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addMemberFromInput(); }
  });

  function renderMemberTags() {
    if (!memberTags) return;
    memberTags.innerHTML = pendingMembers.map((m, i) => `
      <span class="member-chip">
        👤 ${escHtml(m)}
        <button class="chip-remove" onclick="removePendingMember(${i})" aria-label="Xoá ${escHtml(m)}">✕</button>
      </span>`).join('');
  }
  window.removePendingMember = function(i) {
    pendingMembers.splice(i, 1);
    renderMemberTags();
  };

  // Create event submit
  formCreate?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('eventName').value.trim();
    const date = document.getElementById('eventDate').value;
    if (!name) return;

    const newEvent = {
      id:      uuid(),
      emoji:   randomEmoji(),
      name,
      date,
      members: [...pendingMembers],
      tickets:  [],
      invoices: [],
      createdAt: new Date().toISOString(),
    };
    await mutateData(fresh => { fresh.events.push(newEvent); });
    closeModal('modalCreateEvent');
    renderEvents();
  });

  // Delete event
  document.getElementById('confirmDeleteEvent')?.addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    const delId = pendingDeleteId;
    const urlsToDelete = [];
    await mutateData(fresh => {
      const ev = fresh.events.find(e => e.id === delId);
      if (ev) {
        (ev.tickets  || []).forEach(t  => urlsToDelete.push(...collectImageUrls(t)));
        (ev.invoices || []).forEach(iv => urlsToDelete.push(...collectImageUrls(iv)));
      }
      fresh.events = fresh.events.filter(e => e.id !== delId);
    });
    urlsToDelete.forEach(deleteBlobUrl); // dọn toàn bộ ảnh của chuyến đi khỏi kho
    pendingDeleteId = null;
    closeModal('modalDeleteEvent');
    renderEvents();
  });

  window.openDeleteEvent = function(id) {
    pendingDeleteId = id;
    openModal('modalDeleteEvent');
  };

  // Render
  function renderEvents() {
    const data = loadData();
    const events = data.events.slice().reverse();
    grid.innerHTML = '';

    if (events.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    events.forEach(ev => {
      const totalAmount = ev.tickets.reduce((sum, t) => sum + Number(t.amount || 0), 0) 
                        + ev.invoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);

      const card = document.createElement('div');
      card.className = 'event-card';
      card.innerHTML = `
        <div class="event-card-emoji">${ev.emoji || '✈️'}</div>
        <div class="event-card-name">${escHtml(ev.name)}</div>
        <div class="event-card-date">${ev.date ? '📅 ' + formatDate(ev.date) : '📅 Chưa xác định ngày'}</div>
        <div class="event-card-meta">
          <span class="badge badge-blue">🎫 ${ev.tickets.length} vé</span>
          <span class="badge badge-green">🧾 ${ev.invoices.length} hoá đơn</span>
          ${ev.members.length ? `<span class="badge badge-blue">👥 ${ev.members.length} người</span>` : ''}
          ${totalAmount > 0 ? `<span class="badge badge-green">💰 ${formatCurrency(totalAmount)}</span>` : ''}
        </div>
        ${ev.members.length ? `<div class="member-chips">${ev.members.map(m=>`<span class="member-chip">👤 ${escHtml(m)}</span>`).join('')}</div>` : ''}
        <div class="event-card-actions">
          <button class="btn-icon qab-ticket-sm" title="Thêm vé" onclick="event.stopPropagation(); openQuickTicket('${ev.id}')">🎫</button>
          <button class="btn-icon qab-invoice-sm" title="Thêm hoá đơn" onclick="event.stopPropagation(); openQuickInvoice('${ev.id}')">🧾</button>
          <button class="btn-icon" title="Xoá" onclick="event.stopPropagation(); openDeleteEvent('${ev.id}')">🗑️</button>
        </div>`;
      card.addEventListener('click', () => { window.location.href = `/event.html?id=${ev.id}`; });
      grid.appendChild(card);
    });
  }

  // ── Quick-add: Vé nhanh từ dashboard ──
  setupMultiFileInput('qtTicketFile', 'qtTicketFilePreview');
  setupMultiFileInput('qiFile',       'qiFilePreview');

  window.openQuickTicket = function(eventId) {
    document.getElementById('formQuickTicket')?.reset();
    clearFormErrors(document.getElementById('formQuickTicket'));
    clearPendingFiles('qtTicketFile', 'qtTicketFilePreview');
    document.getElementById('qtTargetEventId').value = eventId;
    const data = loadData();
    const ev = data.events.find(x => x.id === eventId);
    populateUsersFields(ev, 'qtTicketUsers', 'qtTicketPayer');
    openModal('modalQuickTicket');
    document.getElementById('qtTicketName')?.focus();
  };

  window.openQuickInvoice = function(eventId) {
    document.getElementById('formQuickInvoice')?.reset();
    clearFormErrors(document.getElementById('formQuickInvoice'));
    clearPendingFiles('qiFile', 'qiFilePreview');
    document.getElementById('qiDate').value = nowLocalDateTime();
    document.getElementById('qiTargetEventId').value = eventId;
    const data = loadData();
    const ev = data.events.find(x => x.id === eventId);
    populateUsersFields(ev, 'qiUsers', 'qiPayer');
    openModal('modalQuickInvoice');
    document.getElementById('qiTitle')?.focus();
  };

  document.getElementById('formQuickTicket')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateExpenseForm(e.target, { nameId:'qtTicketName', amountId:'qtTicketAmount', payerId:'qtTicketPayer' })) return;
    const evId = document.getElementById('qtTargetEventId').value;
    const files = pendingFiles['qtTicketFile'] || [];
    const images = files.map(f => f.url
      ? { url: f.url, type: f.type, name: f.name }
      : { data: f.data, type: f.type, name: f.name });
    const ticket = {
      id:      uuid(),
      type:    document.getElementById('qtTicketType').value,
      name:    document.getElementById('qtTicketName').value.trim(),
      code:    document.getElementById('qtTicketCode').value.trim(),
      date:    document.getElementById('qtTicketDate').value,
      amount:  parseAmount(document.getElementById('qtTicketAmount').value),
      users:   getSelectedCheckboxValues('qtTicketUsers_cb'),
      payer:   document.getElementById('qtTicketPayer').value,
      note:    document.getElementById('qtTicketNote').value.trim(),
      images,
      image: null,
      addedAt: new Date().toISOString(),
    };
    await mutateData(fresh => {
      const ev = fresh.events.find(x => x.id === evId);
      if (ev) ev.tickets.push(ticket);
    });
    consumePendingFiles('qtTicketFile', 'qtTicketFilePreview');
    closeModal('modalQuickTicket');
    renderEvents();
  });

  document.getElementById('formQuickInvoice')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateExpenseForm(e.target, { nameId:'qiTitle', amountId:'qiAmount', payerId:'qiPayer' })) return;
    const evId = document.getElementById('qiTargetEventId').value;
    const files = pendingFiles['qiFile'] || [];
    const images = files.map(f => f.url
      ? { url: f.url, type: f.type, name: f.name }
      : { data: f.data, type: f.type, name: f.name });
    const invoice = {
      id:      uuid(),
      title:   document.getElementById('qiTitle').value.trim(),
      amount:  parseAmount(document.getElementById('qiAmount').value),
      users:   getSelectedCheckboxValues('qiUsers_cb'),
      payer:   document.getElementById('qiPayer').value,
      date:    document.getElementById('qiDate').value,
      note:    document.getElementById('qiNote').value.trim(),
      images,
      image: null,
      addedAt: new Date().toISOString(),
    };
    await mutateData(fresh => {
      const ev = fresh.events.find(x => x.id === evId);
      if (ev) ev.invoices.push(invoice);
    });
    consumePendingFiles('qiFile', 'qiFilePreview');
    closeModal('modalQuickInvoice');
    renderEvents();
  });

  renderEvents();
}

/* ==================================================================
   PAGE: EVENT DETAIL (event.html)
================================================================== */
function initEventPage() {
  requireAuth();

  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  document.getElementById('syncBtn')?.addEventListener('click', handleManualSync);

  const params  = new URLSearchParams(window.location.search);
  const eventId = params.get('id');
  if (!eventId) { window.location.href = '/dashboard.html'; return; }

  initModalCloseButtons();
  document.querySelectorAll('.amount-input').forEach(attachThousandsInput);
  setupMultiFileInput('invoiceFile', 'invoiceFilePreview');

  let pendingDeleteType = null; // 'ticket' | 'invoice'
  let pendingDeleteId   = null;

  // ── Load event ──
  function getEvent() {
    const data = loadData();
    return data.events.find(e => e.id === eventId);
  }

  // ── Render header ──
  function renderEventInfo() {
    const ev = getEvent();
    if (!ev) { window.location.href = '/dashboard.html'; return; }
    document.title = `${ev.name} – Gia Đình HaHa`;
    document.getElementById('eventPageTitle').textContent = ev.name;
    document.getElementById('infoName').textContent = ev.name;
    document.getElementById('infoDate').textContent = ev.date ? '📅 ' + formatDate(ev.date) : '';
    document.getElementById('infoMembers').innerHTML = ev.members.map(m =>
      `<span class="member-chip">👤 ${escHtml(m)}</span>`).join('');
  }

  // ── Tabs ──
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      document.getElementById('panel' + capitalise(btn.dataset.tab))?.classList.remove('hidden');
      if (btn.dataset.tab === 'summary') renderSummary(); // làm mới khi vào tab tổng hợp
    });
  });

  // ── Render tickets ──
  function getTicketImages(t) {
    // Support new `images` array and old single `image` field
    if (t.images && t.images.length) return t.images;
    if (t.image) return [{ data: t.image, type: 'image/jpeg', name: 'file' }];
    return [];
  }

  window.openTicketGallery = function(ticketIdx, imgIdx) {
    const ev = getEvent();
    if (!ev) return;
    const t = ev.tickets[ticketIdx];
    const imgs = getTicketImages(t);
    viewImages(imgs, imgIdx);
  };

  function getInvoiceImages(inv) {
    if (inv.images && inv.images.length) return inv.images;
    if (inv.image) return [{ data: inv.image, type: 'image/jpeg', name: 'file' }];
    return [];
  }

  window.openInvoiceGallery = function(invoiceIdx, imgIdx) {
    const ev = getEvent();
    if (!ev) return;
    const inv = ev.invoices[invoiceIdx];
    const imgs = getInvoiceImages(inv);
    viewImages(imgs, imgIdx || 0);
  };

  function renderTickets() {
    const ev   = getEvent();
    const list = document.getElementById('ticketList');
    const empty= document.getElementById('emptyTickets');
    if (!ev) return;

    list.innerHTML = '';
    if (!ev.tickets.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    ev.tickets.forEach((t, i) => {
      const imgs = getTicketImages(t);

      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <div class="item-icon">${TICKET_ICONS[t.type] || '📄'}</div>
        <div class="item-body">
          <div class="item-type">${escHtml(t.type)}</div>
          <div class="item-name">${escHtml(t.name)}</div>
          <div class="item-meta">
            ${t.code      ? `<span>🔑 ${escHtml(t.code)}</span>`           : ''}
            ${t.date      ? `<span>📅 ${formatDateTime(t.date)}</span>`    : ''}
            ${t.amount    ? `<span>💰 ${formatCurrency(t.amount)}</span>`  : ''}
            <span>👥 ${escHtml(formatUsersDisplay(t.users, ev.members))}</span>
            ${t.payer     ? `<span>💳 ${escHtml(t.payer)}</span>`          : ''}
          </div>
          ${t.note ? noteHtml('💬', t.note) : ''}
          ${imgs.length ? `
            <div class="ticket-img-gallery">
              ${imgs.map((img, gi) => {
                const isImg = (img.type || '').startsWith('image/');
                return isImg
                  ? `<img src="${imgSrc(img)}" class="gallery-thumb" alt="file ${gi+1}" onclick="openTicketGallery(${i}, ${gi})" />`
                  : `<div class="gallery-thumb gallery-pdf" onclick="openTicketGallery(${i}, ${gi})">📄<span>${escHtml(img.name||'PDF')}</span></div>`;
              }).join('')}
              <span class="gallery-count">${imgs.length} file</span>
            </div>` : ''}
        </div>
        <div class="item-actions">
          <button class="btn-icon" title="Xoá" onclick="askDeleteItem('ticket','${t.id}')">🗑️</button>
        </div>`;
      list.appendChild(card);
    });
    setupNoteClamps(list);
  }

  // ── Render invoices ──
  function renderInvoices() {
    const ev   = getEvent();
    const list = document.getElementById('invoiceList');
    const empty= document.getElementById('emptyInvoices');
    if (!ev) return;

    list.innerHTML = '';
    if (!ev.invoices.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    ev.invoices.forEach((inv, i) => {
      const imgs = getInvoiceImages(inv);

      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <div class="item-icon">🧾</div>
        <div class="item-body">
          <div class="item-name">${escHtml(inv.title)}</div>
          <div class="item-meta">
            ${inv.date ? `<span>📅 ${formatDateTime(inv.date)}</span>` : ''}
            ${inv.amount ? `<span>💰 ${formatCurrency(inv.amount)}</span>` : ''}
            <span>👥 ${escHtml(formatUsersDisplay(inv.users, ev.members))}</span>
            ${inv.payer ? `<span>💳 ${escHtml(inv.payer)}</span>` : ''}
          </div>
          ${inv.note   ? noteHtml('📝', inv.note) : ''}
          ${imgs.length ? `
            <div class="ticket-img-gallery">
              ${imgs.map((img, gi) => {
                const isImg = (img.type || '').startsWith('image/');
                return isImg
                  ? `<img src="${imgSrc(img)}" class="gallery-thumb" alt="file ${gi+1}" onclick="openInvoiceGallery(${i}, ${gi})" />`
                  : `<div class="gallery-thumb gallery-pdf" onclick="openInvoiceGallery(${i}, ${gi})">📄<span>${escHtml(img.name||'PDF')}</span></div>`;
              }).join('')}
              <span class="gallery-count">${imgs.length} file</span>
            </div>` : ''}
        </div>
        <div class="item-actions">
          <button class="btn-icon" title="Xoá" onclick="askDeleteItem('invoice','${inv.id}')">🗑️</button>
        </div>`;
      list.appendChild(card);
    });
    setupNoteClamps(list);
  }

  // ── Render Schedule ──
  function renderSchedule() {
    const ev = getEvent();
    const display = document.getElementById('scheduleDisplay');
    if (!ev || !display) return;

    if (!ev.schedule || !ev.schedule.trim()) {
      display.innerHTML = `
        <div class="empty-state-sm">
          <span>🗓️</span> Chưa có lịch trình. Nhấn <button style="padding:0; border:none; background:none; font-weight:bold; cursor:pointer; color:var(--primary); text-decoration:underline; font-size:inherit;" onclick="openEditSchedule()">Chỉnh sửa</button> để paste lịch trình vào nhé!
        </div>
      `;
      return;
    }

    // Convert newlines to <br> and wrap bold dates/titles
    let html = escHtml(ev.schedule).replace(/\n/g, '<br>');
    // Auto-bold lines that look like headers (Day X, etc)
    html = html.replace(/^(<b>)?(Ngày \d+|Day \d+|Lịch trình|Sáng|Trưa|Chiều|Tối).*$/gim, '<b>$&</b>');
    display.innerHTML = html;
  }

  // ── Schedule Events ──
  function openEditSchedule() {
    const ev = getEvent();
    if (!ev) return;
    document.getElementById('scheduleInput').value = ev.schedule || '';
    openModal('modalEditSchedule');
    document.getElementById('scheduleInput').focus();
  }
  window.openEditSchedule = openEditSchedule;

  document.getElementById('editScheduleBtn')?.addEventListener('click', openEditSchedule);
  document.getElementById('fabEditSchedule')?.addEventListener('click', openEditSchedule);

  document.getElementById('formEditSchedule')?.addEventListener('submit', async e => {
    e.preventDefault();
    const schedule = document.getElementById('scheduleInput').value;
    await mutateData(fresh => {
      const ev = fresh.events.find(e => e.id === eventId);
      if (ev) ev.schedule = schedule;
    });
    closeModal('modalEditSchedule');
    renderSchedule();
  });

  // ── Tổng hợp & quyết toán ──
  // Mỗi khoản chia đều cho "người dùng" của khoản đó → ra "nên trả".
  // "Đã chi" = tổng các khoản mình đứng ra trả. Chênh lệch = đã chi − nên trả.
  function computeSettlement(ev) {
    const members = ev.members || [];
    const people = new Set(members);

    const items = [];
    (ev.tickets || []).forEach(t => items.push({
      icon:   TICKET_ICONS[t.type] || '📄',
      label:  t.name || t.type || 'Vé',
      amount: Number(t.amount || 0),
      payer:  t.payer || '',
      users:  (t.users && t.users.length) ? t.users : [],
      date:   t.date || '',
    }));
    (ev.invoices || []).forEach(inv => items.push({
      icon:   '🧾',
      label:  inv.title || 'Hoá đơn',
      amount: Number(inv.amount || 0),
      payer:  inv.payer || '',
      users:  (inv.users && inv.users.length) ? inv.users : [],
      date:   inv.date || '',
    }));
    items.forEach(it => { if (it.payer) people.add(it.payer); it.users.forEach(u => people.add(u)); });

    const paid = {}, share = {};
    people.forEach(p => { paid[p] = 0; share[p] = 0; });

    let total = 0;
    items.forEach(it => {
      total += it.amount;
      if (it.amount > 0 && it.payer) {
        paid[it.payer] = (paid[it.payer] || 0) + it.amount;
        const beneficiaries = it.users.length ? it.users : members; // không chọn ai → chia cho cả nhóm
        if (beneficiaries.length) {
          const per = it.amount / beneficiaries.length;
          beneficiaries.forEach(b => { share[b] = (share[b] || 0) + per; });
        }
      }
    });

    const rows = Array.from(people).map(p => ({
      name: p, paid: paid[p] || 0, share: share[p] || 0, net: (paid[p] || 0) - (share[p] || 0),
    }));
    return { rows, total, items };
  }

  function renderSummary() {
    const ev = getEvent();
    const panel = document.getElementById('panelSummary');
    if (!ev || !panel) return;

    // Ô chọn thủ quỹ
    const sel = document.getElementById('treasurerSelect');
    const members = ev.members || [];
    sel.innerHTML = `<option value="">— Chưa chọn —</option>` +
      members.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
    sel.value = ev.treasurer || '';

    const container = document.getElementById('summaryContent');
    const { rows, total, items } = computeSettlement(ev);
    const treasurer = ev.treasurer || '';

    if (!items.length) {
      container.innerHTML = `<div class="empty-state-sm"><span>📊</span> Chưa có khoản chi nào để tổng hợp.</div>`;
      return;
    }

    const fmt = n => formatCurrency(Math.round(n));

    const peopleRows = rows.map(r => {
      const net = Math.round(r.net);
      const isT = treasurer && r.name === treasurer;
      let action = '', acls = '';
      if (isT)          { action = '🧑‍💼 Thủ quỹ'; }
      else if (net > 0) { action = treasurer ? `⬅️ Thủ quỹ trả lại <b>${fmt(net)}</b>` : `nên được nhận lại <b>${fmt(net)}</b>`;  acls = 'net-pos'; }
      else if (net < 0) { action = treasurer ? `➡️ Chuyển thủ quỹ <b>${fmt(-net)}</b>` : `còn phải bù <b>${fmt(-net)}</b>`; acls = 'net-neg'; }
      else              { action = '✅ Cân bằng'; }
      const netCls = net > 0 ? 'net-pos' : net < 0 ? 'net-neg' : '';
      return `
        <tr>
          <td>👤 ${escHtml(r.name)}${isT ? ' 🧑‍💼' : ''}</td>
          <td class="num">${fmt(r.paid)}</td>
          <td class="num">${fmt(r.share)}</td>
          <td class="num ${netCls}">${net > 0 ? '+' : ''}${fmt(net)}</td>
          <td class="${acls}">${action}</td>
        </tr>`;
    }).join('');

    const detailRows = items.map(it => `
      <tr>
        <td>${it.icon} ${escHtml(it.label)}${it.date ? `<div class="summary-time">🕒 ${escHtml(formatTimeThenDate(it.date))}</div>` : ''}</td>
        <td>${it.payer ? '💳 ' + escHtml(it.payer) : '<span class="muted">— chưa chọn —</span>'}</td>
        <td>${escHtml(formatUsersDisplay(it.users, members))}</td>
        <td class="num">${formatCurrency(it.amount)}</td>
      </tr>`).join('');

    container.innerHTML = `
      <div class="summary-total glass">💰 Tổng chi cả nhóm: <b>${formatCurrency(total)}</b></div>
      ${treasurer ? '' : `<div class="summary-hint">💡 Chọn người thủ quỹ ở trên để biết ai chuyển tiền cho ai.</div>`}
      <h4 class="summary-subtitle">👥 Theo từng người</h4>
      <div class="table-wrap">
        <table class="summary-table">
          <thead><tr><th>Người</th><th class="num">Đã chi</th><th class="num">Nên trả</th><th class="num">Chênh lệch</th><th>Cần làm</th></tr></thead>
          <tbody>${peopleRows}</tbody>
        </table>
      </div>
      <h4 class="summary-subtitle">🧾 Chi tiết các khoản</h4>
      <div class="table-wrap">
        <table class="summary-table">
          <thead><tr><th>Khoản</th><th>Người chi</th><th>Người dùng</th><th class="num">Số tiền</th></tr></thead>
          <tbody>${detailRows}</tbody>
        </table>
      </div>`;
  }

  document.getElementById('treasurerSelect')?.addEventListener('change', async e => {
    const val = e.target.value;
    await mutateData(fresh => {
      const evx = fresh.events.find(ee => ee.id === eventId);
      if (evx) evx.treasurer = val;
    });
    renderSummary();
  });

  // ── Add ticket ──
  setupMultiFileInput('ticketFile', 'ticketFilePreview');

  document.getElementById('addTicketBtn')?.addEventListener('click', () => {
    document.getElementById('formAddTicket')?.reset();
    clearFormErrors(document.getElementById('formAddTicket'));
    clearPendingFiles('ticketFile', 'ticketFilePreview');
    const ev = getEvent();
    populateUsersFields(ev, 'ticketUsers', 'ticketPayer');
    openModal('modalAddTicket');
    document.getElementById('ticketName')?.focus();
  });

  document.getElementById('formAddTicket')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateExpenseForm(e.target, { nameId:'ticketName', amountId:'ticketAmount', payerId:'ticketPayer' })) return;

    // Collect all pending files
    const files = pendingFiles['ticketFile'] || [];
    const images = files.map(f => f.url
      ? { url: f.url, type: f.type, name: f.name }
      : { data: f.data, type: f.type, name: f.name });

    const ticket = {
      id:        uuid(),
      type:      document.getElementById('ticketType').value,
      name:      document.getElementById('ticketName').value.trim(),
      code:      document.getElementById('ticketCode').value.trim(),
      date:      document.getElementById('ticketDate').value,
      amount:    parseAmount(document.getElementById('ticketAmount').value),
      users:     getSelectedCheckboxValues('ticketUsers_cb'),
      payer:     document.getElementById('ticketPayer').value,
      note:      document.getElementById('ticketNote').value.trim(),
      images,           // array of {data, type, name}
      image: null,      // deprecated, kept for compat
      addedAt:   new Date().toISOString(),
    };
    await mutateData(fresh => {
      const ev = fresh.events.find(e => e.id === eventId);
      if (ev) ev.tickets.push(ticket);
    });
    consumePendingFiles('ticketFile', 'ticketFilePreview');
    closeModal('modalAddTicket');
    renderTickets();
  });

  // ── Add invoice ──
  document.getElementById('addInvoiceBtn')?.addEventListener('click', () => {
    document.getElementById('formAddInvoice')?.reset();
    clearFormErrors(document.getElementById('formAddInvoice'));
    clearPendingFiles('invoiceFile', 'invoiceFilePreview');
    document.getElementById('invoiceDate').value = nowLocalDateTime();
    const ev = getEvent();
    populateUsersFields(ev, 'invoiceUsers', 'invoicePayer');
    openModal('modalAddInvoice');
    document.getElementById('invoiceTitle')?.focus();
  });

  document.getElementById('formAddInvoice')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateExpenseForm(e.target, { nameId:'invoiceTitle', amountId:'invoiceAmount', payerId:'invoicePayer' })) return;

    const files = pendingFiles['invoiceFile'] || [];
    const images = files.map(f => f.url
      ? { url: f.url, type: f.type, name: f.name }
      : { data: f.data, type: f.type, name: f.name });

    const invoice = {
      id:      uuid(),
      title:   document.getElementById('invoiceTitle').value.trim(),
      amount:  parseAmount(document.getElementById('invoiceAmount').value),
      users:   getSelectedCheckboxValues('invoiceUsers_cb'),
      payer:   document.getElementById('invoicePayer').value,
      date:    document.getElementById('invoiceDate').value,
      note:    document.getElementById('invoiceNote').value.trim(),
      images,
      image: null,
      addedAt: new Date().toISOString(),
    };
    await mutateData(fresh => {
      const ev = fresh.events.find(e => e.id === eventId);
      if (ev) ev.invoices.push(invoice);
    });
    consumePendingFiles('invoiceFile', 'invoiceFilePreview');
    closeModal('modalAddInvoice');
    renderInvoices();
  });

  // ── Delete item ──
  window.askDeleteItem = function(type, id) {
    pendingDeleteType = type;
    pendingDeleteId   = id;
    openModal('modalDeleteItem');
  };

  document.getElementById('confirmDeleteItem')?.addEventListener('click', async () => {
    const delType = pendingDeleteType;
    const delId   = pendingDeleteId;
    if (!delId) return;
    const urlsToDelete = [];
    await mutateData(fresh => {
      const ev = fresh.events.find(e => e.id === eventId);
      if (!ev) return;
      if (delType === 'ticket') {
        const t = (ev.tickets || []).find(t => t.id === delId);
        if (t) urlsToDelete.push(...collectImageUrls(t));
        ev.tickets = ev.tickets.filter(t => t.id !== delId);
      }
      if (delType === 'invoice') {
        const iv = (ev.invoices || []).find(iv => iv.id === delId);
        if (iv) urlsToDelete.push(...collectImageUrls(iv));
        ev.invoices = ev.invoices.filter(iv => iv.id !== delId);
      }
    });
    urlsToDelete.forEach(deleteBlobUrl); // dọn ảnh trên kho, tránh rác
    closeModal('modalDeleteItem');
    renderTickets();
    renderInvoices();
    pendingDeleteType = null;
    pendingDeleteId   = null;
  });

  // ── Image viewer ──
  window.viewImage = function(src) {
    document.getElementById('viewerImg').src = src;
    openModal('modalViewImage');
  };

  // ── Init ──
  renderEventInfo();
  renderTickets();
  renderInvoices();
  renderSchedule();
  renderSummary();
}

// ─── ESCAPE HTML ─────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// Escape HTML an toàn rồi biến các URL http/https thành link click được.
function linkify(str) {
  return escHtml(str).replace(/(https?:\/\/[^\s<]+)/g, (url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer" class="item-link">${url}</a>`
  );
}

// Render 1 ghi chú: giữ nguyên xuống dòng (CSS pre-wrap) + link + nút mở rộng/thu gọn.
function noteHtml(icon, text) {
  return `<div class="item-note">
            <div class="note-text">${icon} ${linkify(text)}</div>
            <button class="note-toggle hidden" type="button" onclick="toggleNote(this)">Xem thêm ▾</button>
          </div>`;
}

// Chỉ hiện nút mở rộng khi nội dung thực sự bị cắt (dài quá số dòng cho phép).
function setupNoteClamps(container) {
  if (!container) return;
  container.querySelectorAll('.item-note').forEach(note => {
    const text = note.querySelector('.note-text');
    const btn  = note.querySelector('.note-toggle');
    if (!text || !btn) return;
    note.classList.remove('expanded');
    btn.classList.toggle('hidden', text.scrollHeight - text.clientHeight <= 2);
  });
}

window.toggleNote = function(btn) {
  const note = btn.closest('.item-note');
  if (!note) return;
  const expanded = note.classList.toggle('expanded');
  btn.textContent = expanded ? 'Thu gọn ▴' : 'Xem thêm ▾';
};

function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ─── ROUTER ──────────────────────────────────────────────────────
(async function route() {
  if (isLoggedIn()) {
    showGlobalSpinner();
    await fetchServerData();
    hideGlobalSpinner();
  }

  const path = window.location.pathname;
  if (path === '/' || path.endsWith('index.html'))      initLoginPage();
  else if (path.endsWith('dashboard.html'))             initDashboardPage();
  else if (path.endsWith('event.html'))                 initEventPage();
})();

// ─── PWA SERVICE WORKER REGISTRATION ─────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('SW registered!', reg);
    }).catch(err => console.log('SW registration failed', err));
  });
}

