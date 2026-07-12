const fs = require('fs');
const { URL } = require('url');

const vlessLink = process.env.VLESS_LINK;
if (!vlessLink) {
    console.error("未找到 VLESS_LINK 环境变量，请检查 Secret 配置。");
    process.exit(1);
}

try {
    const parsed = new URL(vlessLink);
    const uuid = parsed.username;
    const hostname = parsed.hostname;
    const port = parseInt(parsed.port || '443');
    const searchParams = parsed.searchParams;

    const path = searchParams.get('path') || '/';
    const host = searchParams.get('host') || hostname;
    const sni = searchParams.get('sni') || hostname;
    const security = searchParams.get('security') || 'none';
    const type = searchParams.get('type') || 'tcp';

    const xrayConfig = {
        log: { loglevel: "warning" },
        inbounds: [{
            port: 10808,
            listen: "127.0.0.1",
            protocol: "socks",
            settings: { auth: "noauth", udp: true }
        }],
        outbounds: [{
            protocol: "vless",
            settings: {
                vnext: [{
                    address: hostname,
                    port: port,
                    users: [{
                        id: uuid,
                        encryption: "none"
                    }]
                }]
            },
            streamSettings: {
                network: type,
                security: security,
                tlsSettings: security === "tls" ? { serverName: sni } : undefined,
                wsSettings: type === "ws" ? { path: path, headers: { Host: host } } : undefined
            }
        }]
    };

    fs.writeFileSync('xray_config.json', JSON.stringify(xrayConfig, null, 2));
    console.log("Xray 配置文件生成成功。");
} catch (e) {
    console.error("解析 VLESS 链接失败:", e.message);
    process.exit(1);
}
