const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => { 
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next(); 
});

let globalBrowser = null;
// Lưu trữ tiến độ của từng phiên làm việc
const activeJobs = new Map();

async function getBrowser() {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        globalBrowser = await puppeteer.launch({
            executablePath: '/usr/bin/chromium',
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--disable-gpu', '--mute-audio', '--disable-blink-features=AutomationControlled']
        });
    }
    return globalBrowser;
}

// 1. ENDPOINT: Nhận lệnh và tạo Mã phiên (Không bắt Android đợi)
app.post('/start-action', async (req, res) => {
    const { url, cookie, userAgent, selector } = req.body;
    if (!url) return res.status(400).json({ error: "Thiếu URL" });

    // Tạo mã phiên ngẫu nhiên
    const jobId = Math.random().toString(36).substring(2, 10);
    
    // Ghi nhận trạng thái khởi tạo
    activeJobs.set(jobId, { status: "🟢 Đã kết nối tới Server. Đang chuẩn bị Chrome...", html: null, error: null });
    
    console.log(`\n[${jobId}] 🚀 ANDROID ĐÃ KẾT NỐI - Yêu cầu URL: ${url}`);
    
    // Trả mã phiên về cho Android ngay lập tức
    res.status(200).json({ jobId });

    // --- BẮT ĐẦU CHẠY NGẦM BÊN TRONG MÁY CHỦ ---
    runPuppeteerTask(jobId, url, cookie, userAgent, selector);
});

// 2. ENDPOINT: Trả lời trạng thái LIVE khi Android hỏi thăm
app.get('/status/:jobId', (req, res) => {
    const job = activeJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Không tìm thấy tiến trình!" });
    
    res.status(200).json(job);

    // Nếu đã hoàn thành hoặc lỗi, xóa luôn job để giải phóng RAM máy chủ
    if (job.html || job.error) {
        setTimeout(() => activeJobs.delete(req.params.jobId), 5000);
    }
});

// --- HÀM XỬ LÝ CHÍNH CỦA MÁY CHỦ ---
async function runPuppeteerTask(jobId, url, cookie, userAgent, selector) {
    let page = null;
    const update = (msg) => {
        console.log(`[${jobId}] 📡 ${msg}`);
        const currentJob = activeJobs.get(jobId);
        if (currentJob) currentJob.status = msg;
    };

    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        if (userAgent) await page.setUserAgent(userAgent);
        if (cookie) {
            const cookieArray = cookie.split(';').map(c => {
                const [name, ...rest] = c.split('=');
                return { name: name.trim(), value: rest.join('=').trim(), domain: new URL(url).hostname };
            });
            await page.setCookie(...cookieArray);
        }

        update(`Đang truy cập trang web gốc...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

        if (selector) {
            update(`Đang thực hiện mô phỏng Click...`);
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                await page.click(selector);
                update(`Đã Click. Đang chờ Web phản hồi...`);
                await page.waitForTimeout(1500); 
            } catch (e) {
                update(`⚠️ Cảnh báo: Không thể click vào phần tử yêu cầu!`);
            }
        }

        update(`Kiểm tra rào cản và ấn nút "Tải nội dung"...`);
        await page.evaluate(async () => {
            const delay = ms => new Promise(res => setTimeout(res, ms));
            await delay(500); 
            const btn = Array.from(document.querySelectorAll('a, button, div, span, p')).find(el => {
                const txt = el.innerText.toLowerCase();
                return txt.includes('tải nội dung') || txt.includes('click để') || txt.includes('bấm vào đây');
            });
            if (btn) btn.click();
        });

        update(`Đang chờ Text truyện tải xong...`);
        await page.waitForFunction(() => {
            const el = document.querySelector('#bookcontent') || document.querySelector('#content') || document.querySelector('.contentbox');
            return el && el.textContent.trim().length > 150 && !el.textContent.includes('đang tải');
        }, { timeout: 10000 }).catch(() => update("⚠️ Hết giờ chờ, tiến hành lấy phần chữ hiện tại..."));

        update(`Đang X-Quang copy toàn bộ HTML...`);
        const fullHtml = await page.evaluate(() => {
            document.querySelectorAll('script, iframe').forEach(s => s.remove());
            return document.documentElement.outerHTML;
        });

        update(`✅ THÀNH CÔNG! Đã đóng gói dữ liệu chờ App tải về.`);
        const finalJob = activeJobs.get(jobId);
        if (finalJob) finalJob.html = fullHtml; // Gắn HTML vào để Android lấy

    } catch (error) {
        update(`❌ LỖI MÁY CHỦ: ${error.message}`);
        const errJob = activeJobs.get(jobId);
        if (errJob) errJob.error = error.message;
    } finally {
        if (page) await page.close().catch(()=>{});
        console.log(`[${jobId}] 🛑 Đóng Tab dọn dẹp RAM.`);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Máy chủ Proxy LIVE hoạt động tại cổng ${PORT}`));
