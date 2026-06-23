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

// Danh sách các tên miền quảng cáo cần chặn tải để tiết kiệm RAM
const blockedDomains = [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'facebook.net', 'facebook.com', 'analytics', 'tracking'
];

async function initBrowser() {
    browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--blink-settings=imagesEnabled=false' // Tắt tải ảnh nặng để siêu mượt (bật lại nếu truyện có ảnh)
        ]
    });
    console.log("Trình duyệt Ảo Siêu Tốc đã sẵn sàng!");
}
initBrowser();

// Hàm lọc và xuất HTML
async function extractCleanHTML(page) {
    return await page.evaluate(() => {
        // Dọn dẹp DOM
        const junk = ['script', 'iframe', 'ins', 'noscript', 'header', 'footer', '.ads', '.ad', '#ads', '[class*="adsense"]'];
        junk.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        
        // Chuẩn hóa Link
        const baseUrl = window.location.href;
        document.querySelectorAll('[src]').forEach(el => { if(el.getAttribute('src')) el.src = new URL(el.getAttribute('src'), baseUrl).href; });
        document.querySelectorAll('[href]').forEach(el => { if(el.getAttribute('href')) el.href = new URL(el.getAttribute('href'), baseUrl).href; });
        
        // Bơm thẻ base
        const head = document.querySelector('head') || document.body;
        const base = document.createElement('base'); base.href = baseUrl;
        head.insertBefore(base, head.firstChild);
        
        return { title: document.title, html: document.documentElement.outerHTML };
    });
}

// Quản lý các tab đang mở
const userPages = new Map();

io.on('connection', async (socket) => {
    console.log('Người dùng kết nối:', socket.id);
    
    let page = await browser.newPage();
    userPages.set(socket.id, page);

    // Bật khiên chống quảng cáo và chặn tải thừa
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url().toLowerCase();
        const isAd = blockedDomains.some(domain => url.includes(domain));
        if (isAd || ['font', 'media'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. CHỨC NĂNG TẢI TRANG
    socket.on('goto_url', async (url) => {
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        socket.emit('status', 'Đang tải siêu tốc...');
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 1000)); // Đợi JS của trang render 1 chút
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { socket.emit('status', 'Lỗi: Không thể truy cập trang này.'); }
    });

    // 2. CHỨC NĂNG CLICK
    socket.on('user_click', async (selector) => {
        socket.emit('status', 'Đang thực thi lệnh...');
        try {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(()=>{}),
                page.click(selector).catch(()=>{})
            ]);
            await new Promise(r => setTimeout(r, 1000));
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { socket.emit('status', 'Lỗi click. Hãy thử lại.'); }
    });

    // 3. (MỚI) CHỨC NĂNG TIÊM MÃ JS TỪ XA
    socket.on('inject_js', async (jsCode) => {
        socket.emit('status', 'Đang tiêm mã JS vào Server...');
        try {
            // Chạy mã JS trực tiếp trên Trình duyệt Puppeteer
            await page.evaluate((code) => {
                try {
                    eval(code); // Thực thi mã
                } catch(err) { console.error("Lỗi JS tiêm vào:", err); }
            }, jsCode);
            
            // Chụp lại giao diện sau khi JS chạy xong và gửi về
            await new Promise(r => setTimeout(r, 500)); 
            socket.emit('render_page', await extractCleanHTML(page));
            socket.emit('status', 'Tiêm mã thành công!');
        } catch (e) { socket.emit('status', 'Lỗi tiêm JS'); }
    });

    // 4. (MỚI) ÉP CHẾ ĐỘ BAN ĐÊM (DARK MODE)
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

    // Dọn dẹp RAM khi thoát
    socket.on('disconnect', () => {
        console.log('Đóng tab của:', socket.id);
        const p = userPages.get(socket.id);
        if (p) p.close().catch(()=>{});
        userPages.delete(socket.id);
    });
});

server.listen(process.env.PORT || 3000, () => console.log('Server đỉnh cao đã chạy'));
