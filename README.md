# openclaw-icloud-calendar

让 **OpenClaw** 通过标准 **CalDAV** 读写你的 **苹果 iCloud 日历**：查日历、按时间窗读事件（自动展开重复日程）、建事件、以及带四道闸门的删除。

> English: [README.en.md](./README.en.md)

**状态**：代码可编译、**72 项测试全绿**（含 DAV 读取器、内存 CalDAV 假服务器与真实 DPAPI 凭据往返）。**尚未用真实 iCloud 账号做过端到端验收** —— 首次使用请先跑 `openclaw-icloud-calendar status --probe`，并用一个单独的测试日历验证写入。

---

## 为什么是 CalDAV

苹果没有公开 iCloud 日历的 REST API，EventKit 只在 macOS 本机可用。跨平台唯一可行的自动化入口就是 **CalDAV（RFC 4791）**：

```
OpenClaw 插件 → HTTPS → https://caldav.icloud.com/ → 你的 iCloud 日历
认证：Apple ID（邮箱）+ App 专用密码
```

所以这个插件在 Windows / macOS / Linux 上行为一致。

---

## 安装

需要 OpenClaw `>=2026.5.17`、Node `^22.19 || >=24`。

```bash
# 1) 从本地 checkout 安装（开发/自用首选）
openclaw plugins install /绝对路径/openclaw-icloud-calendar

# 2) 直接从 GitHub 安装（仓库已提交构建产物 dist/）
openclaw plugins install github:CaiMingshen/openclaw-icloud-calendar
```

验证装载成功：

```bash
openclaw plugins inspect icloud-calendar --runtime --json
```

应能看到 `calendar_status` / `calendar_list_calendars` / `calendar_list_events` / `calendar_create_event` / `calendar_delete_events` 五个工具。

> **为什么把 `dist/` 也提交进仓库**：让 `github:` 安装零构建步骤，安装时不触发任何 `prepare` 脚本。

---

## 配置

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `account` | 空 | Apple ID 邮箱；留空则读 `ICLOUD_ACCOUNT` |
| `secretEnv` | `ICLOUD_APP_PASSWORD` | App 专用密码所在的环境变量名 |
| `secretSource` | `auto` | `auto` \| `env` \| `store` |
| `serverUrl` | `https://caldav.icloud.com/` | CalDAV 入口 |
| `allowWrites` | `true` | 建事件总开关 |
| `allowDeletes` | **`false`** | 删除总开关，默认关闭 |
| `maxDeletesPerCall` | `1` | 单次删除对象上限 |
| `maxWindowDays` | `366` | 读窗口上限（天） |
| `maxDeleteWindowDays` | `90` | 删除扫描窗口上限（天） |
| `timeoutMs` / `retries` | `30000` / `2` | 请求超时与重试 |
| `proxyUrl` | 空 | 可选 HTTP 代理 |

配置里**没有密码字段**，这是故意的：配置文件是磁盘上的明文，把 App 专用密码写进去就等于绕过了系统凭据存储。

`serverUrl` 的取值规则：**远程主机必须 HTTPS**；只有 `127.0.0.1` / `::1` / `localhost` 允许明文 HTTP —— 自建 CalDAV（Radicale、Nextcloud、Baikal）经常就在本机跑明文。

---

## 凭据

### 1. 生成 App 专用密码（必须）

1. 登录 <https://appleid.apple.com>
2. **登录与安全 → App 专用密码 → 生成**（形如 `abcd-e…mnop`）
3. **不要用 Apple ID 登录密码** —— 开了双重认证后它必然被拒（HTTP 401）

### 2. 存放（三种来源，按 `secretSource` 决定优先级）

| 来源 | 说明 |
| --- | --- |
| OS 凭据存储 | Windows → **DPAPI**（绑定当前用户）；macOS → **钥匙串**（`security`）；Linux → **libsecret**（`secret-tool`） |
| 环境变量 | `secretEnv` 指定的变量，默认 `ICLOUD_APP_PASSWORD` |
| 都不配 | 报错点名缺哪个变量、并给出下一步命令，绝不回显密文 |

写入系统凭据存储：

```powershell
# Windows：密码只经过 stdin，不进 argv、不进 shell 历史
$p = Read-Host 'App 专用密码'
$p | node dist/cli.js login --account you@example.com
```

```bash
# macOS / Linux
read -rs -p 'app-specific password: ' P && printf '%s' "$P" | node dist/cli.js login --account you@example.com
```

安全边界：

- 密钥**永不**进入工具参数、session log 或错误信息；
- DPAPI 明文只交给 PowerShell 子进程的 stdin，磁盘上是 DPAPI 密文（`%LOCALAPPDATA%\openclaw-icloud-calendar`，`.gitignore` 已排除 `*.dpapi.xml`）；
- Linux 走 `secret-tool` 时密码走 stdin；**macOS 钥匙串是唯一例外**，`security` 只接受命令行参数，argv 会短暂可见（已在代码注释中标注）。

---

## 工具（模型可见）

| 工具 | 说明 |
| --- | --- |
| `calendar_status` | 配置/凭据来源/连通性自检，**不返回密码** |
| `calendar_list_calendars` | 列出日历（名称、集合 URL、颜色、时区、组件类型）；iCloud 提醒事项列表会标 `supportsEvents=false` |
| `calendar_list_events` | 按时间窗读事件，**重复日程展开为逐条**，可取消的实例被跳过；返回 `uid` 供删除使用 |
| `calendar_create_event` | 建事件；两个日期=全天事件（end 为排他），两个带偏移的时间戳=定时事件 |
| `calendar_delete_events` | 删除，**默认干跑**，四道闸门见下 |

### 删除的四道闸门（针对"一次误删 8 条"）

1. **总开关**：`allowDeletes: false` 是默认值，不打开就没有任何删除路径；
2. **窗口必填**：`start` / `end` 必填，且删除窗口上限（默认 90 天）比读窗口（366 天）更小；
3. **精确指名**：只能给 `uid`（来自 `calendar_list_events`）或 `summaryEquals`（**完整标题、区分大小写**）——子串/模糊匹配一律拒绝；
4. **二次确认**：默认 `dryRun=true` 只报告匹配结果；真删必须 `dryRun=false` 且 `confirmCount` **等于匹配到的对象数**，同时受 `maxDeletesPerCall`（默认 1）封顶。

注意：命中重复日程时"对象数"小于"出现次数"，删除会移除**整个重复序列**，结果里会明确写出这一点。

---

## 命令行（不走模型也能用）

```bash
openclaw-icloud-calendar status [--probe] [--json]
openclaw-icloud-calendar login  --account you@example.com      # 密码从 stdin 读
openclaw-icloud-calendar logout --account you@example.com
openclaw-icloud-calendar calendars
openclaw-icloud-calendar events --start 2026-01-05T00:00:00+08:00 --end 2026-01-12T00:00:00+08:00
openclaw-icloud-calendar add    --summary "评审" --start 2026-01-05T09:00:00+08:00 --end 2026-01-05T10:00:00+08:00 --time-zone Asia/Shanghai
openclaw-icloud-calendar delete --start 2026-01-01T00:00:00+08:00 --end 2026-02-01T00:00:00+08:00 --uid <uid>
```

---

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
npm run plugin:validate
```

---

## 许可

MIT。见 [LICENSE](./LICENSE)。

---

## 致谢

移植自 [dsh-icloud-calendar](https://github.com/CaiMingshen/dsh-icloud-calendar)（DeepSeek Harness 版），核心的 CalDAV 客户端、凭据存储、iCalendar 解析与删除闸门逻辑保持一致。
