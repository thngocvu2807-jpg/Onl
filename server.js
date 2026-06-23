const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cấp quyền truy cập thư mục public chứa file index.html
app.use(express.static('public')); 

let globalBrowser = null;

async function getBrowser() {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        globalBrowser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
    }
    return globalBrowser;
}

io.on('connection', (socket) => {
    console.log('💻 Giao diện Web vừa kết nối: ' + socket.id);
    let page = null;

    // 1. NGƯỜI DÙNG NHẬP URL MỚI
    socket.on('goto_url', async (url) => {
        try {
            socket.emit('status', 'Khởi động máy chủ ảo...');
            const browser = await getBrowser();
            if (page) await page.close().catch(()=>{});
            page = await browser.newPage();
            
            // Chặn tải ảnh cho nhanh
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            socket.emit('status', 'Đang truy cập trang web...');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Vượt rào tự động nếu có
            await page.evaluate(async () => {
                const btn = Array.from(document.querySelectorAll('a, button')).find(el => el.innerText.toLowerCase().includes('tải nội dung'));
                if (btn) btn.click();
            });

            socket.emit('status', 'Đang kết xuất HTML...');
            await page.waitForTimeout(1500); // Đợi js load
            
            const html = await page.content();
            const title = await page.title();
            const currentUrl = await page.url();

            socket.emit('render_page', { html, title, url: currentUrl });
        } catch (e) {
            socket.emit('status', 'Lỗi tải trang: ' + e.message);
        }
    });

    // 2. NGƯỜI DÙNG CLICK TRONG IFRAME
    socket.on('user_click', async (selector) => {
        if (!page) return socket.emit('status', 'Lỗi: Chưa tải trang web nào!');
        try {
            socket.emit('status', 'Mô phỏng thao tác Click...');
            await page.click(selector);
            
            socket.emit('status', 'Đang chờ nội dung mới...');
            await page.waitForTimeout(2000); // Chờ 2s để web gốc chuyển trang

            // Cào lại HTML mới
            const html = await page.content();
            const title = await page.title();
            const currentUrl = await page.url();

            socket.emit('render_page', { html, title, url: currentUrl });
        } catch (e) {
            socket.emit('status', 'Click thất bại: ' + e.message);
        }
    });

    socket.on('disconnect', async () => {
        console.log('❌ Ngắt kết nối: ' + socket.id);
        if (page) await page.close().catch(()=>{});
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Trình duyệt Đám mây khởi chạy tại cổng ${PORT}`));
