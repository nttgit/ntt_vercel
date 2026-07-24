/**
 * MIGRATION CHẠY 1 LẦN: chuyển ảnh cũ đang lưu base64 (nhúng trong khối
 * ticketVaultData ở Redis) → upload lên Vercel Blob → thay bằng { url }.
 * Mục đích: khối JSON teo lại → /api/getData nhanh hẳn.
 *
 * Chạy trên VERCEL vì ở đó đã có sẵn mọi env (Redis + Blob).
 * Bảo vệ bằng env MIGRATE_SECRET. Gọi lặp lại đến khi remaining = 0.
 *
 *   Xem trước (không đổi gì):  GET /api/migrateImages?key=SECRET&dry=1
 *   Chạy từng đợt:            GET /api/migrateImages?key=SECRET&limit=5
 *
 * An toàn:
 *  - Idempotent: chỉ đụng ảnh có .data (base64) và CHƯA có .url.
 *  - Xử lý theo đợt nhỏ (limit) để không timeout function.
 *  - Ghi lại Redis sau mỗi đợt → chạy lại được, không mất tiến độ.
 *  - Nên chạy khi KHÔNG ai đang thêm/sửa vé (tránh ghi đè lẫn nhau).
 *
 * Xong việc: xoá file này + xoá env MIGRATE_SECRET cho gọn.
 */

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
  'image/heif': 'heif', 'application/pdf': 'pdf',
};

function parseDataUrl(s) {
  if (typeof s !== 'string') return null;
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(s);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const isB64 = !!m[2];
  const buffer = isB64
    ? Buffer.from(m[3], 'base64')
    : Buffer.from(decodeURIComponent(m[3]));
  return { mime, buffer };
}

export default async function handler(req, res) {
  const secret = process.env.MIGRATE_SECRET;
  const provided = (req.query && (req.query.key || req.query.secret)) || req.headers['x-migrate-key'];
  if (!secret) {
    return res.status(400).json({ error: 'Chưa đặt env MIGRATE_SECRET trên Vercel.' });
  }
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized (sai hoặc thiếu ?key=).' });
  }

  const dryRun = req.query && (req.query.dry === '1' || req.query.dry === 'true');
  let limit = parseInt((req.query && req.query.limit) || '5', 10);
  if (isNaN(limit) || limit < 1) limit = 5;
  if (limit > 25) limit = 25;

  try {
    const { Redis } = await import('@upstash/redis');
    const { put } = await import('@vercel/blob');
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const data = (await redis.get('ticketVaultData')) || { events: [] };
    const events = Array.isArray(data.events) ? data.events : [];

    // Gom mọi ảnh base64 còn tồn đọng (chưa có url).
    const pending = [];
    events.forEach(ev => {
      const items = [].concat(ev.tickets || [], ev.invoices || []);
      items.forEach(item => {
        (item.images || []).forEach(im => {
          if (im && typeof im.data === 'string' && !im.url && im.data.indexOf('data:') === 0) {
            pending.push({ kind: 'images', im, item });
          }
        });
        // Ảnh cũ dạng chuỗi đơn item.image (base64) → chuẩn hoá vào images[].
        if (typeof item.image === 'string' && item.image.indexOf('data:') === 0) {
          pending.push({ kind: 'legacy', item });
        }
      });
    });

    const totalPending = pending.length;

    if (dryRun) {
      return res.status(200).json({ dryRun: true, remaining: totalPending });
    }

    const batch = pending.slice(0, limit);
    let migrated = 0;
    let bytesUploaded = 0;
    const errors = [];

    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      const src = p.kind === 'legacy' ? p.item.image : p.im.data;
      const parsed = parseDataUrl(src);
      if (!parsed) { errors.push('Không parse được data URL (bỏ qua 1 ảnh).'); continue; }
      const ext = MIME_EXT[parsed.mime] || 'bin';
      try {
        const blob = await put(`migrated/img-${i}.${ext}`, parsed.buffer, {
          access: 'public',
          contentType: parsed.mime,
          addRandomSuffix: true,
        });
        if (p.kind === 'legacy') {
          if (!Array.isArray(p.item.images)) p.item.images = [];
          p.item.images.push({ url: blob.url, type: parsed.mime, name: p.item.imageName || 'file' });
          delete p.item.image;
        } else {
          p.im.url = blob.url;
          if (!p.im.type) p.im.type = parsed.mime;
          delete p.im.data;
        }
        migrated++;
        bytesUploaded += parsed.buffer.length;
      } catch (e) {
        errors.push((e && e.message) || String(e));
      }
    }

    if (migrated > 0) {
      await redis.set('ticketVaultData', data);
    }

    return res.status(200).json({
      migrated,
      remaining: totalPending - migrated,
      bytesUploaded,
      errors,
      done: totalPending - migrated === 0,
    });
  } catch (error) {
    console.error('migrateImages error:', error);
    return res.status(500).json({ error: error && (error.message || String(error)), name: error && error.name });
  }
}
