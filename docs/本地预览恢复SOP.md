# 本地预览恢复 SOP

## 目的

当产品经理工作台页面空白、登录提示“连接失败”或 `127.0.0.1:5174` 无法访问时，按本流程恢复本地预览。

本项目的源码预览需要两个服务同时存活：

- `5174`：Vite 前端，展示当前分支的最新源码；
- `25809`：AionCore 本地后端，负责登录、项目数据、文件和模型接口。

只恢复前端会看到登录页但无法登录；只恢复后端则看不到当前分支的最新页面。

## 固定入口

- 登录页：<http://127.0.0.1:5174/#/login>
- 项目列表：<http://127.0.0.1:5174/#/projects>
- 不使用 `25809` 验收最新前端；它可能仍提供旧的已构建页面。

## 恢复步骤

以下命令在仓库根目录执行：

```powershell
Set-Location 'C:\Users\lenovo\OneDrive\文档\全栈项目\.codex-tmp-ai-prd'
$projectRoot = (Resolve-Path '.').Path
$aionUiRoot = Join-Path $projectRoot 'AionUi'
$runtimeRoot = Join-Path $projectRoot '.codex-runtime'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
```

### 1. 检查两个端口

```powershell
Get-NetTCPConnection -LocalPort 5174,25809 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess
```

若两个端口都在监听，先刷新 `http://127.0.0.1:5174/#/projects`。若端口缺失，继续下面步骤。

### 2. 定位 AionCore 后端

```powershell
$backendCandidates = @(
  (Join-Path $aionUiRoot 'AionCore\target\debug\aioncore.exe'),
  (Join-Path $aionUiRoot 'resources\bundled-aioncore\win32-x64\aioncore.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\AionUi\resources\bundled-aioncore\win32-x64\aioncore.exe')
)
$backendPath = $backendCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$backendPath
```

若没有输出，说明后端二进制可能在磁盘清理时被删除。优先执行：

```powershell
Set-Location $aionUiRoot
& 'E:\DevTools\Bun\bin\bun.exe' scripts/prepareAioncore.js
```

若 PowerShell 下载 GitHub Release 失败，改用 `curl.exe` 下载项目 `package.json` 中 `aioncoreVersion` 对应的 Windows x64 Release，解压后把 `aioncore.exe` 的绝对路径赋给 `$backendPath`。不要把下载包、运行日志或账号密码提交到 Git。

### 3. 启动后端

```powershell
$env:AIONUI_BACKEND_BIN = $backendPath
$backendProcess = Start-Process `
  -FilePath 'E:\DevTools\Bun\bin\bun.exe' `
  -ArgumentList @('scripts/webui.ts','--no-build','--no-open') `
  -WorkingDirectory $aionUiRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $runtimeRoot 'local-preview-backend.out.log') `
  -RedirectStandardError (Join-Path $runtimeRoot 'local-preview-backend.err.log') `
  -PassThru
```

### 4. 启动源码前端

```powershell
$frontendProcess = Start-Process `
  -FilePath 'E:\DevTools\Bun\bin\bun.exe' `
  -ArgumentList @('scripts/previewWeb.ts') `
  -WorkingDirectory $aionUiRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $runtimeRoot 'local-preview-frontend.out.log') `
  -RedirectStandardError (Join-Path $runtimeRoot 'local-preview-frontend.err.log') `
  -PassThru
```

### 5. 验证服务，而不是只看首页

等待几秒后检查：

```powershell
Get-NetTCPConnection -LocalPort 5174,25809 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess

Invoke-WebRequest 'http://127.0.0.1:5174/' -UseBasicParsing |
  Select-Object StatusCode
```

验收必须同时满足：

1. `5174` 和 `25809` 都在监听；
2. `5174` 首页返回 `200`；
3. 登录成功，不再显示“连接失败”；
4. 能进入项目列表并打开一个真实项目；
5. 当前里程碑的页面或功能可见。

首页返回 `200` 只代表前端存活，不能代替登录和项目数据验收。

## 快速诊断

| 现象                               | 最可能原因                         | 处理                                            |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------- |
| `5174` 打不开                      | Vite 前端未启动                    | 执行“启动源码前端”                              |
| 登录页可见，但提示连接失败         | `25809` 后端未启动，或前端代理缺失 | 检查后端端口与 `scripts/previewWeb.ts` 代理配置 |
| 后端启动日志提示 binary not found  | AionCore 二进制被清理              | 重新准备或下载 AionCore                         |
| 项目列表为空或项目无法打开         | 后端未使用原数据目录，或接口异常   | 检查 `.aionui-web-dev` 数据目录和后端日志       |
| `25809` 页面能开，但看不到最新改动 | 打开的是旧构建页面                 | 改用 `5174`                                     |

## 登录“连接失败，请稍后重试”的处理

出现该提示时，不要连续点击“登录”。它通常表示登录页已经由 `5174` 加载，但 `25809` 后端尚未就绪、已退出，或前端代理无法连接后端。

按以下顺序重试：

1. 保留当前登录页，不清除浏览器数据，也不重置项目数据库；
2. 检查 `5174` 与 `25809` 是否都在监听；
3. 若 `25809` 缺失，查看 `local-preview-backend.err.log`，按错误恢复兼容的 AionCore 后端；
4. 若日志出现 `database.newer_than_app`，说明后端版本低于现有数据库迁移版本。不得降级、删除或重建数据库，必须换用支持该迁移版本的新后端；
5. 两个端口都恢复后，在登录页执行一次强制刷新（`Ctrl+F5`）；
6. 确认地址仍是 `http://127.0.0.1:5174/#/login`，再点击一次“登录”；
7. 登录后进入项目列表并打开真实项目，确认项目数据和当前里程碑功能都存在。

若强制刷新后仍失败，依次记录以下信息再排查，不盲目重复登录：

```powershell
Get-NetTCPConnection -LocalPort 5174,25809 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort,OwningProcess

Get-Content -LiteralPath '.codex-runtime\local-preview-backend.err.log' -Tail 50
Get-Content -LiteralPath '.codex-runtime\local-preview-frontend.err.log' -Tail 50
```

“稍后重试”指服务恢复后刷新并重试一次，不是等待页面自行恢复。已经保存在浏览器输入框中的密码只用于本地登录，不得复制到 SOP、日志、提交说明或 GitHub。

## 日志位置

运行日志统一放在仓库根目录 `.codex-runtime`，该目录不纳入提交：

- `local-preview-backend.out.log`
- `local-preview-backend.err.log`
- `local-preview-frontend.out.log`
- `local-preview-frontend.err.log`

排错时先看四份日志末尾，再决定是否重启。不得把登录密码、API Key 或其他凭据写入 SOP、日志说明或 Git 提交。

## 2026-10-12 恢复记录

### 用户看到的现象

- `http://127.0.0.1:5174/#/login` 可以显示登录页；
- 点击登录后提示“连接失败，请稍后重试”；
- 反复刷新或再次点击登录没有恢复；
- `5174` 曾经完全无法访问。

### 根因

本次不是一个问题，而是连续出现了三层问题：

1. 本地预览进程已经退出，`5174` 和 `25809` 均未监听；
2. C 盘清理后，原先位于忽略目录中的 AionCore 开发二进制被删除，前端恢复后无法启动后端；
3. 仓库固定下载的 AionCore `v0.2.2` 只认识数据库迁移 43，而现有项目数据库已经应用迁移 44；随后从 AionCore 当前源码编译的后端虽然认识迁移 44，但当前上游的第 44 号迁移与本机数据库曾应用的“project workflow”迁移同号不同内容，因此校验失败。后端为保护数据主动拒绝启动。

所以，“连接失败”不是密码错误，也不是登录按钮失效，而是登录页可见时后端仍不可用。页面不会自动恢复，持续点击登录没有作用。

### 本次解决办法

1. 重新启动 `5174` 源码前端；
2. 从 AionCore 当前源码编译支持迁移 44 的后端；
3. 保留 `C:\Users\lenovo\.aionui-web-dev` 原数据目录不变；
4. 将原数据目录复制到仓库忽略的 `.codex-runtime/preview-data-m5-20261012`，只在该临时副本中处理迁移 44 的校验冲突；
5. 使用临时数据副本启动 `25809` 后端；
6. 确认 `5174`、`25809` 同时监听且前端返回 `200`；
7. 在登录页执行 `Ctrl+F5`，重新登录并打开真实项目进行验证。

原数据库没有被删除、降级、重建或修改。临时副本用于恢复开发预览，不替代正式数据备份；它只包含复制时刻之前的数据，后续若要长期使用，必须先解决自定义“project workflow”迁移与上游第 44 号迁移的编号冲突。

### 下次的最短判断路径

```text
页面打不开
  -> 查 5174
  -> 5174 缺失：启动源码前端
  -> 登录连接失败：查 25809
  -> 25809 缺失：读后端错误日志
     -> binary not found：恢复兼容后端二进制
     -> database.newer_than_app：后端版本过旧，禁止降级数据库
     -> migration N was previously applied but has been modified：迁移同号冲突，禁止修改原库
  -> 双端口恢复
  -> Ctrl+F5
  -> 登录一次
  -> 打开真实项目验证数据和当前功能
```

### 后续工程修复

为了避免再次依赖临时副本，需要把自定义项目工作流迁移改为未被上游占用的新编号，并提供一次受控的迁移兼容方案。该项属于后端数据迁移治理，不应在页面恢复过程中临时改动正式数据库。

## 停止服务

只停止本 SOP 启动且 PID 已确认的进程：

```powershell
Stop-Process -Id $backendProcess.Id,$frontendProcess.Id
```

不要按进程名批量终止全部 `bun`、`node` 或 `aioncore`，避免影响其他任务。
