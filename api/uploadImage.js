/**
 * Cấp token cho CLIENT-UPLOAD lên Vercel Blob.
 * Ảnh đi THẲNG từ trình duyệt → Vercel Blob (không đi xuyên qua function này),
 * nên KHÔNG dính giới hạn 4.5MB body của Vercel Function → giữ nguyên ảnh gốc cỡ bất kỳ.
 *
 * Yêu cầu biến môi trường: BLOB_READ_WRITE_TOKEN (tự có khi tạo Blob store trên Vercel).
 * Tuỳ chọn: UPLOAD_SECRET — nếu đặt, client phải gửi đúng chuỗi này (clientPayload) mới được cấp token.
 *
 * Lưu ý: import động (await import) BÊN TRONG try để nếu module lỗi khi nạp
 * (vd Node quá cũ) thì trả JSON lỗi đọc được, thay vì FUNCTION_INVOCATION_FAILED.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Vercel thường parse sẵn JSON; phòng khi body về dạng chuỗi.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  try {
    const { handleUpload } = await import('@vercel/blob/client');
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Cổng nhẹ (tuỳ chọn): chỉ chặn nếu đã cấu hình UPLOAD_SECRET.
        if (process.env.UPLOAD_SECRET && clientPayload !== process.env.UPLOAD_SECRET) {
          throw new Error('Unauthorized');
        }
        return {
          allowedContentTypes: [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'image/heic', 'image/heif', 'application/pdf',
          ],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Không cần xử lý: client nhận URL trực tiếp từ upload() và tự lưu vào dữ liệu.
        // (Callback này không chạy được ở localhost — đã tính, không ảnh hưởng.)
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    console.error('uploadImage error:', error);
    return res.status(400).json({ error: error && (error.message || String(error)), name: error && error.name });
  }
}
