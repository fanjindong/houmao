// ==UserScript==
// @name         卡网库存助手
// @namespace    https://github.com/fanjindong/houmao
// @version      0.2.1
// @description  显示 pay.ldxp.cn 商铺百件以下的准确库存并自动隐藏缺货商品
// @match        https://pay.ldxp.cn/shop/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/fanjindong/houmao/main/scripts/ldxp-hide-out-of-stock.user.js
// @downloadURL  https://raw.githubusercontent.com/fanjindong/houmao/main/scripts/ldxp-hide-out-of-stock.user.js
// ==/UserScript==

(function () {
  'use strict';

  const showAllClass = 'houmao-show-out-of-stock';
  const buttonClass = 'houmao-show-out-of-stock-button';
  const listSelector = '.goods_content ._index .list, .goods-group-content, .goods-list';
  const originalOpen = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (...args) {
    const result = originalOpen.apply(this, args);

    if (String(args[1]).includes('/shopApi/Shop/goodsList')) {
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== XMLHttpRequest.DONE) return;

        try {
          const response = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          for (const goods of response?.data?.list || []) {
            const stockCount = goods.extend?.stock_count;
            if (stockCount > 0 && stockCount < 100) goods.extend.show_stock_type = 1;
          }
          if (this.responseType !== 'json') {
            Object.defineProperty(this, 'responseText', { value: JSON.stringify(response) });
          }
        } catch {}
      }, true);
    }

    return result;
  };

  const style = document.createElement('style');
  style.textContent = `
    [item-selector=".goods_item"] {
      display: flex !important;
      flex-wrap: wrap !important;
      height: auto !important;
    }
    [item-selector=".goods_item"] > .goods_item {
      position: static !important;
      transform: none !important;
    }
    html:not(.${showAllClass}) :is(.goods_item, .goods-group-item, .goods-item):has(.stock.rank0) {
      display: none !important;
    }
    .${buttonClass} {
      width: calc(100% - 12px);
      min-height: 44px;
      margin: 0 6px 12px;
      color: #2275ff;
      font: inherit;
      background: #f0f7ff;
      border: 1px solid #2275ff;
      border-radius: 8px;
      cursor: pointer;
    }
  `;
  document.documentElement.appendChild(style);

  const createButton = () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = buttonClass;
    button.textContent = '显示所有缺货商品';
    button.addEventListener('click', () => {
      document.documentElement.classList.add(showAllClass);
      syncButtons();
    });
    return button;
  };

  const syncButtons = () => {
    const showingAll = document.documentElement.classList.contains(showAllClass);

    for (const list of document.querySelectorAll(listSelector)) {
      let button = list.querySelector(`:scope > .${buttonClass}`);
      const needsButton = !showingAll && list.querySelector(':is(.goods_item, .goods-group-item, .goods-item) .stock.rank0');

      if (!needsButton) {
        button?.remove();
        continue;
      }

      button ||= createButton();
      if (list.lastElementChild !== button) list.appendChild(button);
    }
  };

  new MutationObserver(syncButtons).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  syncButtons();
}());
