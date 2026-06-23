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
        executablePath: '/usr/bin/chromium', // Trỏ tới Chrome đã cài trong Docker
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
        const junk = ['script', 'iframe', 'ins', 'noscript', '.ads', '.ad', '#ads'];
        junk.forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
        const baseUrl = window.location.href;
        document.querySelectorAll('[src]').forEach(el => { if(el.getAttribute('src')) el.src = new URL(el.getAttribute('src'), baseUrl).href; });
        const head = document.querySelector('head') || document.body;
        const base = document.createElement('base'); base.href = baseUrl;
        head.insertBefore(base, head.firstChild);
        return { title: document.title, html: document.documentElement.outerHTML };
    });
}

io.on('connection', async (socket) => {
    let page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => ['font', 'image', 'media'].includes(req.resourceType()) ? req.abort() : req.continue());

    socket.on('goto_url', async (url) => {
        socket.emit('status', 'Đang tải trang...');
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { socket.emit('status', 'Lỗi tải trang'); }
    });

    socket.on('user_click', async (selector) => {
        socket.emit('status', 'Đang chuyển chương...');
        try {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(()=>{}),
                page.click(selector).catch(()=>{})
            ]);
            await new Promise(r => setTimeout(r, 1000));
            socket.emit('render_page', await extractCleanHTML(page));
        } catch (e) { socket.emit('status', 'Lỗi chuyển trang'); }
    });

    socket.on('disconnect', () => page.close().catch(()=>{}));
});

server.listen(process.env.PORT || 3000, () => console.log('Server OK'));
