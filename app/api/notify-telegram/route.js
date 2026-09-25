export async function POST(request) {
  try {
    const body = await request.json();
    const tableNumber = body?.tableNumber;
    const adultCount = Number(body?.adultCount) || 0;
    const childCount = Number(body?.childCount) || 0;
    const total = body?.total;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      return Response.json(
        { success: false, error: 'ไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID' },
        { status: 500 }
      );
    }

    const text =
      `💰 ปิดโต๊ะแล้ว\n` +
      `โต๊ะ: ${tableNumber}\n` +
      `ผู้ใหญ่ ${adultCount} คน / เด็ก ${childCount} คน\n` +
      `ยอดชำระ: ${total} บาท`;

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      }
    );

    const telegramResult = await telegramResponse.json().catch(() => null);

    if (!telegramResponse.ok || !telegramResult?.ok) {
      return Response.json(
        { success: false, error: telegramResult?.description || 'ส่งข้อความ Telegram ไม่สำเร็จ' },
        { status: 502 }
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json(
      { success: false, error: err?.message || 'เกิดข้อผิดพลาดที่ไม่คาดคิด' },
      { status: 500 }
    );
  }
}
