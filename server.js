// Thêm sự kiện này vào server.js của bạn
socket.on('get_chapter_text', async (url) => {
    console.log(`Đang lấy chữ hộ cho link: ${url}`);
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Chỉ tải khung trang, không đợi tải ảnh/css phức tạp
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Đợi cho đến khi chữ xuất hiện ngầm trên server
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || 
                       document.querySelector('#content') || 
                       document.querySelector('.contentbox');
            return el && el.textContent.trim().length > 100;
        }, { timeout: 8000 }).catch(() => {});

        // Chỉ lấy đúng đoạn mã HTML chứa nội dung truyện (Rất nhẹ)
        const chapterHTML = await page.evaluate(() => {
            const el = document.querySelector('#bookcontent') || 
                       document.querySelector('#content') || 
                       document.querySelector('.contentbox');
            return el ? el.innerHTML : '';
        });

        await page.close();

        // Gửi trả đúng đoạn chữ thô về cho điện thoại
        socket.emit('receive_chapter_text', { html: chapterHTML });
    } catch (e) {
        socket.emit('status', 'Lỗi lấy chữ từ Server.');
    }
});
