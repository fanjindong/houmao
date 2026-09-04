// ==UserScript==
// @name         LINUX DO 帖子过滤器
// @namespace    https://github.com/fanjindong/houmao
// @version      0.3.0
// @description  按标题、标签和类别过滤 linux.do 帖子，并在应用前预览
// @match        https://linux.do/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
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
    const normalizedValues = new Set(
      values.filter((value) => typeof value === 'string').map((value) => value.toLowerCase()),
    );
    return keywords.filter((keyword) => normalizedValues.has(keyword.toLowerCase()));
  };

  const matchingCategoryKeywords = (values, keywords) => {
    const normalizedValues = values
      .filter((value) => typeof value === 'string')
      .map((value) => value.toLowerCase());
    return keywords.filter((keyword) => {
      const normalizedKeyword = keyword.toLowerCase();
      return normalizedValues.some(
        (value) => value === normalizedKeyword || value.startsWith(`${normalizedKeyword},`),
      );
    });
  };

  const indexCategories = (categories, categoriesById) => {
    if (!Array.isArray(categories)) return;
    for (const category of categories) {
      if (category?.id != null && typeof category.name === 'string') {
        categoriesById.set(String(category.id), category);
      }
    }
  };

  const indexPayloadCategories = (payload, categoriesById) => {
    indexCategories(payload?.categories, categoriesById);
    indexCategories(payload?.category_list?.categories, categoriesById);
    indexCategories(payload?.topic_list?.categories, categoriesById);
  };

  const categoryPath = (categoryId, categoriesById) => {
    const names = [];
    const seen = new Set();
    let category = categoriesById.get(String(categoryId));

    while (category && !seen.has(String(category.id))) {
      seen.add(String(category.id));
      if (typeof category.name === 'string' && category.name.trim()) names.unshift(category.name.trim());
      category = categoriesById.get(String(category.parent_category_id));
    }

    return names.join(', ');
  };

  const topicDetails = (topic, rules, categoriesById) => {
    const title = typeof topic?.title === 'string' ? topic.title.trim() : '';
    if (!title) return { topic, title, href: '', matches: [] };

    const tags = Array.isArray(topic.tags)
      ? topic.tags.map((tag) => typeof tag === 'string' ? tag : tag?.name).filter(Boolean)
      : [];
    const category = categoryPath(topic.category_id, categoriesById);
    const matches = [
      { label: '标题', keywords: matchingKeywords(title, rules.title || []) },
      { label: '标签', keywords: matchingExactKeywords(tags, rules.tag || []) },
      {
        label: '类别',
        keywords: matchingCategoryKeywords(category ? [category] : [], rules.category || []),
      },
    ].filter((match) => match.keywords.length);
    const href = topic.id == null
      ? ''
      : topic.slug
        ? `/t/${topic.slug}/${topic.id}`
        : `/t/${topic.id}`;
    return { topic, title, href, matches };
  };

  const filterTopicPayload = (payload, rules, categoriesById, rememberTopics) => {
    if (!payload || typeof payload !== 'object') return false;
    indexPayloadCategories(payload, categoriesById);
    const topics = payload.topic_list?.topics;
    if (!Array.isArray(topics)) return false;

    rememberTopics?.(topics);
    payload.topic_list.topics = topics.filter(
      (topic) => topicDetails(topic, rules, categoriesById).matches.length === 0,
    );
    return true;
  };

  const filterPreloadedData = (source, rules, categoriesById, rememberTopics) => {
    const preloaded = JSON.parse(source);
    const entries = [];

    for (const [key, serialized] of Object.entries(preloaded)) {
      try {
        const payload = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
        entries.push({ key, payload, serialized: typeof serialized === 'string' });
        indexPayloadCategories(payload, categoriesById);
      } catch {}
    }

    for (const entry of entries) {
      if (filterTopicPayload(entry.payload, rules, categoriesById, rememberTopics)) {
        preloaded[entry.key] = entry.serialized ? JSON.stringify(entry.payload) : entry.payload;
      }
    }

    return JSON.stringify(preloaded);
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      filterPreloadedData,
      filterTopicPayload,
      indexCategories,
      matchingCategoryKeywords,
      matchingExactKeywords,
      matchingKeywords,
      parseKeywords,
      topicDetails,
    };
  }
  if (typeof document === 'undefined') return;

  const storageKeys = {
    title: 'keywords',
    tag: 'tagKeywords',
    category: 'categoryKeywords',
  };
  const prefix = 'houmao-linux-do-topic-filter';
  const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
  const categoriesById = new Map();
  const topicsById = new Map();
  let filters = {
    title: parseKeywords(GM_getValue(storageKeys.title, '')),
    tag: parseKeywords(GM_getValue(storageKeys.tag, '')),
    category: parseKeywords(GM_getValue(storageKeys.category, '')),
  };
  let cachePage;
  let dialog;

  const currentPage = () => `${pageWindow.location.pathname}${pageWindow.location.search}`;

  const syncTopicCache = () => {
    const page = currentPage();
    if (page !== cachePage) {
      topicsById.clear();
      cachePage = page;
    }
  };

  const rememberTopics = (topics) => {
    syncTopicCache();
    for (const topic of topics) {
      if (topic?.id != null) topicsById.set(String(topic.id), topic);
    }
    if (dialog?.open) renderPreview();
  };

  const style = document.createElement('style');
  style.textContent = `
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

  const renderPreview = () => {
    syncTopicCache();
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
    const matchedTopics = [...topicsById.values()]
      .map((topic) => topicDetails(topic, draft, categoriesById))
      .filter((details) => details.matches.length);

    status.textContent = `当前已加载数据将过滤 ${matchedTopics.length} 个帖子`;
    const fragment = document.createDocumentFragment();
    for (const { href, title, matches } of matchedTopics) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const match = document.createElement('span');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = title;
      match.className = `${prefix}-match`;
      match.textContent = matches
        .map(({ label, keywords }) => `${label}：${keywords.join('、')}`)
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
          <label class="${prefix}-label" for="${prefix}-category-input">类别名称（每行一个）</label>
          <textarea id="${prefix}-category-input" class="${prefix}-input ${prefix}-category-input"></textarea>
          <label class="${prefix}-label" for="${prefix}-tag-input">标签名称（每行一个）</label>
          <textarea id="${prefix}-tag-input" class="${prefix}-input ${prefix}-tag-input"></textarea>
          <p class="${prefix}-status" aria-live="polite"></p>
          <p class="${prefix}-error" role="alert" hidden></p>
          <ul class="${prefix}-preview" aria-label="将被过滤的帖子"></ul>
        </div>
        <footer class="${prefix}-footer">
          <button type="submit" value="cancel" class="${prefix}-button">取消</button>
          <button type="button" class="${prefix}-button ${prefix}-save">保存</button>
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

  const installXhrFilter = () => {
    const originalOpen = pageWindow.XMLHttpRequest?.prototype.open;
    if (typeof originalOpen !== 'function') return;
    const processed = new WeakSet();

    pageWindow.XMLHttpRequest.prototype.open = function (...args) {
      const result = originalOpen.apply(this, args);
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4 || processed.has(this)) return;
        processed.add(this);

        try {
          if (this.responseType === 'json') {
            filterTopicPayload(this.response, filters, categoriesById, rememberTopics);
          } else if (!this.responseType || this.responseType === 'text') {
            const payload = JSON.parse(this.responseText);
            if (filterTopicPayload(payload, filters, categoriesById, rememberTopics)) {
              Object.defineProperty(this, 'responseText', {
                configurable: true,
                value: JSON.stringify(payload),
              });
            }
          }
        } catch {}
      }, true);
      return result;
    };
  };

  const installPreloadedFilter = () => {
    const process = () => {
      const element = document.getElementById('data-preloaded');
      if (!element) return false;
      try {
        element.textContent = filterPreloadedData(
          element.textContent,
          filters,
          categoriesById,
          rememberTopics,
        );
      } catch {}
      return true;
    };

    if (process()) return;
    const observer = new MutationObserver(() => {
      if (process()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  };

  installXhrFilter();
  installPreloadedFilter();
  GM_registerMenuCommand('设置帖子过滤词', openSettings);
}());
