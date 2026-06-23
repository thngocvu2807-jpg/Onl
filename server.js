const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer-core');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let browser;

// Danh sách chặn quảng cáo nhẹ nhàng (chỉ chặn các domain ad thực sự, không chặn bừa bãi)
const adDomains = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'facebook.net'];

async function initBrowser() {
    console.log("Đang khởi tạo trình duyệt mô phỏng người thật...");
    browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            // KHÔNG tắt tải ảnh nữa để Cloudflare Turnstile không nghi ngờ
        ]
    });
    console.log("Trình duyệt ảo đã sẵn sàng!");
}
initBrowser();

// Hàm trích xuất HTML sạch nhưng giữ nguyên các cấu trúc quan trọng
async function extractCleanHTML(page) {
    return await page.evaluate(() => {
        // Chỉ xóa quảng cáo thực sự, KHÔNG xóa lung tung các thẻ khác
        const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads', '[class*="adsense"]'];
        junk.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        
        // Chuyển link tương đối thành tuyệt đối
        const baseUrl = window.location.href;
        document.querySelectorAll('[src]').forEach(el => { if(el.getAttribute('src')) el.src = new URL(el.getAttribute('src'), baseUrl).href; });
        document.querySelectorAll('[href]').forEach(el => { if(el.getAttribute('href')) el.href = new URL(el.getAttribute('href'), baseUrl).href; });
        
        // Bơm thẻ base để CSS hoạt động chính xác
        const head = document.querySelector('head') || document.body;
        const base = document.createElement('base'); base.href = baseUrl;
        head.insertBefore(base, head.firstChild);
        
        return { title: document.title, html: document.documentElement.outerHTML };
    });
}

const userPages = new Map();

io.on('connection', async (socket) => {
    console.log('Thiết bị kết nối:', socket.id);
    
    let page = await browser.newPage();
    userPages.set(socket.id, page);

    // Kỹ thuật ẩn danh: Giả lập biến môi trường giống hệt Chrome của người dùng thật
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.navigator.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
    });

    // Chặn quảng cáo ở tầng mạng
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url().toLowerCase();
        const isAd = adDomains.some(domain => url.includes(domain));
        if (isAd || req.resourceType() === 'media') {
            req.abort();
        } else {
            req.continue();
        }
    });

    // Sử dụng User-Agent chuẩn của máy tính để không bị phát hiện là bot mobile
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    // 1. CHỨC NĂNG DI CHUYỂN ĐẾN URL
    socket.on('goto_url', async (url) => {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        socket.emit('status', 'Đang tải trang...');
        try {
            // Đợi đến khi mạng ổn định (networkidle2)
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { 
            socket.emit('status', 'Lỗi tải trang. Thử lại sau.'); 
        }
    });

    // 2. CHỨC NĂNG CLICK (Đã tối ưu hóa cho AJAX - SANGTACVIET)
    socket.on('user_click', async (selector) => {
        socket.emit('status', 'Đang thực thi...');
        try {
            // Kiểm tra xem click này có kích hoạt chuyển hướng trang hay không
            let navigationTriggered = false;
            
            const navPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 })
                .then(() => { navigationTriggered = true; })
                .catch(() => {}); // Nếu quá 8s không chuyển trang -> Xác định là click AJAX

            // Thực hiện click
            await page.click(selector).catch(() => {});

            // Đợi một chút xem có chuyển trang không
            await Promise.race([
                navPromise,
                new Promise(r => setTimeout(r, 2000)) // Đợi tối đa 2s cho các nút AJAX
            ]);

            if (!navigationTriggered) {
                // Nếu là nút bấm AJAX (như nút tải nội dung), đợi thêm 1.5 giây nữa để dữ liệu tải xong hoàn toàn
                await new Promise(r => setTimeout(r, 1500));
            }

            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { 
            socket.emit('status', 'Lỗi thực thi click.'); 
        }
    });

    // 3. TIÊM MÃ JAVASCRIPT TÙY CHỈNH
    socket.on('inject_js', async (jsCode) => {
        socket.emit('status', 'Đang tiêm mã JS...');
        try {
            await page.evaluate((code) => {
                try { eval(code); } catch(err) { console.error(err); }
            }, jsCode);
            await new Promise(r => setTimeout(r, 1000));
            socket.emit('render_page', await extractCleanHTML(page));
            socket.emit('status', 'Tiêm mã thành công!');
        } catch (e) { socket.emit('status', 'Lỗi tiêm JS'); }
    });

    // 4. ÉP BUỘC CHẾ ĐỘ BAN ĐÊM
    socket.on('force_dark_mode', async () => {
        socket.emit('status', 'Đang chuyển Dark Mode...');
        try {
            await page.evaluate(() => {
                const style = document.createElement('style');
                style.innerHTML = `
                    * { background-color: #121212 !important; color: #e0e0e0 !important; border-color: #333 !important; }
                    a { color: #4db8ff !important; }
                `;
                document.head.appendChild(style);
            });
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) {}
    });

    socket.on('disconnect', () => {
        const p = userPages.get(socket.id);
        if (p) p.close().catch(()=>{});
        userPages.delete(socket.id);
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server OK'));
