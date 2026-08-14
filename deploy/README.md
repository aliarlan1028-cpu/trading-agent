# 对外交付 · Path A：一客户一实例（single-tenant per customer）

每个付费客户 = 一套**物理隔离**的独立部署：独立容器 + 独立 sqlite 数据卷 + 独立
主密钥文件 + 独立 owner 账号 + 独立子域名。客户各自连自己的 OKX 账户、
交易自己的钱，彼此完全看不到对方的数据。**几乎不改应用代码**，靠下面的脚本开通。

## 一次性准备（只做一次）

- [ ] **DNS**：给 `*.yegidawir.xyz` 加一条 A 记录指向服务器 IP。
      （Caddy 会为每个 `<slug>.yegidawir.xyz` 用 HTTP-01 自动签发证书，需能解析到本机。）
- [ ] **镜像**：主实例 `docker compose build` 后本机已有 `trading-agent-trading-agent:latest`；
      新客户实例直接复用该镜像，不必每次重建。
- [ ] **统一 LLM key**：`cp deploy/vendor.env.example deploy/vendor.env`，填入你的 Anthropic/OpenAI key，`chmod 600`。开通时会自动注入每个客户实例（客户登录后仍可在密钥库改成自己的）。不配则该实例 AI 只做数据巡检、不推理。
- [ ] **备份 cron**：把 `backup-tenants.sh` 挂到每日 cron（见脚本头注释）。
- [ ] **异机加密备份**：为每个实例只读挂载独立的 `BACKUP_ENCRYPTION_KEY_FILE`，把
      `BACKUP_OFFSITE_DIR` 指向另一块磁盘/NFS/rclone 挂载目录；系统禁止把明文快照复制到异机目录，
      并默认校验目标必须位于不同文件系统。只有本地开发才可显式设置
      `BACKUP_OFFSITE_REQUIRE_DISTINCT_DEVICE=false`，生产环境禁止用它把同机目录伪装成异机备份。
- [ ] **恢复演练**：`npm run restore-drill` 在临时目录解密并执行 SQLite 完整性/核心表检查，
      不替换生产数据库。部署脚本会安装每周一自动演练的 systemd timer，并记录
      `backups/restore-drill-status.json`。
- [ ] **宕机告警**：可在 `deploy/monitor.env` 填独立 Lark Webhook，也可复用系统设置中的 Telegram/Lark；
      部署脚本会启用每分钟 systemd timer，覆盖实例、前端资产、备份新鲜度和磁盘空间。运行
      `deploy/monitor-tenants.sh --test-alert` 验证真实送达；FAIL_THRESHOLD=2 时自愈延迟约 2 分钟。
- [ ] **脚本落到服务器**：`/opt/trading-agent/deploy/` 下（随主仓库 rsync 即可），
      `chmod +x deploy/*.sh`。
- [ ] **当前机器容量**：`provision-tenant.sh` 会在创建前硬检查实例数、MemAvailable 和磁盘；
      默认至少保留 768MB 可用内存、磁盘低于 80%，容量不够会拒绝，而不是挤垮 Owner 实例。
- [ ] **公开申请入口**：主实例只保存开通申请，不创建客户交易账号。模式为
      `closed / invite / waitlist / auto`；正式公开候补前必须配置 Turnstile、验证邮件、
      HTTPS 服务条款和隐私政策地址。

## 开通一个客户

```bash
cd /opt/trading-agent/deploy
PRODUCTION_SECURITY_PROFILE=bitlaunch_single_server \
PUBLIC_MAX_TENANTS=1 \
./provision-tenant.sh alice alice@example.com
```

BitLaunch 单服务器模式会在 `/opt/tenants/<slug>/secrets/` 生成租户独立宿主机密钥；
`external_hardened` 模式仍强制外部 KMS/WORM/告警。脚本会先执行容量闸 → 建目录 `/opt/tenants/alice/` → 生成初始密码 →
起容器（端口只绑 `127.0.0.1`，不对外）→ 往 Caddyfile 注入
`alice.yegidawir.xyz` 路由并 reload。最后打印 **URL + owner 邮箱 + 初始密码（仅此一次）**。

把 URL 和初始密码安全交给客户，让 TA：
1. 登录后在 **系统设置 → 密钥库** 填自己的交易所 API Key
   （权限**只勾"交易"，绝不勾"提币"**）；
2. 在 Admin/系统设置里自行开启实盘闸门（默认关闭，观察/纸面）。

## 运维

```bash
./list-tenants.sh                     # 看所有实例与状态
./backup-tenants.sh                   # 手动备份（cron 会自动跑）
npm run restore-drill                 # 只读恢复演练，不触碰生产数据库
./deprovision-tenant.sh alice         # 停用（保留数据）
./deprovision-tenant.sh alice --purge # 停用并归档删除数据
```

升级所有实例（改了代码后）：先在 `/opt/trading-agent` 重建镜像，再逐个
`docker compose -p tenant-<slug> -f /opt/tenants/<slug>/docker-compose.yml up -d`。

## 交付前仍需人工确认（非代码项）

- [ ] **合规/法律**：服务条款、风险揭示、代客交易免责、司法管辖界定。
- [ ] **非托管声明**：明确你不持有客户资金；客户 API Key 必须**禁用提币权限**。
- [ ] **密钥托管**：每实例必须使用独立 KMS/Vault 数据密钥，只读挂载到
      `SECRETS_MASTER_KEY_FILE`；密钥不得进入 `.env`、代码仓库或数据备份。BitLaunch
      单服务器模式使用宿主机 `0400` 独立文件；外部加固模式由 KMS/Vault sidecar 挂载。
- [ ] **外部审计**：配置独立账号管理的 `WORM_AUDIT_ENDPOINT`；应用只拥有追加权限，
      不拥有删除或改写权限。
- [ ] **公开入口不建交易用户**：可以开放主实例申请页，但每个获批客户仍必须由
      `provision-tenant.sh` 创建独立实例；严禁启用 `TENANT_ISOLATION_V2` 绕过物理隔离。
- [ ] **监控告警**：容器 healthcheck 已内置；建议再加宕机告警（如 Uptime Kuma）。
- [ ] **资源上限**：脚本默认每客户 512MB / 0.5 CPU / 256 PID，并配置日志轮转；
      只能在压测和升级当前 BitLaunch 套餐后提高 `PUBLIC_MAX_TENANTS`。

## 何时该迁到 Path B（真多租户）

单机上实例数到几十、运维（备份/升级/端口/证书）开始吃力时，再评估把数据层
按 tenant 重构成一套系统。那是数天量级的重构，届时另起工程。


## 主实例部署（deploy.sh）

本 README 之前只写了客户实例；主实例（yegidawir.xyz, /opt/trading-agent）用仓库根的 `deploy/deploy.sh`：

```bash
./deploy/deploy.sh        # rsync(排除 .env/data/deploy/vendor.env/monitor.env) → 远端 build → 90s 健康验证 → 失败自动回滚
./deploy/deploy.sh --dry  # 只看会传什么
```

- 排除清单是历史事故后加固的，勿改；`deploy/vendor.env` 与 `deploy/monitor.env` 只存在于服务器。
- 若 vendor.env 意外丢失：`deploy/sync-vendor-llm.sh` 可从主实例金库解密重新生成（这是唯一的自动恢复手段）。
