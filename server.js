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

// Hàm khởi chạy trình duyệt an toàn, tự động khởi động lại nếu sập
async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        console.log("Đang khởi động trình duyệt ảo...");
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process'
            ]
        });
    }
    return browser;
}

// Lọc sạch quảng cáo nhưng giữ cấu trúc nguyên bản
async function extractCleanHTML(page) {
    return await page.evaluate(() => {
        const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads', '[class*="adsense"]'];
        junk.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                try { el.remove(); } catch(e){}
            });
        });
        
        const baseUrl = window.location.href;
        document.querySelectorAll('[src]').forEach(el => { 
            if(el.getAttribute('src')) el.src = new URL(el.getAttribute('src'), baseUrl).href; 
        });
        document.querySelectorAll('[href]').forEach(el => { 
            if(el.getAttribute('href')) el.href = new URL(el.getAttribute('href'), baseUrl).href; 
        });
        
        const head = document.querySelector('head') || document.body;
        const base = document.createElement('base'); 
        base.href = baseUrl;
        head.insertBefore(base, head.firstChild);
        
        return { title: document.title, html: document.documentElement.outerHTML };
    });
}

const userPages = new Map();

io.on('connection', async (socket) => {
    console.log('Thiết bị đã kết nối:', socket.id);
    let page;

    try {
        const b = await getBrowser();
        page = await b.newPage();
        userPages.set(socket.id, page);
        
        // Cấu hình danh tính người dùng thật
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });
        
        // Ẩn biến tự động hóa để tránh bị Cloudflare phát hiện
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.navigator.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
        });
    } catch (err) {
        console.error("Lỗi khởi tạo tab mới:", err);
        socket.emit('status', 'Lỗi khởi động trình duyệt ảo.');
        return;
    }

    // 1. XỬ LÝ TẢI URL
    socket.on('goto_url', async (url) => {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        console.log(`Yêu cầu truy cập: ${url}`);
        socket.emit('status', 'Đang kết nối tới website...');
        
        try {
            // Sử dụng domcontentloaded để tải nhanh nhất có thể, tránh bị treo ngầm
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Chờ cứng 2.5 giây để các đoạn mã Javascript của trang web tải nốt nội dung truyện
            await new Promise(r => setTimeout(r, 2500));
            
            const data = await extractCleanHTML(page);
            socket.emit('render_page', data);
        } catch (e) { 
            console.error("Lỗi tải URL:", e.message);
            socket.emit('status', 'Không thể kết nối tới trang web này. Thử lại sau.'); 
        }
    });

    // 2. XỬ LÝ LỆNH BẤM
    socket.on('user_click', async (selector) => {
        socket.emit('status', 'Đang bấm...');
        try {
            let isNavigated = false;
            
            // Đợi xem cú click này có chuyển hướng trang hay không (chờ tối đa 6 giây)
            const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 6000 })
                .then(() => { isNavigated = true; })
                .catch(() => {});

            await page.click(selector).catch(() => {});

            await Promise.race([
                navPromise,
                new Promise(r => setTimeout(r, 1500))
            ]);

            // Nếu click không làm chuyển hướng trang (như nút tải nội dung AJAX)
            if (!isNavigated) {
                await new Promise(r => setTimeout(r, 1500)); // Đợi thêm 1.5 giây để JS tải chữ ra
            }

            const data = await extractCleanHTML(page);
            socket.emit('render_page', data);
        } catch (e) { 
            socket.emit('status', 'Không thực hiện được thao tác bấm.'); 
        }
    });

    // 3. TIÊM MÃ JAVASCRIPT TÙY CHỈNH
    socket.on('inject_js', async (jsCode) => {
        socket.emit('status', 'Đang chạy mã JS...');
        try {
            await page.evaluate((code) => {
                try { eval(code); } catch(err) { console.error(err); }
            }, jsCode);
            await new Promise(r => setTimeout(r, 1000));
            socket.emit('render_page', await extractCleanHTML(page));
            socket.emit('status', 'Tiêm mã thành công!');
        } catch (e) { socket.emit('status', 'Lỗi thực thi mã JS.'); }
    });

    // 4. CHẾ ĐỘ BAN ĐÊM
    socket.on('force_dark_mode', async () => {
        socket.emit('status', 'Đang kích hoạt Chế độ tối...');
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

    // ĐÓNG TAB GIẢI PHÓNG RAM
    socket.on('disconnect', () => {
        console.log('Thiết bị ngắt kết nối:', socket.id);
        const p = userPages.get(socket.id);
        if (p) p.close().catch(()=>{});
        userPages.delete(socket.id);
    });
});

// Khởi chạy trình duyệt lần đầu
getBrowser().catch(err => console.error("Lỗi khởi động trình duyệt ban đầu:", err));

server.listen(process.env.PORT || 3000, () => console.log('Máy chủ hoạt động ổn định'));
