# Trading Agent iOS 自用安装指南

这个 iOS 版本是一个真正的 Xcode 原生工程，使用 Capacitor 把当前 React 驾驶舱打包进 iPhone App。App 只负责移动端操作、审批和查看；交易所 API Secret、LLM Key、Telegram Token 仍然只保存在后端。

## 1. 安装 Xcode

本机已安装完整 Xcode（26.6）并完成初始化（开发者目录已切换、许可已接受、iOS 平台组件已下载）。如在新机器上重装，步骤是：从 Mac App Store 安装 Xcode，然后执行：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS
xcodebuild -version
```

## 2. 启动后端

iPhone 不能访问 Mac 上的 `127.0.0.1`。局域网真机调试时，需要让后端监听局域网地址：

```bash
HOST=0.0.0.0 PORT=8788 AUTH_REQUIRED=true npm run server
```

然后查 Mac 的局域网 IP：

```bash
ipconfig getifaddr en0
```

如果返回 `192.168.1.8`，App 里填写：

```text
http://192.168.1.8:8788
```

正式长期使用建议把后端部署到 HTTPS 域名，例如：

```text
https://agent.yourdomain.com
```

## 3. 同步 iOS 工程

每次改前端后执行：

```bash
npm run ios:sync
```

这会先运行 `vite build`，再把 `dist/` 复制进 Xcode 工程。

## 4. 打开 Xcode

```bash
npm run ios:open
```

在 Xcode 中：

1. 选择 `App` target。
2. 修改 Signing & Capabilities 里的 Team 为你的 Apple ID 团队。
3. Bundle Identifier 可继续用 `com.ely.tradingagent`，如冲突可改成自己的反域名。
4. 用数据线连接 iPhone，选择你的设备。
5. 点击 Run 安装到手机。

## 5. App 首次打开

首次打开会出现连接页：

1. 填写后端地址。
2. 登录管理员密码。
3. 进入移动端交易驾驶舱。

App 不保存交易所 Secret。即使手机丢失，也应该只需要在后端吊销登录 Token，不需要更换交易所 API Key。

## 6. 实盘前要求

不要因为 App 能装到手机就直接实盘。实盘前至少完成：

- `SECRETS_MASTER_KEY`
- `ADMIN_PASSWORD`
- 交易所 API 无提现权限
- IP 白名单
- 私有账户快照同步成功
- 审计链处理为实盘 epoch
- 小额度灰度策略
- Face ID / PIN 二次确认能力（**尚未实现**：当前无生物识别插件，实盘确认走服务端审批阈值与二次确认弹窗）

