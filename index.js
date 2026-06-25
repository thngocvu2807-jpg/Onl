const express = require('express');
const puppeteer = require('puppeteer');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const SHARE_CODE = process.env.SHARE_CODE || 'BOT-VIP-9999'; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''; 
const START_URL = process.env.START_URL || ''; 

// =========================================================================
// TRẠM THÔNG TIN THEO DÕI BOT (LƯU TRỮ STATE CHO DASHBOARD)
// =========================================================================
let botStatus = {
    state: 'Đang khởi động...',
    currentUrl: START_URL,
    currentChapter: 'Chưa có',
    totalTranslated: 0,
    totalErrors: 0,
    logs: []
};

// Hàm thêm log để hiển thị ra Dashboard
function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('vi-VN');
    botStatus.logs.unshift({ time, msg, type });
    if (botStatus.logs.length > 50) botStatus.logs.pop(); // Giữ tối đa 50 log gần nhất
    console.log(`[${time}] ${msg}`);
}

// =========================================================================
// API & GIAO DIỆN WEB DASHBOARD (XEM TRỰC TIẾP TRÊN LINK RENDER)
// =========================================================================
app.get('/api/status', (req, res) => {
    res.json(botStatus);
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🤖 Trạm Giám Sát Nông Trại AI</title>
        <style>
            body { background: #0f172a; color: #cbd5e1; font-family: monospace; margin: 0; padding: 20px; }
            .container { max-width: 800px; margin: auto; background: #1e293b; padding: 20px; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #334155; }
            h1 { color: #38bdf8; text-align: center; border-bottom: 2px dashed #334155; padding-bottom: 10px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
            .card { background: #0f172a; padding: 15px; border-radius: 8px; border: 1px solid #334155; }
            .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; }
            .value { color: #fff; font-size: 16px; font-weight: bold; margin-top: 5px; word-break: break-all; }
            .val-green { color: #10b981; } .val-red { color: #ef4444; } .val-yellow { color: #f59e0b; }
            #log-box { background: #000; padding: 15px; border-radius: 8px; height: 350px; overflow-y: auto; font-size: 13px; line-height: 1.5; border: 1px solid #334155; }
            .log-time { color: #64748b; margin-right: 10px; }
            .log-info { color: #38bdf8; } .log-success { color: #10b981; } .log-error { color: #ef4444; } .log-warn { color: #f59e0b; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 TRẠM GIÁM SÁT P2P FARM BOT</h1>
            <div class="grid">
                <div class="card"><div class="label">Mã Mời (Share Code) của Bot:</div><div class="value val-yellow">${SHARE_CODE}</div></div>
                <div class="card"><div class="label">Trạng Thái Hoạt Động:</div><div class="value" id="ui-state">Đang tải...</div></div>
                <div class="card"><div class="label">Số chương đã dịch (Thành công):</div><div class="value val-green" id="ui-success">0</div></div>
                <div class="card"><div class="label">Số lần gặp lỗi / sụp đổ:</div><div class="value val-red" id="ui-errors">0</div></div>
                <div class="card" style="grid-column: span 2;"><div class="label">Đang làm việc tại URL:</div><div class="value" id="ui-url">Đang tải...</div></div>
                <div class="card" style="grid-column: span 2;"><div class="label">Tiêu đề chương hiện tại:</div><div class="value val-green" id="ui-chapter">Đang tải...</div></div>
            </div>
            <div class="label" style="margin-bottom: 5px;">NHẬT KÝ HỆ THỐNG TRỰC TIẾP (LIVE LOGS):</div>
            <div id="log-box"></div>
        </div>

        <script>
            async function fetchStatus() {
                try {
                    const res = await fetch('/api/status');
                    const data = await res.json();
                    document.getElementById('ui-state').innerText = data.state;
                    document.getElementById('ui-url').innerText = data.currentUrl || 'Đã dừng';
                    document.getElementById('ui-chapter').innerText = data.currentChapter;
                    document.getElementById('ui-success').innerText = data.totalTranslated;
                    document.getElementById('ui-errors').innerText = data.totalErrors;
                    
                    const logBox = document.getElementById('log-box');
                    logBox.innerHTML = data.logs.map(l => 
                        \`<div><span class="log-time">[\${l.time}]</span><span class="log-\${l.type}">\${l.msg}</span></div>\`
                    ).join('');
                } catch(e) {}
            }
            setInterval(fetchStatus, 2000); // Tự động làm mới mỗi 2 giây
            fetchStatus();
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => {
    addLog(`Server API khởi chạy thành công tại port ${PORT}`, 'success');
    startAntiSleep();
    if (START_URL && GEMINI_API_KEY) {
        startFarmBot();
    } else {
        botStatus.state = 'LỖI CẤU HÌNH';
        addLog("Thiếu START_URL hoặc GEMINI_API_KEY trong biến môi trường!", 'error');
    }
});

// Giữ server sống
function startAntiSleep() {
    const MY_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}.onrender.com`;
    setInterval(() => {
        if (process.env.RENDER_EXTERNAL_HOSTNAME) {
            https.get(MY_URL).on('error', () => {});
        }
    }, 10 * 60 * 1000);
}

// =========================================================================
// HỆ THỐNG BOT CÀY CUỐC 24/24
// =========================================================================
async function startFarmBot() {
    botStatus.state = 'Đang khởi chạy Chrome ảo...';
    addLog(`Chuẩn bị cào dữ liệu từ: ${START_URL}`, 'info');
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // Cấp quyền cho Puppeteer gọi hàm Node.js để cập nhật giao diện Dashboard
    await page.exposeFunction('reportStatusToNode', (type, message) => {
        addLog(message, type);
    });

    // Truyền biến môi trường vào Trình duyệt ảo
    await page.evaluateOnNewDocument(`
        window.BOT_SHARE_CODE = "${SHARE_CODE}";
        window.GEMINI_API_KEY = "${GEMINI_API_KEY}";
    `);

    // Tiêm siêu thuật toán Mã hóa và Phát sóng Nostr y hệt App Android
    await page.evaluateOnNewDocument(`
        window.BOT_CRYPTO = {
            bufferToBase64(buffer) {
                let binary = '';
                const bytes = new Uint8Array(buffer);
                for (let i = 0; i < bytes.byteLength; i += 0x8000) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                }
                return btoa(binary);
            },
            async hashSHA256(text) {
                const bytes = new TextEncoder().encode(text.trim());
                const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
                return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
            },
            async deriveSecretKey(secretString, textHash) {
                const encoder = new TextEncoder();
                const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(secretString), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
                const signature = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(textHash));
                return await crypto.subtle.importKey('raw', signature.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
            },
            async encryptAndCompress(plainText, secretString, textHash) {
                try {
                    const bytes = new TextEncoder().encode(plainText);
                    const cs = new CompressionStream('gzip');
                    const writer = cs.writable.getWriter();
                    writer.write(bytes); writer.close();
                    const res = new Response(cs.readable);
                    const compressedBytes = new Uint8Array(await res.arrayBuffer());

                    const secretKey = await this.deriveSecretKey(secretString, textHash);
                    const iv = crypto.getRandomValues(new Uint8Array(12));
                    const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, secretKey, compressedBytes);
                    
                    const encryptedBytes = new Uint8Array(encryptedBuffer);
                    const combined = new Uint8Array(iv.length + encryptedBytes.length);
                    combined.set(iv); combined.set(encryptedBytes, iv.length);
                    return this.bufferToBase64(combined);
                } catch (err) { return null; }
            }
        };

        window.publishToNostr = async (tagD, contentData) => {
            return new Promise(async (resolve) => {
                try {
                    if (!window.NostrTools) {
                        await window.reportStatusToNode('warn', 'Đang tải thư viện Nostr...');
                        await new Promise(r => {
                            const s = document.createElement('script');
                            s.src = "https://unpkg.com/nostr-tools@1.17.0/lib/nostr.bundle.js";
                            s.onload = r; document.head.appendChild(s);
                        });
                    }
                    
                    const tools = window.NostrTools;
                    const privateKeyHex = await window.BOT_CRYPTO.hashSHA256(window.BOT_SHARE_CODE);
                    
                    let pubKeyHex;
                    try { pubKeyHex = tools.getPublicKey(privateKeyHex); } 
                    catch(e) { 
                        const hexToBytes = (h) => new Uint8Array(h.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                        pubKeyHex = tools.getPublicKey(hexToBytes(privateKeyHex)); 
                    }

                    const encryptedPayload = await window.BOT_CRYPTO.encryptAndCompress(JSON.stringify(contentData), window.BOT_SHARE_CODE, tagD);
                    if (!encryptedPayload) return resolve(false);

                    let event = {
                        kind: 30002, pubkey: pubKeyHex, created_at: Math.floor(Date.now() / 1000),
                        tags: [["d", tagD], ["t", "vip_hub_p2p"]], content: encryptedPayload
                    };

                    if (typeof tools.finalizeEvent === 'function') {
                        const hexToBytes = (h) => new Uint8Array(h.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                        event = tools.finalizeEvent(event, hexToBytes(privateKeyHex));
                    } else {
                        event.id = tools.getEventHash(event);
                        event.sig = tools.getSignature(event, privateKeyHex);
                    }

                    const ws = new WebSocket('wss://relay.damus.io');
                    ws.onopen = () => { ws.send(JSON.stringify(["EVENT", event])); setTimeout(() => { ws.close(); resolve(true); }, 2500); };
                    ws.onerror = () => resolve(false);
                } catch (e) { resolve(false); }
            });
        };
        
        // [TUÂN THỦ YÊU CẦU: KHÓA CỨNG GEMINI 3.1 FLASH LITE]
        window.callGeminiAPI = async (prompt) => {
            const url = \`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=\${window.GEMINI_API_KEY}\`;
            try {
                const res = await fetch(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                return data.candidates[0].content.parts[0].text;
            } catch(e) { 
                await window.reportStatusToNode('error', 'Lỗi gọi API 3.1 Flash Lite: ' + e.message);
                return null; 
            }
        };
    `);

    let currentUrl = START_URL;

    // VÒNG LẶP CÀY CUỐC VĨNH CỬU
    while (currentUrl) {
        botStatus.currentUrl = currentUrl;
        botStatus.state = 'Đang tải trang web...';
        addLog(`Đang truy cập: ${currentUrl}`, 'info');
        
        try {
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Chạy kịch bản cào và dịch
            const result = await page.evaluate(async () => {
                await window.reportStatusToNode('info', 'Trang đã tải, đang tìm kiếm nội dung...');
                
                // 1. Trích xuất Text
                const contentContainer = document.querySelector('article, main, .read-content, .chapter-content, #chapterContent, .text-wrap') || document.body;
                const rawText = contentContainer.innerText.substring(0, 5000); 
                
                let title = document.title;
                const titleEl = document.querySelector('h1, .chapter-title, .title');
                if (titleEl) title = titleEl.innerText;

                if (!rawText || rawText.trim().length < 50) return { error: "Không tìm thấy nội dung truyện (Text quá ngắn)." };

                // 2. Dịch bằng Gemini 3.1 Flash Lite
                await window.reportStatusToNode('warn', `Bắt đầu gửi ${rawText.length} ký tự cho Gemini 3.1 Flash Lite...`);
                const prompt = `Bạn là một dịch giả xuất sắc. Dịch toàn bộ văn bản sau sang Tiếng Việt chuẩn xác, mượt mà. Giữ nguyên định dạng đoạn văn.\n\n[NỘI DUNG]:\n${rawText}`;
                const translatedText = await window.callGeminiAPI(prompt);
                
                if (!translatedText) return { error: "Lỗi phản hồi từ Gemini 3.1 Flash Lite." };
                await window.reportStatusToNode('success', `Dịch thành công! Kết quả dài ${translatedText.length} ký tự.`);

                // 3. Xây dựng Hash chuẩn hệ sinh thái của App Android
                const getUrlHash = (url) => {
                    let u = url.split('?')[0].split('#')[0]; if (u.endsWith('/')) u = u.slice(0, -1);
                    const encoded = encodeURIComponent(u).replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1));
                    return btoa(encoded).replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_').substring(0, 100);
                };
                
                const getSmartNovelId = (urlStr) => {
                    try {
                        let url = new URL(urlStr);
                        let domain = url.hostname.replace(/^(www|m|h5|wap)\\./i, '');
                        let cleanPath = url.pathname.replace(/\\.[a-zA-Z0-9]+$/g, '');
                        let numMatches = cleanPath.match(/\\b\\d{4,}\\b/g);
                        if (numMatches && numMatches.length > 0) return "DOC_" + domain.replace(/\\./g, '_') + "_" + numMatches[0];
                    } catch(e) {}
                    return "DOC_UNKNOWN";
                };

                const cidHash = getUrlHash(window.location.href);
                const nidSmart = getSmartNovelId(window.location.href);
                const smartHash = nidSmart + '_' + cidHash;

                // 4. Phát sóng lên P2P Nostr
                await window.reportStatusToNode('warn', 'Đang mã hóa và phát sóng lên trạm P2P Nostr...');
                const keyUrlHash = await window.BOT_CRYPTO.hashSHA256(cidHash + "_dom_mapping");
                const keySmartHash = await window.BOT_CRYPTO.hashSHA256(smartHash + "_dom_mapping");
                
                const fakeLocalDict = { "auto_gen_hash": translatedText }; 
                const syncPayload = { mapping: fakeLocalDict, text: translatedText, time: Date.now() };
                
                await window.publishToNostr(keyUrlHash, syncPayload);
                await window.publishToNostr(keySmartHash, syncPayload);

                // Gửi luôn Log Chương (để app Android của bạn hiển thị ở tab Nhật ký Trang)
                const chapPayload = { chapters: [{ id: cidHash, n: "Nông trại Bot Tự Động", c: title, u: window.location.href, t: Date.now(), a: "AI 3.1 Flash Lite", summary: translatedText.substring(0, 250) + "..." }], time: Date.now() };
                const keyChapters = await window.BOT_CRYPTO.hashSHA256("P2P_CHAPTERS_" + window.BOT_SHARE_CODE);
                await window.publishToNostr(keyChapters, chapPayload);

                // 5. TÌM LINK CHƯƠNG TIẾP THEO
                let nextUrl = null;
                const links = document.querySelectorAll('a');
                for (let a of links) {
                    let text = a.innerText.toLowerCase();
                    if (text.includes('next') || text.includes('tiếp') || text.includes('sau') || text.includes('下一章')) {
                        nextUrl = a.href; break;
                    }
                }

                return { success: true, nextUrl: nextUrl, title: title };
            });

            if (result.error) {
                botStatus.totalErrors++;
                botStatus.state = 'Lỗi cào dữ liệu!';
                addLog("❌ Lỗi Bot: " + result.error, 'error');
                break; // Dừng vòng lặp nếu lỗi nặng
            }

            botStatus.totalTranslated++;
            botStatus.currentChapter = result.title;
            botStatus.state = 'Hoàn thành chương, đang chờ chuyển tiếp...';
            addLog(`✅ Đã đẩy thành công lên P2P: ${result.title}`, 'success');
            
            // Chuyển sang chương tiếp theo
            if (result.nextUrl && result.nextUrl.startsWith('http')) {
                currentUrl = result.nextUrl;
                addLog(`💤 Tạm nghỉ 10 giây để chống Block IP...`, 'warn');
                await new Promise(r => setTimeout(r, 10000));
            } else {
                botStatus.state = 'ĐÃ HẾT TRUYỆN';
                addLog("🎉 KHÔNG TÌM THẤY CHƯƠNG TIẾP THEO. Bot tiến vào trạng thái ngủ.", 'info');
                currentUrl = null;
            }

        } catch (error) {
            botStatus.totalErrors++;
            botStatus.state = 'Sụp đổ trình duyệt ảo!';
            addLog(`Sụp đổ trang web, thử tải lại sau 30 giây... (${error.message})`, 'error');
            await new Promise(r => setTimeout(r, 30000));
            // Cố ý không gán currentUrl = null để nó vòng lại cào lại trang bị lỗi mạng
        }
    }
}
