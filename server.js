// Thêm API cấp khóa trực tiếp bằng HTTP GET
app.get('/get-keys', async (req, res) => {
    console.log("Đang lấy khóa cho client test...");
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Vào trang gốc để lấy Cookie sạch
        await page.goto('https://sangtacviet.app', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        const cookies = await page.cookies();
        const localStorageData = await page.evaluate(() => JSON.stringify(localStorage));
        
        await page.close();

        // Trả về gói chìa khóa dưới dạng JSON
        res.setHeader('Access-Control-Allow-Origin', '*'); // Cho phép mọi nơi gọi tới
        res.json({
            cookies: cookies,
            localStorage: JSON.parse(localStorageData),
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
    } catch (e) {
        res.status(500).send("Lỗi bẻ khóa: " + e.message);
    }
});
