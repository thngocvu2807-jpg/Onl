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

async function initBrowser() {
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
    console.log("Trình duyệt ảo đã chạy!");
}
initBrowser();

async function extractCleanHTML(page) {
    return await page.evaluate(() => {
        // Xóa quảng cáo và thẻ script để client không chạy lại JS thừa
        const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads'];
        junk.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        
        // Sửa link nội bộ thành link gốc
        const baseUrl = window.location.href;
        document.querySelectorAll('[src]').forEach(el => { if(el.getAttribute('src')) el.src = new URL(el.getAttribute('src'), baseUrl).href; });
        document.querySelectorAll('[href]').forEach(el => { if(el.getAttribute('href')) el.href = new URL(el.getAttribute('href'), baseUrl).href; });
        
        // Bơm thẻ base để giữ nguyên CSS
        const head = document.querySelector('head') || document.body;
        const base = document.createElement('base'); base.href = baseUrl;
        head.insertBefore(base, head.firstChild);
        
        return { title: document.title, html: document.documentElement.outerHTML };
    });
}

io.on('connection', async (socket) => {
    let page = await browser.newPage();
    
    // GIẢ MẠO TRÌNH DUYỆT THẬT ĐỂ VƯỢT TƯỜNG LỬA (CLOUDFLARE)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 414, height: 896 }); // Giả lập màn hình điện thoại

    socket.on('goto_url', async (url) => {
        socket.emit('status', 'Đang tải trang (Đợi chút nhé)...');
        try {
            // networkidle2: Đợi cho đến khi các kết nối ngầm (tải ảnh, truyện) dừng lại
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { 
            console.log(e);
            socket.emit('status', 'Lỗi tải trang: Web bảo mật quá cao hoặc sai link.'); 
        }
    });

    socket.on('user_click', async (selector) => {
        socket.emit('status', 'Đang chuyển chương...');
        try {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(()=>{}),
                page.click(selector).catch(()=>{})
            ]);
            await new Promise(r => setTimeout(r, 1500)); // Đợi thêm 1.5s cho chắc ăn
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { socket.emit('status', 'Lỗi chuyển trang'); }
    });

    socket.on('disconnect', () => page.close().catch(()=>{}));
});

server.listen(process.env.PORT || 3000, () => console.log('Server OK'));
