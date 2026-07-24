/**
 * Xoá 1 file ảnh trên Vercel Blob theo URL.
 * Gọi khi xoá vé/hoá đơn/chuyến đi để không bỏ rác (orphan) trong kho.
 * Cần biến môi trường: BLOB_READ_WRITE_TOKEN.
 *
 * import động trong try để lỗi nạp module hiện ra dạng JSON, không crash function.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  const url = body && body.url;
  if (!url) return res.status(400).json({ error: 'No url provided' });

  try {
    const { del } = await import('@vercel/blob');
    await del(url);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('deleteImage error:', error);
    return res.status(500).json({ error: error && (error.message || String(error)), name: error && error.name });
  }
}
