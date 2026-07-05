# CHJ AI 战略情报雷达

这是一个可上线的静态网站，用于每天自动收集公开网络情报，并生成面向董事长助理工作的战略雷达。

## 本地查看

直接打开：

`docs/index.html`

如果浏览器因本地跨域限制无法读取 JSON，可在项目目录启动一个静态服务：

`python3 -m http.server 8080`

然后访问：

`http://localhost:8080/docs/`

## 每日自动采集

采集脚本：

`npm run collect`

数据源配置：

`docs/data/sources.json`

输出文件：

`docs/data/intel.json`

GitHub Actions 工作流：

`.github/workflows/daily-intel.yml`

默认每天 UTC 00:23 自动运行一次，也可在 GitHub Actions 页面手动运行。

## 上线到 GitHub Pages

1. 新建 GitHub 仓库。
2. 把本项目文件推送到仓库默认分支。
3. 进入仓库 Settings -> Pages。
4. Build and deployment 选择 Deploy from a branch。
5. Branch 选择默认分支，目录选择 `/docs`。
6. 等待 GitHub Pages 发布，通常几分钟内生成公开网址。

## 重要说明

当前版本抓取公开 RSS / 搜索新闻源，适合面试演示和轻量级战略情报看板。

正式商用前建议补充：

- 公司内部销售、库存、会员、渠道和财务数据
- 巨潮资讯、港交所、公司公告等更稳定的官方接口
- 券商研报、舆情系统、社媒平台数据
- 人工复核流程和敏感信息合规规则
