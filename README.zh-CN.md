# A 股 ETF 因子策略平台

[English](README.md) | [简体中文](README.zh-CN.md)

一个轻量、可配置的 A 股 ETF 因子策略平台，用于策略研究、回测和信号跟踪。它面向个人自用和普通投资者，目标是把投资想法沉淀成可复用的策略配置，而不是每次都改代码。

项目可以作为静态网站部署到 GitHub Pages、Vercel、Netlify 或 Cloudflare Pages。计算层和 React 界面已经分离，后续可以把同一套策略核心复用到 API 服务、定时任务或微信小程序里。

## 功能

- 支持固定 ETF 池，也支持按历史、数据完整性、近 20 日成交额和分类上限按月重建动态池
- 动态池会对同一跟踪标的去重，并用保留缓冲降低相近 ETF 频繁互换
- 支持多个自定义基础策略
- 支持按权重组合多个已有策略
- 支持参数化因子实例，包括动量、趋势、波动率、回撤和流动性因子
- 可在界面新增、复制、删除、启用、停用和调整因子权重
- 支持可配置的排序前筛选条件，包括阈值和区间筛选
- 支持每日、每周、每月调仓，并可选择周几或每月几号
- 支持等权、按分数加权和按排名固定比例分配
- 支持最大单仓、最低现金比例和可选空仓替代 ETF 等风控约束
- 支持保存回测起止日期，并选择单只 ETF 或 ETF 池等权基准
- 支持 T+1 开盘或收盘成交、滑点、最低佣金、成交额参与率和涨跌停约束
- 提供 70/30 样本外验证、历史截断信号重放、基准对比、数据质量检查和稳健性压力测试
- 支持按账号保存回测快照、横向比较，并导出 JSON 或净值曲线 CSV
- 提供最新信号跟踪，便于后续人工决策

## 技术栈

- Vite + React + TypeScript
- Vitest 用于核心回测和因子引擎测试
- Recharts 用于回测图表
- lucide-react 用于界面图标
- 静态部署目标：GitHub Pages、Vercel、Netlify、Cloudflare Pages
- 可选数据刷新：GitHub Actions + AkShare，并带有备用数据源

## 设计思路

平台借鉴成熟开源量化项目中适合个人和轻量部署的部分，但不绑定重型运行时：

- 借鉴 Qlib 的配置驱动研究流程和因子目录思路
- 借鉴 zvt 的因子评分、筛选和交易决策分层
- 借鉴 Freqtrade 的参数和风控配置思路
- 借鉴 vectorbt 后续可扩展到参数扫描和策略矩阵对比的方向

计算层放在 `src/core`，React 界面放在 `src/components`。这样策略逻辑不会和当前网页界面强绑定，后续迁移到其他形态会更容易。

## 本地开发

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址即可。

## 账号与微信登录

平台会按账号保存策略工作区。不同账号的策略列表、当前选中策略和回测快照会保存在浏览器 `localStorage` 中，互不覆盖。未登录时使用默认本地账号。

配置 Supabase 后，可以使用邮箱魔法链接登录并把策略和回测快照同步到云端。快照复用现有 `strategies` JSONB 字段，不需要新增数据表或执行迁移 SQL。账号面板会显示保存中、已保存或保存失败状态，连续编辑会先合并再写入云端。

微信登录有两种模式：

- 未配置环境变量时，界面使用本地微信模拟登录，适合个人离线使用和开发测试。
- 配置 `VITE_WECHAT_APP_ID` 后，点击微信登录会跳转到微信开放平台扫码授权页。

真实微信登录不能在前端保存或使用 `AppSecret`。项目已内置 Vercel Serverless Function：

```text
/api/auth/wechat
```

部署到 Vercel 时配置：

```bash
VITE_WECHAT_APP_ID=wx_xxx
VITE_WECHAT_REDIRECT_URI=https://your-domain.example/
WECHAT_APP_ID=wx_xxx
WECHAT_APP_SECRET=your_wechat_app_secret
```

默认情况下，前端会把微信回调拿到的 `{ code, state }` 提交到 `/api/auth/wechat`。该接口在服务端使用 `WECHAT_APP_SECRET` 向微信换取 `access_token` 和用户资料，并返回：

```json
{
  "id": "wechat-openid-or-unionid",
  "provider": "wechat",
  "displayName": "用户昵称",
  "avatarUrl": "https://example.com/avatar.png"
}
```

如果部署在 GitHub Pages 这类纯静态平台，没有后端函数，真实微信登录不可用，只能使用本地微信模拟登录。

## 验证

```bash
npm test
npm run build
```

## 数据

应用内置了确定性的演示数据，位于 `src/core/sampleData.ts`，安装后即可运行。

运行时会优先尝试加载：

```text
public/data/a-share-etf-bars.generated.json
```

如果该文件不存在或格式无效，会自动回退到内置演示数据。

获取真实 ETF 日线数据：

```bash
python -m pip install akshare pandas curl_cffi
python scripts/fetch-akshare-etf.py --discover --discover-limit 60 --full-refresh
```

`--discover` 会从 AkShare 当前 ETF 行情发现流动性靠前的广谱母池，保留默认标的和仍处于流动性缓冲区的上期成员。每次母池变化都会写入 `universeSnapshots`，供回测按当时可用名单选池。仓库内置的 GitHub Actions 工作流会在交易日使用 `--full-refresh` 重拉当前母池，避免前复权基准变化造成新旧历史不一致；单只标的刷新失败时仍保留上一版历史数据。

首次启用动态发现时只能从当前日期开始积累真实成员快照。更早的区间会按数据文件中可见的标的重建，并在回测中明确提示可能存在幸存者偏差。

## 策略配置

默认策略定义在 `src/core/defaultStrategy.ts`。平台支持基础策略和组合策略。

基础策略包含：

- `universe`：选中的 ETF 代码
- `universeSelection`：固定或动态模式，以及最短历史、数据完整率、成交额、池子上限、分类上限和替换缓冲参数
- `factors`：启用的因子、权重、方向和参数
- `filters`：排序前筛选规则，例如成交额阈值或波动率区间
- `rebalance`：每日、每周或每月调仓规则
- `portfolio`：Top N、仓位方式和可选的排名固定权重
- `transactionCostBps`：按实际成交金额计算的单边交易成本
- `benchmarkSymbol`：选择单只 ETF 或 ETF 池等权作为对比基准
- `backtestStartDate` / `backtestEndDate`：可选、可保存的回测区间
- `execution`：T+1 成交时点、滑点、初始资金、最低佣金、成交额参与率和涨跌停阈值
- `risk`：现金收益、最大单仓、最低现金比例和空仓替代标的

组合策略包含：

- `components`：已有策略 id 和目标权重
- `transactionCostBps`：组合层面的可选成本假设
- `benchmarkSymbol`：组合策略的对比基准
- `backtestStartDate` / `backtestEndDate`：组合策略的可选回测区间
- `execution`：组合层面的成交假设
- `risk`：现金收益假设

因子是参数化的。例如同一个 `volatility` 波动率因子可以配置 `window: 20`、`window: 50` 或其他支持的窗口，不需要新增多个写死的因子 id。

## 部署

GitHub Pages 生产构建：

```bash
npm test
$env:VITE_BASE_PATH="/etf-platform/"
npm run build
```

仓库包含 `.github/workflows/deploy-pages.yml`。每次推送到 `master` 时，会使用 `VITE_BASE_PATH=/etf-platform/` 构建 `dist` 并部署到 GitHub Pages。

生产地址：

```text
https://happyfee.github.io/etf-platform/
```

如果首次部署被仓库设置拦截，打开 GitHub 仓库 Settings -> Pages，并将 Source 设置为 GitHub Actions。

Vercel：

```bash
npm run build
```

使用仓库内置的 `vercel.json`，输出目录为 `dist`。

Netlify：

使用仓库内置的 `netlify.toml`，发布目录为 `dist`。

## 重要说明

本项目是研究和跟踪工具，不构成投资建议。使用任何信号前，请自行验证数据质量、ETF 流动性、费用假设和实盘交易限制。
