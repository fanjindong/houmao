# 缺货商品隐藏脚本 Spec

## 1. 目标

为 `https://pay.ldxp.cn/shop/*` 商铺页面提供一个油猴脚本，自动隐藏库存小于或等于零的商品，只改变页面显示，不改变接口请求、响应及下单逻辑。

脚本文件为 `scripts/ldxp-hide-out-of-stock.user.js`。

## 2. 页面契约

页面通过以下接口取得商品列表，`data.list[].extend.stock_count` 为库存数量：

```text
https://pay.ldxp.cn/shopApi/Shop/goodsList
```

响应中与本脚本有关的结构如下：

```json
{
  "data": {
    "list": [
      {
        "goods_key": "g8bud7",
        "link": "https://pay.ldxp.cn/item/g8bud7",
        "extend": {
          "stock_count": 0
        }
      }
    ]
  }
}
```

- 商品卡片：`.goods_item` 或 `.goods-group-item`
- 缺货标记：商品卡片内的 `.stock.rank0`
- 页面已根据 `stock_count <= 0` 生成 `rank0`，脚本直接使用此渲染结果

Masonry 页面共有 20 张 `.goods_item` 卡片，其中 16 张缺货；分组页面共有 2 张 `.goods-group-item` 卡片，均为缺货。

## 3. 功能要求

1. 脚本仅匹配 `https://pay.ldxp.cn/shop/*`。
2. 脚本须在 `document-start` 阶段注入以下 CSS 规则：

   ```css
   [item-selector=".goods_item"] {
     display: flex !important;
     flex-wrap: wrap !important;
     height: auto !important;
   }

   [item-selector=".goods_item"] > .goods_item {
     position: static !important;
     transform: none !important;
   }

   html:not(.houmao-show-out-of-stock) :is(.goods_item, .goods-group-item):has(.stock.rank0) {
     display: none !important;
   }
   ```

3. 分类切换、搜索及“加载更多”插入的新商品须自动受同一规则约束。
4. Masonry 主题须改用原生 flex 重排剩余卡片，避免隐藏绝对定位卡片后留下空洞。
5. 不带 `.stock.rank0` 的商品卡片保持原样。
6. 有缺货商品时，在商品容器外层列表尾部增加“显示所有缺货商品”按钮，避免按钮参与商品布局。
7. 按钮须始终位于商品卡片之后；“加载更多”新增卡片后仍须归位到末尾。
8. 点击按钮后，本页展示全部缺货商品并移除所有该按钮；后续新增商品亦保持展示。
9. 刷新页面后恢复默认隐藏状态。

## 4. 非目标

- 不在商品详情页工作。
- 不提供再次隐藏、持久化设置或缺货计数。
- 不监听或改写接口，不拦截下单，不自动刷新库存。
- 不引入第三方依赖、构建工具、包管理器或测试框架。

## 5. 脚本元数据

首版采用如下元数据：

```javascript
// ==UserScript==
// @name         LDxP 隐藏缺货商品
// @namespace    https://github.com/fanjindong/houmao
// @version      0.1.0
// @description  自动隐藏 pay.ldxp.cn 商铺中的缺货商品
// @match        https://pay.ldxp.cn/shop/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/fanjindong/houmao/main/scripts/ldxp-hide-out-of-stock.user.js
// @downloadURL  https://raw.githubusercontent.com/fanjindong/houmao/main/scripts/ldxp-hide-out-of-stock.user.js
// ==/UserScript==
```

脚本不主动请求网络，故不需要 `@connect` 或页面上下文权限。

## 6. 分发与更新

### 6.1 首选方案：公开 GitHub 仓库

公开仓库的 `main` 分支同时作为源码与发布源：

```text
https://raw.githubusercontent.com/fanjindong/houmao/main/scripts/ldxp-hide-out-of-stock.user.js
```

分发步骤：

1. 确认 GitHub 仓库 `fanjindong/houmao` 为公开仓库。
2. 将脚本推送到 `main` 分支。
3. 用户在装有 Tampermonkey、Violentmonkey 或同类扩展的浏览器中打开上述 Raw 地址。
4. 扩展识别 `.user.js` 后展示安装页，用户确认安装。

更新步骤：

1. 修改并验证脚本。
2. 必须递增 `@version`。
3. 将新版脚本推送到 `main`。
4. 油猴扩展按自身检查周期读取 `@updateURL`；发现更高版本后，从 `@downloadURL` 安装新版。用户也可在扩展中手动执行“检查更新”。

同一个 Raw 地址可同时用于 `@updateURL` 与 `@downloadURL`，无需另建仅含元数据的更新文件。

### 6.2 版本规则

使用语义化版本：

- PATCH：修复页面适配或错误，例如 `0.1.0` → `0.1.1`
- MINOR：新增向后兼容功能，例如增加用户开关
- MAJOR：改变既有判断或配置契约

发布更新时不得只改代码而保留原版本号，否则已安装用户不会收到自动更新。

## 7. 验收标准

1. 打开任一匹配的商铺页，接口返回 `stock_count <= 0` 的商品卡片不可见。
2. 不带 `.stock.rank0` 的商品卡片保持可见。
3. 其他库存等级如 `.rank5`、`.rank30` 与 `.rankmore` 保持可见。
4. 切换分类、搜索或加载下一页后，新商品仍按库存正确显示。
5. 同一商品后续移除 `.stock.rank0` 时，商品重新可见。
6. 非商铺页面及页面原有交互不受影响。
7. 两类下载页面离线检查应分别匹配 20 张卡片中的 16 张缺货卡片，以及 2 张卡片中的 2 张缺货卡片。
8. 隐藏后剩余卡片须重新排列，不保留原绝对定位空洞。
9. 商品容器尾部显示“显示所有缺货商品”按钮。
10. 新卡片插入按钮之后时，按钮须自动移回末尾。
11. 点击按钮后，16 张缺货卡片全部显示，按钮消失；后续 DOM 更新不得重新创建按钮。

运行验收：

```sh
sh tests/run.sh
```
