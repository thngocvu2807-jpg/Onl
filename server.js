const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let browser;
const profileDir = path.join(__dirname, '.chrome_user_data');
if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

async function getBrowser() {
    if (!browser || !browser.isConnected()) {
        console.log("Khởi chạy Chrome ảo Đám mây...");
        browser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: true,
            userDataDir: profileDir,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--single-process', '--memory-pressure-off'
            ]
        });
    }
    return browser;
}

// Lấy HTML sạch gửi về đt
async function extractCleanHTML(page) {
    return await page.evaluate(() => {
        const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads', '[class*="adsense"]'];
        junk.forEach(sel => document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch(e){} }));
        
        const baseUrl = window.location.href;
        document.querySelectorAll('[src]').forEach(el => { if(el.getAttribute('src')) el.src = new URL(el.getAttribute('src'), baseUrl).href; });
        document.querySelectorAll('[href]').forEach(el => { if(el.getAttribute('href')) el.href = new URL(el.getAttribute('href'), baseUrl).href; });
        
        const head = document.querySelector('head') || document.body;
        const base = document.createElement('base'); base.href = baseUrl;
        head.insertBefore(base, head.firstChild);
        
        return { title: document.title, html: document.documentElement.outerHTML };
    });
}

const userTabs = new Map();

io.on('connection', async (socket) => {
    console.log('App Android vừa kết nối:', socket.id);
    let page;

    try {
        const b = await getBrowser();
        page = await b.newPage();
        userTabs.set(socket.id, page);
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 414, height: 896 }); // Kích thước màn hình điện thoại
        await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    } catch (e) {
        socket.emit('status', 'Lỗi khởi tạo Tab trên Server');
        return;
    }

    // 1. TẢI TRANG
    socket.on('goto_url', async (url) => {
        socket.emit('status', 'Đang tải trang qua Đám Mây...');
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 1000)); // Đợi render 1s
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { socket.emit('status', 'Lỗi tải trang'); }
    });

    // 2. CLICK VẬT LÝ TỪ APP GỬI LÊN
    socket.on('user_click', async (selector) => {
        socket.emit('status', 'Đang bấm...');
        try {
            let isNavigated = false;
            const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 })
                .then(() => { isNavigated = true; }).catch(() => {});

            // Bấm bằng hàm click vật lý của Puppeteer (Chống phát hiện Bot)
            await page.click(selector).catch(() => {});

            await Promise.race([ navPromise, new Promise(r => setTimeout(r, 1500)) ]);

            // Nếu click AJAX (Sangtacviet tải chữ), đợi thêm 2s cho chữ hiện ra
            if (!isNavigated) await new Promise(r => setTimeout(r, 2000));

            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { socket.emit('status', 'Lỗi chuyển trang'); }
    });

    socket.on('disconnect', () => {
        console.log('App ngắt kết nối:', socket.id);
        const p = userTabs.get(socket.id);
        if (p) p.close().catch(()=>{});
        userTabs.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Trạm Live Socket chạy ở cổng ${PORT}`));
