const { connect } = require("puppeteer-real-browser");
const fs = require('fs');

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 辅助函数：注入 CSS 屏蔽页面广告
async function hideAds(page) {
    console.log("正在注入广告屏蔽样式...");
    await page.evaluate(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            iframe, ins, .adsbygoogle, 
            [id*="google_ads"], [class*="advertisement"], 
            [class*="sidebar-ad"], #google_image_div,
            div[style*="position: fixed"][style*="bottom: 0"] {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
                height: 0px !important;
            }
        `;
        document.head.appendChild(style);
    });
}

async function run() {
    console.log("正在通过 puppeteer-real-browser 启动浏览器...");
    const { browser, page } = await connect({
        args: [
            "--proxy-server=socks5://127.0.0.1:10808",
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ],
        turnstile: true,
        headless: false,
        connectOption: { defaultViewport: { width: 1920, height: 1080 } }
    });

    try {
        // 设置默认导航超时为 60 秒
        await page.setDefaultNavigationTimeout(60000);
        await page.setViewport({ width: 1920, height: 1080 });

        // 1. 登录流程
        console.log("正在打开登录页面...");
        // 改为 domcontentloaded，避免因个别背景广告卡住而超时
        await page.goto("https://client.falixnodes.net/auth/login", { waitUntil: "domcontentloaded", timeout: 60000 });
        await delay(8000); 

        // 登录前隐藏可能遮挡输入框的广告
        await hideAds(page);

        console.log("正在输入登录凭证...");
        await page.waitForSelector('input[type="email"]', { timeout: 15000 });
        await page.type('input[type="email"]', process.env.FALIX_EMAIL);

        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', process.env.FALIX_PASSWORD);

        await delay(2000);
        console.log("正在点击登录按钮...");
        
        const loginBtn = await page.$('button[type="submit"]') || await page.$('button');
        if (loginBtn) {
            await page.evaluate(el => el.click(), loginBtn);
        } else {
            throw new Error("未找到登录按钮");
        }

        console.log("等待登录跳转...");
        await delay(12000);
        await page.screenshot({ path: "screenshots/1_login_result.png" });
        console.log("已保存登录结果截图：screenshots/1_login_result.png");

        // 2. 控制台流程
        const consoleUrl = "https://client.falixnodes.net/server/2845100/console";
        console.log(`正在跳转至控制台页面: ${consoleUrl}`);
        // 同样改为 domcontentloaded，并提高超时至 60 秒
        await page.goto(consoleUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await delay(8000);
        
        // 净化控制台界面的广告，方便截图看清状态
        await hideAds(page);
        await page.screenshot({ path: "screenshots/2_console_loaded.png" });

        // 循环检测与开机（最多尝试 3 次）
        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`\n--- 开始执行第 ${attempt}/3 次状态检测与开机尝试 ---`);
            
            // 重新刷新页面确保状态最新并过滤广告
            if (attempt > 1) {
                await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
                await delay(5000);
                await hideAds(page);
            }

            const pageContent = await page.content();
            // 兼容检查是否处于 Offline / 离线状态
            const isOffline = pageContent.toLowerCase().includes("offline") || pageContent.includes("离线");

            if (!isOffline) {
                console.log("服务器当前不处于 Offline 状态。流程结束。");
                await page.screenshot({ path: "screenshots/3_server_running_status.png" });
                break;
            }

            console.log("检测到服务器状态为 Offline，准备尝试开机...");

            // 寻找启动按钮
            const startButton = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.find(b => b.textContent.includes('启动') || b.textContent.includes('Start'));
            });

            if (startButton && startButton.asElement()) {
                console.log("找到启动按钮，正在使用底层 JS 强制触发点击...");
                await page.evaluate(el => el.click(), startButton);
                console.log("已触发点击。");
                await delay(6000);
                await page.screenshot({ path: `screenshots/4_after_start_click_attempt_${attempt}.png` });
            } else {
                console.log("未能定位到启动按钮。");
                break;
            }

            // 检测是否存在广告弹窗
            const hasAdPopup = await page.evaluate(() => {
                return document.body.innerText.includes("观看广告") || document.body.innerText.toLowerCase().includes("watch ad");
            });

            if (hasAdPopup) {
                console.log("检测到要求观看广告的弹窗，寻找播放按钮...");
                const adButton = await page.evaluateHandle(() => {
                    const elements = Array.from(document.querySelectorAll('button, a'));
                    return elements.find(el => el.textContent.includes('观看广告') || el.textContent.toLowerCase().includes('watch ad'));
                });

                if (adButton && adButton.asElement()) {
                    await page.evaluate(el => el.click(), adButton);
                    console.log("已强制点击观看广告。等待 25 秒播放完毕...");
                    await delay(25000);
                } else {
                    console.log("未定位到广告按钮。");
                }
            } else {
                console.log("未检测到广告弹窗。等待 10 秒确认容器是否成功启动...");
                await delay(10000);
            }
        }

    } catch (err) {
        console.error("执行过程中发生异常:", err);
        await page.screenshot({ path: "screenshots/error_occurred.png" });
    } finally {
        await browser.close();
        console.log("浏览器已关闭。");
    }
}

if (!fs.existsSync('screenshots')) {
    fs.mkdirSync('screenshots');
}

run();
