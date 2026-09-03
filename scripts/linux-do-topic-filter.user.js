// ==UserScript==
// @name         LINUX DO 帖子过滤器
// @namespace    https://github.com/fanjindong/houmao
// @version      0.2.0
// @description  按标题、标签和类别过滤 linux.do 帖子，并在应用前预览
// @match        https://linux.do/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/fanjindong/houmao/main/scripts/linux-do-topic-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/fanjindong/houmao/main/scripts/linux-do-topic-filter.user.js
// ==/UserScript==

(function () {
  'use strict';

  const parseKeywords = (value) => {
    if (typeof value !== 'string') return [];

    const seen = new Set();
    return value.split(/\r?\n/).map((keyword) => keyword.trim()).filter((keyword) => {
      const normalized = keyword.toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  };

  const matchingKeywords = (title, keywords) => {
    if (typeof title !== 'string' || !title.trim()) return [];
    const normalizedTitle = title.toLowerCase();
    return keywords.filter((keyword) => normalizedTitle.includes(keyword.toLowerCase()));
  };

  const matchingExactKeywords = (values, keywords) => {
    const normalizedValues = new Set(values.map((value) => value.toLowerCase()));
    return keywords.filter((keyword) => normalizedValues.has(keyword.toLowerCase()));
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = { parseKeywords, matchingKeywords, matchingExactKeywords };
  }
  if (typeof document === 'undefined') return;

  const storageKeys = {
    title: 'keywords',
    tag: 'tagKeywords',
    category: 'categoryKeywords',
  };
  const prefix = 'houmao-linux-do-topic-filter';
  const hiddenClass = `${prefix}-hidden`;
  const rowSelector = '.topic-list-item[data-topic-id]';
  const titleSelector = '.title.raw-topic-link[data-topic-id]';
  const tagSelector = '.discourse-tag';
  const categorySelector = '.badge-category__name';
  let filters = {
    title: parseKeywords(GM_getValue(storageKeys.title, '')),
    tag: parseKeywords(GM_getValue(storageKeys.tag, '')),
    category: parseKeywords(GM_getValue(storageKeys.category, '')),
  };
  let dialog;

  const style = document.createElement('style');
  style.textContent = `
    .${hiddenClass} {
      display: none !important;
    }
    dialog.${prefix}-dialog {
      box-sizing: border-box;
      width: min(680px, calc(100vw - 32px));
      max-height: min(720px, calc(100vh - 32px));
      padding: 0;
      color: var(--primary, #222);
      font: inherit;
      letter-spacing: 0;
      background: var(--secondary, #fff);
      border: 1px solid var(--primary-low-mid, #d7d7d7);
      border-radius: 8px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.24);
    }
    dialog.${prefix}-dialog::backdrop {
      background: rgba(0, 0, 0, 0.45);
    }
    .${prefix}-form {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      max-height: inherit;
      margin: 0;
    }
    .${prefix}-header,
    .${prefix}-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
    }
    .${prefix}-header {
      justify-content: space-between;
      border-bottom: 1px solid var(--primary-low, #eee);
    }
    .${prefix}-header h2 {
      margin: 0;
      font-size: 1.125rem;
      line-height: 1.4;
      letter-spacing: 0;
    }
    .${prefix}-body {
      min-height: 0;
      padding: 16px;
      overflow: auto;
    }
    .${prefix}-label {
      display: block;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .${prefix}-input + .${prefix}-label {
      margin-top: 12px;
    }
    .${prefix}-input {
      box-sizing: border-box;
      width: 100%;
      min-height: 88px;
      padding: 10px 12px;
      color: inherit;
      font: inherit;
      letter-spacing: 0;
      background: var(--secondary, #fff);
      border: 1px solid var(--primary-medium, #919191);
      border-radius: 4px;
      resize: vertical;
    }
    .${prefix}-input:focus-visible {
      outline: 2px solid var(--tertiary, #0878b0);
      outline-offset: 2px;
    }
    .${prefix}-status,
    .${prefix}-error {
      margin: 12px 0 0;
    }
    .${prefix}-error {
      color: var(--danger, #c00);
    }
    .${prefix}-error[hidden] {
      display: none;
    }
    .${prefix}-preview {
      max-height: min(320px, 40vh);
      margin: 8px 0 0;
      padding: 0;
      overflow: auto;
      list-style: none;
      border-top: 1px solid var(--primary-low, #eee);
    }
    .${prefix}-preview li {
      display: grid;
      gap: 3px;
      padding: 10px 0;
      border-bottom: 1px solid var(--primary-low, #eee);
    }
    .${prefix}-preview a {
      color: var(--tertiary, #0878b0);
      overflow-wrap: anywhere;
    }
    .${prefix}-match {
      color: var(--primary-medium, #666);
      font-size: 0.875rem;
      overflow-wrap: anywhere;
    }
    .${prefix}-footer {
      justify-content: flex-end;
      border-top: 1px solid var(--primary-low, #eee);
    }
    .${prefix}-button,
    .${prefix}-close {
      box-sizing: border-box;
      min-height: 36px;
      padding: 7px 12px;
      color: inherit;
      font: inherit;
      letter-spacing: 0;
      background: transparent;
      border: 1px solid var(--primary-low-mid, #d7d7d7);
      border-radius: 4px;
      cursor: pointer;
    }
    .${prefix}-save {
      color: var(--secondary, #fff);
      background: var(--tertiary, #0878b0);
      border-color: var(--tertiary, #0878b0);
    }
    .${prefix}-close {
      width: 36px;
      padding: 0;
      font-size: 1.5rem;
      line-height: 1;
    }
    .${prefix}-button:focus-visible,
    .${prefix}-close:focus-visible {
      outline: 2px solid var(--tertiary, #0878b0);
      outline-offset: 2px;
    }
    @media (max-width: 520px) {
      dialog.${prefix}-dialog {
        width: calc(100vw - 16px);
        max-height: calc(100vh - 16px);
      }
      .${prefix}-header,
      .${prefix}-footer {
        padding: 10px 12px;
      }
      .${prefix}-body {
        padding: 12px;
      }
    }
  `;
  document.documentElement.append(style);

  const textValues = (row, selector) => Array.from(
    row.querySelectorAll(selector),
    (element) => element.textContent?.trim() || '',
  ).filter(Boolean);

  const topicDetails = (row, rules) => {
    const link = row.querySelector(titleSelector);
    const title = link?.textContent?.trim() || '';
    if (!link || !title) return { link, title, matches: [] };
    const matches = [
      { label: '标题', keywords: matchingKeywords(title, rules.title) },
      { label: '标签', keywords: matchingExactKeywords(textValues(row, tagSelector), rules.tag) },
      { label: '类别', keywords: matchingExactKeywords(textValues(row, categorySelector), rules.category) },
    ].filter((match) => match.keywords.length);
    return { link, title, matches };
  };

  const filterRow = (row) => {
    const { matches } = topicDetails(row, filters);
    row.classList.toggle(hiddenClass, matches.length > 0);
  };

  const filterAll = () => {
    for (const row of document.querySelectorAll(rowSelector)) filterRow(row);
  };

  const renderPreview = () => {
    const titleInput = dialog.querySelector(`.${prefix}-title-input`);
    const tagInput = dialog.querySelector(`.${prefix}-tag-input`);
    const categoryInput = dialog.querySelector(`.${prefix}-category-input`);
    const status = dialog.querySelector(`.${prefix}-status`);
    const preview = dialog.querySelector(`.${prefix}-preview`);
    const draft = {
      title: parseKeywords(titleInput.value),
      tag: parseKeywords(tagInput.value),
      category: parseKeywords(categoryInput.value),
    };
    const matchedTopics = [];

    for (const row of document.querySelectorAll(rowSelector)) {
      const details = topicDetails(row, draft);
      if (details.matches.length) matchedTopics.push(details);
    }

    status.textContent = `当前页面将过滤 ${matchedTopics.length} 个帖子`;
    const fragment = document.createDocumentFragment();
    for (const { link: sourceLink, title, matches } of matchedTopics) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const match = document.createElement('span');
      link.href = sourceLink.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = title;
      match.className = `${prefix}-match`;
      match.textContent = matches
        .map(({ label, keywords: matchedKeywords }) => `${label}：${matchedKeywords.join('、')}`)
        .join('；');
      item.append(link, match);
      fragment.append(item);
    }
    preview.replaceChildren(fragment);
  };

  const createDialog = () => {
    const element = document.createElement('dialog');
    element.className = `${prefix}-dialog`;
    element.innerHTML = `
      <form method="dialog" class="${prefix}-form">
        <header class="${prefix}-header">
          <h2>帖子过滤器</h2>
          <button type="submit" value="cancel" class="${prefix}-close" aria-label="关闭" title="关闭">×</button>
        </header>
        <div class="${prefix}-body">
          <label class="${prefix}-label" for="${prefix}-title-input">标题过滤词（每行一个）</label>
          <textarea id="${prefix}-title-input" class="${prefix}-input ${prefix}-title-input"></textarea>
          <label class="${prefix}-label" for="${prefix}-tag-input">标签名称（每行一个）</label>
          <textarea id="${prefix}-tag-input" class="${prefix}-input ${prefix}-tag-input"></textarea>
          <label class="${prefix}-label" for="${prefix}-category-input">类别名称（每行一个）</label>
          <textarea id="${prefix}-category-input" class="${prefix}-input ${prefix}-category-input"></textarea>
          <p class="${prefix}-status" aria-live="polite"></p>
          <p class="${prefix}-error" role="alert" hidden></p>
          <ul class="${prefix}-preview" aria-label="将被过滤的帖子"></ul>
        </div>
        <footer class="${prefix}-footer">
          <button type="submit" value="cancel" class="${prefix}-button">取消</button>
          <button type="button" class="${prefix}-button ${prefix}-save">保存并应用</button>
        </footer>
      </form>
    `;

    const titleInput = element.querySelector(`.${prefix}-title-input`);
    const tagInput = element.querySelector(`.${prefix}-tag-input`);
    const categoryInput = element.querySelector(`.${prefix}-category-input`);
    const error = element.querySelector(`.${prefix}-error`);
    const save = element.querySelector(`.${prefix}-save`);
    for (const input of [titleInput, tagInput, categoryInput]) {
      input.addEventListener('input', renderPreview);
    }
    save.addEventListener('click', async () => {
      const nextFilters = {
        title: parseKeywords(titleInput.value),
        tag: parseKeywords(tagInput.value),
        category: parseKeywords(categoryInput.value),
      };
      try {
        await Promise.all([
          GM_setValue(storageKeys.title, nextFilters.title.join('\n')),
          GM_setValue(storageKeys.tag, nextFilters.tag.join('\n')),
          GM_setValue(storageKeys.category, nextFilters.category.join('\n')),
        ]);
        filters = nextFilters;
        filterAll();
        element.close();
      } catch {
        error.textContent = '保存失败，请稍后重试。';
        error.hidden = false;
      }
    });

    (document.body || document.documentElement).append(element);
    return element;
  };

  const openSettings = () => {
    dialog ||= createDialog();
    const titleInput = dialog.querySelector(`.${prefix}-title-input`);
    const tagInput = dialog.querySelector(`.${prefix}-tag-input`);
    const categoryInput = dialog.querySelector(`.${prefix}-category-input`);
    const error = dialog.querySelector(`.${prefix}-error`);
    titleInput.value = filters.title.join('\n');
    tagInput.value = filters.tag.join('\n');
    categoryInput.value = filters.category.join('\n');
    error.hidden = true;
    error.textContent = '';
    renderPreview();
    if (!dialog.open) dialog.showModal();
    titleInput.focus();
  };

  const observer = new MutationObserver((records) => {
    const rows = new Set();
    for (const record of records) {
      for (const node of record.addedNodes) {
        const ancestor = node.nodeType === 1
          ? node.closest?.(rowSelector)
          : node.parentElement?.closest?.(rowSelector);
        if (ancestor) rows.add(ancestor);
        for (const row of node.querySelectorAll?.(rowSelector) || []) rows.add(row);
      }
    }

    for (const row of rows) filterRow(row);
    if (rows.size && dialog?.open) renderPreview();
  });

  observer.observe(document, { childList: true, subtree: true });
  GM_registerMenuCommand('设置帖子过滤词', openSettings);
  filterAll();
}());
