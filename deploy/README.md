# 对外交付 · Path A：一客户一实例（single-tenant per customer）

每个付费客户 = 一套**物理隔离**的独立部署：独立容器 + 独立 sqlite 数据卷 + 独立
`SECRETS_MASTER_KEY` + 独立 owner 账号 + 独立子域名。客户各自连自己的交易所、
交易自己的钱，彼此完全看不到对方的数据。**几乎不改应用代码**，靠下面的脚本开通。

## 一次性准备（只做一次）

- [ ] **DNS**：给 `*.yegidawir.xyz` 加一条 A 记录指向服务器 IP。
      （Caddy 会为每个 `<slug>.yegidawir.xyz` 用 HTTP-01 自动签发证书，需能解析到本机。）
- [ ] **镜像**：主实例 `docker compose build` 后本机已有 `trading-agent-trading-agent:latest`；
      新客户实例直接复用该镜像，不必每次重建。
- [ ] **统一 LLM key**：`cp deploy/vendor.env.example deploy/vendor.env`，填入你的 Anthropic/OpenAI key，`chmod 600`。开通时会自动注入每个客户实例（客户登录后仍可在密钥库改成自己的）。不配则该实例 AI 只做数据巡检、不推理。
- [ ] **备份 cron**：把 `backup-tenants.sh` 挂到每日 cron（见脚本头注释）。
- [ ] **宕机告警**：`cp deploy/monitor.env.example deploy/monitor.env` 填 Lark Webhook，`chmod 600`；把 `monitor-tenants.sh` 挂 cron（每 3 分钟），实例掉线/恢复时推送。
- [ ] **脚本落到服务器**：`/opt/trading-agent/deploy/` 下（随主仓库 rsync 即可），
      `chmod +x deploy/*.sh`。

## 开通一个客户

```bash
cd /opt/trading-agent/deploy
./provision-tenant.sh alice alice@example.com
```

脚本会：建目录 `/opt/tenants/alice/` → 生成随机 `SECRETS_MASTER_KEY` 和初始密码 →
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
./deprovision-tenant.sh alice         # 停用（保留数据）
./deprovision-tenant.sh alice --purge # 停用并归档删除数据
```

升级所有实例（改了代码后）：先在 `/opt/trading-agent` 重建镜像，再逐个
`docker compose -p tenant-<slug> -f /opt/tenants/<slug>/docker-compose.yml up -d`。

## 交付前仍需人工确认（非代码项）

- [ ] **合规/法律**：服务条款、风险揭示、代客交易免责、司法管辖界定。
- [ ] **非托管声明**：明确你不持有客户资金；客户 API Key 必须**禁用提币权限**。
- [ ] **密钥托管**：每实例的 `SECRETS_MASTER_KEY` 在 `.env` 里，随 `data` 备份；
      丢失 = 该客户密钥不可解密，需向客户说明并有找回/重置流程。
- [ ] **监控告警**：容器 healthcheck 已内置；建议再加宕机告警（如 Uptime Kuma）。
- [ ] **资源上限**：客户多了给每个 compose 加 `mem_limit`/`cpus`，避免互相拖垮。

## 何时该迁到 Path B（真多租户）

单机上实例数到几十、运维（备份/升级/端口/证书）开始吃力时，再评估把数据层
按 tenant 重构成一套系统。那是数天量级的重构，届时另起工程。
