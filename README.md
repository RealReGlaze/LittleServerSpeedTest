# 连接 · 游戏服务器测速

无框架、无 npm 依赖的响应式测速网页，以及部署到游戏服务器的 Node.js 测速服务。静态页面可以放在 Cloudflare Pages，测速流量发送到你填写的服务器地址。也可直接使用服务器提供的同一页面。

## 本地运行

需要 Node.js 20 或以上，无需 `npm install`：

```sh
npm start
```

打开 `http://localhost:8080`，默认已填本机地址。Windows、Linux 和 macOS 均可运行。可通过 `PORT` 环境变量改端口，`HOST` 改监听地址（默认 `::`，在支持的系统上同时监听 IPv4/IPv6）。

## Cloudflare Pages

1. 将整个仓库上传到 GitHub，在 Cloudflare 中创建 Pages 项目并连接仓库。
2. 框架选择 **None**；构建命令留空；构建输出目录填 **public**；根目录保持仓库根目录。
3. 部署后打开 Pages 地址，在网页中填写测速服务器 HTTPS 地址并开始测试。地址会保存在当前浏览器。
4. 也可以提前修改 `public/config.js` 的 `serverUrl`，为所有访客设置默认地址。`durationSeconds` 为每项速度测试时长，`connections` 为并发数。

Pages 只提供页面，不承担测速流量。没有 Functions、数据库、构建步骤或 Cloudflare 密钥。

## 一键安装到游戏服务器

推荐 Debian / Ubuntu。上传或 `git clone` 整个仓库，然后在仓库根目录运行：

```sh
sudo bash deploy/install.sh 8080
```

脚本在缺少 Docker 时通过系统 apt 安装 Docker，把程序复制到 `/opt/little-server-speed-test`，构建并启动容器，配置开机自动重启。开放服务器防火墙、安全组以及路由器上的 **TCP 8080**，映射到该服务器的 TCP 8080。访问 `http://服务器IP:8080` 即可直接开始测速。公网 IPv6 要另行放行 IPv6 防火墙；Docker 的公网 IPv6 可达性取决于宿主机配置。

### 给 Cloudflare Pages 配置 HTTPS

浏览器不会允许 HTTPS Pages 页面调用公网 HTTP 接口。准备一个域名，把其 DNS A/AAAA 记录指向游戏服务器，运行：

```sh
sudo bash deploy/install.sh 8080 speed.example.com https://your-project.pages.dev
```

安装包会启动 Caddy 并自动申请、续期证书。开放/映射 **TCP 80 和 443**，网页填写 `https://speed.example.com`。后端 8080 只绑定服务器本机，无需开放。80/443 必须未被其他程序占用；已有反向代理时，使用 HTTP 安装方式并自行代理到 8080。限制源地址时填页面的实际 Origin（协议和域名，不含尾斜杠），多个源用逗号分隔。不传第三个参数时允许所有来源。

测速域名在 Cloudflare DNS 中请使用 **DNS only / 灰云**，以测量到游戏服务器的直连路径。开启橙云、Tunnel 或其他 CDN 后，结果会包含代理路径。不要给测速接口开启缓存或 gzip/brotli 压缩；安装包默认关闭测速响应缓存且不压缩。

其他已安装 Docker 的 Linux 系统也可运行该脚本。已有 Docker Compose 的用户可使用：

```sh
docker compose -f deploy/compose.yml up -d --build
```

Compose 默认开放 HTTP 8080，不包含 HTTPS。Windows 服务器可以使用 Node.js 执行 `npm start` 或使用支持 Linux 容器的 Docker Compose；一键自动安装脚本面向 Linux。

### 运维

```sh
docker logs --tail 100 little-speedtest
docker logs --tail 100 little-speedtest-tls
docker restart little-speedtest
```

更新时在新版仓库重新运行同样的安装命令。卸载服务：

```sh
docker rm -f little-speedtest little-speedtest-tls
```

此命令保留安装目录、镜像及证书卷。首次安装下载 Docker/基础镜像/证书需要服务器能访问相应网络。

## 测量范围与数据

- **Ping**：预热一次后采样 10 次 HTTP 请求往返时间，显示中位数；抖动是相邻样本差值绝对值的平均值。它包含 TCP/TLS、浏览器和服务处理开销，不是 ICMP ping，也不等于游戏 UDP 协议的延迟。
- **上下行**：默认分别持续 8 秒、3 条并发连接，显示平均有效载荷 Mbps（1 Mbps = 1,000,000 bit/s）。下载按浏览器实际收到的字节计数；上传按浏览器上传进度计数，浏览器/系统缓冲可能使短时读数偏高。网络、设备、代理和服务器带宽都会影响结果。
- **流量**：测试会真实消耗上下行流量，无默认流量上限；高速连接可能消耗数百 MB 甚至数 GB。停止按钮会取消在途测试。移动网络按需使用。
- **IPv4/IPv6**：浏览器分别向 `api.ipify.org` 和 `api6.ipify.org` 查询公网出口地址。查询请求会暴露公网 IP 给 ipify；不记录结果。IPv6 不可达、被屏蔽或查询失败时显示“不可用或查询失败”，这不一定代表设备没有 IPv6。两种地址都可能受代理影响。
- **时间**：系统时间来自访问者设备；时区由浏览器提供。服务器时间来自连接时的 `/api/info` 快照，并按服务器时区显示；它仅用于人工核对，不是精确的时钟同步校准。
- **安全与容量**：服务无认证，单次下载最多 128 MiB、单次上传最多 32 MiB，不将上传内容写入磁盘。公开服务可能产生大量带宽费用。`ALLOWED_ORIGINS` 仅限制浏览器跨域访问，不能代替认证或防火墙；为私人用途可在服务器/反向代理限制来源 IP。

## 验证

```sh
npm run check
npm test
```

测试覆盖服务元数据、下载字节数、上传字节数、跨域预检、来源限制和私有文件隔离。
