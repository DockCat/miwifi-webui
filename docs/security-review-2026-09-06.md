# miwifi-webui 安全性審查報告

**審查日期**: 2026-09-06 · **範圍**: 整個 monorepo（apps/api、apps/web、packages/router-core、packages/contracts、部署設定）· **方法**: 全程式碼人工審查 + 獨立雙重驗證（每個發現由第二個獨立子任務逐行核對原始碼與安裝的相依套件）

## 安全架構摘要

miwifi-webui 是自架的 Fastify (apps/api) + React/Vite/nginx (apps/web) + PostgreSQL 管理介面，透過 docker compose 部署（含 Traefik TLS labels 與發佈的 HTTP 埠）。認證為單一管理員：Argon2id 密碼雜湊、32-byte 隨機 session token（SHA-256 雜湊後存 DB）、HttpOnly/SameSite=lax cookie（30 分鐘閒置 / 12 小時絕對逾時）、登入時 session 輪替。瀏覽器永不直接連路由器（ADR 0001）；後端以 AES-256-GCM 信封加密（`APP_MASTER_KEY`）封存路由器憑證，並以唯讀/寫入效果分級的操作目錄管理所有路由器存取。全部 SQL 參數化；唯一可變動操作（裝置斷網/恢復）有讀回驗證；AI 調查工具嚴格唯讀且對外部 provider 去識別化。

---

# Vuln 1: 認證繞過（X-Forwarded-For 偽造突破「僅限本機」的首次管理員建立限制）: `apps/api/src/routes/auth.ts:28-31`

* **嚴重度**: High（雙重驗證後自 Medium 提升）
* **類別**: authentication_bypass
* **信心度**: 0.90（雙重驗證：已逐行核對 Fastify 5.12.1 安裝原始碼確認攻擊機制）

**描述**: 首次管理員建立（`POST /api/auth/bootstrap`）以 `isLoopback(request)` 把關，比較 `request.ip` 與 loopback 位址字面值。當應用以 `TRUST_PROXY=true` 運行時 — `.env.example:39-42` 明確指示 compose proxy 部署要這樣設定，`compose-dev.yaml:64` 更是直接寫死 — Fastify 5.12.1 的 `trustProxy: true` 語義會讓 `request.ip` 取 `X-Forwarded-For` 的**最左側**項目（已在 `node_modules/fastify/lib/request.js:47-49, 111-116` 與 `@fastify/proxy-addr`/`@fastify/forwarded` 原始碼中逐行驗證）。nginx 的 `$proxy_add_x_forwarded_for`（`nginx.conf:22`）是**附加式**，客戶端提供的最左側 XFF 項目會原封不動通過；`compose.yaml:61-62` 又直接把 API 埠發佈到所有介面，直連時甚至不經 proxy。兩條路徑都能用 `X-Forwarded-For: 127.0.0.1` 騙過 `isLoopback()`。此外，使用者數量檢查（409）在 loopback 檢查（403）**之前**執行，未認證的遠端探測可藉由回應碼區分「首次視窗開啟中」與「已完成」，精準掌握攻擊時機。這完全擊潰 ADR 0003 明訂的「bootstrap 必須限制在本機」。

**攻擊情境**: 在擁有者建立第一個管理員之前，LAN 上的攻擊者（本任務定義 LAN 內可達即為高風險）先以空 body 探測 `POST /api/auth/bootstrap` 直到回 403 `bootstrap_local_only`（視窗開啟），再附上 `X-Forwarded-For: 127.0.0.1` 與自選帳號密碼重送 — 直打發佈的 API 埠或穿過 nginx `/api/` proxy 皆可。Fastify 將 `request.ip` 解析為偽造的 127.0.0.1，loopback 檢查通過，攻擊者成為**唯一的管理員**，永久佔有整個應用（路由器憑證、裝置斷網控制、流量歷史），正主永遠無法 bootstrap（409）且無從察覺。單一 curl 請求即可確定性完成，無需任何特殊條件。

**修復建議**:
1. bootstrap 的 loopback 判斷改用 peer socket 位址（`request.socket.remoteAddress`）而非 `request.ip`，讓轉發 header 永遠無法滿足本機限制（proxy 路徑的 bootstrap 會連帶被擋，compose 擁有者改用 `docker exec`/CLI — `apps/api/src/cli/admin.ts` 已支援此流程）
2. 若任何地方要保留 header 衍生的 IP，把布林 `TRUST_PROXY` 改為明確的 proxy 子網清單（如 `TRUST_PROXY=172.16.0.0/12`）；Fastify 經 `@fastify/proxy-addr` 接受逗號分隔 CIDR 字串。**切勿用數字 hop count** — Fastify 5.12.1 對數字是 fail-closed（會整個停用 XFF，連 cookie Secure 的 `X-Forwarded-Proto` 行為都會壞掉）
3. 調換 bootstrap 檢查順序（loopback 在使用者數量之前），讓非本機客戶端一律收到統一的 403，無從區分首次狀態
4. 為「`trustProxy: true` 實例上偽造 `X-Forwarded-For: 127.0.0.1`」補上回歸測試（現有測試 `security-hardening.test.ts:81-106` 只涵蓋 trustProxy=false 的情形）

---

## 已檢查且乾淨的區域

- **SQL 注入** — `apps/api/src/**` 所有查詢皆參數化 `$n` 佔位符；無字串插值
- **命令注入 / RCE** — 全 repo 無 `child_process`、`eval`、`new Function`
- **XSS** — React 自動轉義遍及 `apps/web/src`；無 `dangerouslySetInnerHTML` 等危險 sink
- **SSE 注入** — `writeSse` JSON 編碼，換行被轉義，無法破壞事件框架
- **CSRF** — Origin-vs-Host 檢查涵蓋所有狀態變更方法 + SameSite=lax
- **路由授權** — 全部端點列舉核對；除 health/ready/login/bootstrap 外全部 `requireAuth`
- **密碼處理** — Argon2id（OWASP 建議參數）、登入失敗時間均化（dummy hash）、無帳號枚舉、密碼不進回應/日誌
- **Token/session** — 32-byte crypto-random、SHA-256 at rest、輪替 + 撤銷、閒置+絕對逾時、無 session fixation
- **靜態機密** — AES-256-GCM 信封加密正確（每秘密隨機 DEK+IV、auth-tag 驗證）；空 `APP_MASTER_KEY` fail-closed
- **加密隨機性** — session/dek/iv 全用 `randomBytes`；唯一 `Math.random()`（`adapter.ts:108`）是鏡像 MiWiFi 協議的挑戰 nonce，非本應用安全值
- **TLS 驗證** — 無 `rejectUnauthorized: false` / `NODE_TLS_REJECT_UNAUTHORIZED`
- **SSRF** — `validateRouterTarget` 正確限制 RFC1918/link-local/loopback + 保守本機主機名；transport 不跟隨重導向
- **錯誤處理** — 全域 handler 回泛用 `{error:'internal'}`，不洩漏連線字串/堆疊
- **敏感日誌** — stok 不出 adapter；audit metadata 鍵值黑名單清洗
- **AI 子系統** — 唯讀工具註冊表 + 參數化 SQL + 外部 provider MAC/IP/名稱去識別化 + secret 形狀 fail-closed redaction
- **GitHub workflows** — `pull_request_target` 型不可信觸發不存在；catter workflow 以 bot actor 閘控
- **Dockerfiles** — digest-pin 基底映像、非 root 使用者、無秘密進映像

## 已驗證排除的發現（誤報）

**「Session cookie 永不標記 Secure」**（初判 Medium）— 獨立驗證為**誤報**：本 repo 唯一含 TLS 的拓撲（`compose-dev.yaml`）中 Traefik 以 priority=100 將 `/api` **直接**路由到 API 容器（繞過 nginx），帶 `X-Forwarded-Proto: https` + 寫死的 `TRUST_PROXY=true`，故 HTTPS 路徑的 cookie **確實帶 Secure 旗標**，原發現的核心機制被 repo 自身的路由 labels 反證。在純 HTTP 的 committed `compose.yaml` 拓撲中 Secure 旗標本來就不可能設（設了會破壞登入），屬 ADR 0004 明載的部署責任（hardening），非程式碼漏洞。殘餘的合理建議（TLS 部署下停止發佈明文 80/3001 埠、加 HSTS）屬部署強化項目。

---

*審查過程：第一階段全專案掃描由一個子任務完成（93 次工具呼叫，涵蓋所有 API 路由、認證、加密、儲存庫、router-core、web、部署檔案）；第二階段每個發現各由一個獨立子任務對照原始碼逐項驗證（含 node_modules 內 Fastify/proxy-addr/forwarded 的實際安裝版本），信心度低於 0.8 者排除。*
