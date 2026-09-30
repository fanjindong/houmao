// ==UserScript==
// @name         LINUX DO 帖子过滤器
// @namespace    https://github.com/fanjindong/houmao
// @version      0.5.0
// @description  按标题、标签和类别过滤帖子，查看过滤记录并放行单帖
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

  const categoryNames = (categoryId, categoriesById) => {
    const names = [];
    const seen = new Set();
    let category = categoriesById.get(String(categoryId));

    while (category && !seen.has(String(category.id))) {
      seen.add(String(category.id));
      if (typeof category.name === 'string' && category.name.trim()) names.unshift(category.name.trim());
      category = categoriesById.get(String(category.parent_category_id));
    }

    // 类别本身也可能有父类别，逐项匹配才能覆盖任意层级的名称。
    return names;
  };

  const topicDetails = (topic, rules, categoriesById) => {
    const title = typeof topic?.title === 'string' ? topic.title.trim() : '';
    if (!title) return { topic, title, href: '', matches: [] };

    const tags = Array.isArray(topic.tags)
      ? topic.tags.map((tag) => typeof tag === 'string' ? tag : tag?.name).filter(Boolean)
      : [];
    const categories = categoryNames(topic.category_id, categoriesById);
    const matches = rules.allowedTopicIds?.has(String(topic.id)) ? [] : [
      { label: '标题', keywords: matchingKeywords(title, rules.title || []) },
      { label: '标签', keywords: matchingExactKeywords(tags, rules.tag || []) },
      {
        label: '类别',
        keywords: matchingCategoryKeywords(categories, rules.category || []),
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

    const details = topics.map((topic) => topicDetails(topic, rules, categoriesById));
    payload.topic_list.topics = details.filter((entry) => !entry.matches.length).map((entry) => entry.topic);
    rememberTopics?.(topics, details);
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

  const listPageKey = (value, origin) => {
    const url = new URL(value, origin);
    let pathname = url.pathname.replace(/\.json$/, '').replace(/\/$/, '') || '/latest';
    // 列表接口包含 /l/latest、分页参数，地址栏则可能只有类别或标签的路径。
    const list = pathname.match(/^\/(tag|c)\/(.+?)(?:\/l\/([^/]+))?$/);
    if (list) {
      const [, kind, path, order = 'latest'] = list;
      pathname = `/${kind}/${path.split('/').pop()}/${order}`;
    }
    url.searchParams.delete('page');
    url.searchParams.sort();
    return `${pathname}${url.searchParams.size ? `?${url.searchParams}` : ''}`;
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      filterPreloadedData,
      filterTopicPayload,
      indexCategories,
      listPageKey,
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
    allowed: 'allowedTopics',
  };
  const prefix = 'houmao-linux-do-topic-filter';
  const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
  const categoriesById = new Map();
  const pages = new Map();
  const storedAllowed = GM_getValue(storageKeys.allowed, []);
  let allowedTopics = new Map((Array.isArray(storedAllowed) ? storedAllowed : [])
    .filter((topic) => topic && /^\d+$/.test(String(topic.id)) && typeof topic.title === 'string')
    .map((topic) => [String(topic.id), { id: String(topic.id), title: topic.title }]));
  let filters = {
    title: parseKeywords(GM_getValue(storageKeys.title, '')),
    tag: parseKeywords(GM_getValue(storageKeys.tag, '')),
    category: parseKeywords(GM_getValue(storageKeys.category, '')),
  };
  let drawer;
  let statusButton;
  let savingAllowed = false;
  let savingRules = false;
  let view = 'records';
  let previousView = 'records';
  let draft;
  let menuTrigger;
  const editors = new Map();

  const currentPage = () => listPageKey(
    `${pageWindow.location.pathname}${pageWindow.location.search}`, pageWindow.location.origin,
  );

  const pageData = () => pages.get(currentPage());
  const activeRules = () => ({ ...filters, allowedTopicIds: new Set(allowedTopics.keys()) });

  const rememberTopics = (key, details) => {
    let data = pages.get(key);
    if (!data) {
      data = { topics: new Map(), filtered: new Map() };
      pages.set(key, data);
    }
    for (const entry of details) {
      if (entry.topic?.id == null) continue;
      const id = String(entry.topic.id);
      data.topics.set(id, entry.topic);
      if (entry.matches.length) data.filtered.set(id, entry);
      else data.filtered.delete(id);
    }
    renderStatus();
  };

  const statusText = () => {
    const data = pageData();
    return data
      ? `本页已读取 ${data.topics.size} 条，已过滤 ${data.filtered.size} 条`
      : '本页尚未取得帖子数据';
  };

  const style = document.createElement('style');
  style.textContent = `
    .${prefix}-drawer {
      --hm-text: var(--primary, #243044);
      --hm-muted: var(--primary-medium, #6c7788);
      --hm-surface: var(--secondary, #fff);
      --hm-line: var(--primary-low, #e5e9f0);
      --hm-accent: var(--tertiary, #3265b3);
      --hm-soft: var(--primary-very-low, #f6f8fb);
      position: fixed;
      inset: 0 0 0 auto;
      box-sizing: border-box;
      width: min(560px, 100vw);
      height: 100vh;
      height: 100dvh;
      max-width: 100vw;
      max-height: 100vh;
      max-height: 100dvh;
      margin: 0;
      padding: 0;
      overflow: hidden;
      border: 0;
      border-left: 1px solid var(--hm-line);
      border-radius: 0;
      color: var(--hm-text);
      background: var(--hm-surface);
      box-shadow: -12px 0 48px #0f172a1a;
      font: 14px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      letter-spacing: normal;
    }
    .${prefix}-drawer::backdrop { background: #0f172a55; }
    .${prefix}-drawer *, .${prefix}-launcher { box-sizing: border-box; }
    .${prefix}-drawer [hidden] { display: none !important; }
    .${prefix}-shell { display: flex; flex-direction: column; height: 100%; }
    .${prefix}-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 20px 24px 12px;
      flex: 0 0 auto;
    }
    .${prefix}-header h2 { flex: 1; margin: 0; font-size: 19px; font-weight: 650; line-height: 1.5; }
    .${prefix}-drawer button { font: inherit; cursor: pointer; }
    .${prefix}-drawer button:disabled { opacity: .55; cursor: default; }
    .${prefix}-icon { width: 18px; height: 18px; flex: 0 0 auto; vertical-align: middle; }
    .${prefix}-icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 8px;
      border: 0;
      border-radius: 7px;
      color: var(--hm-muted);
      background: transparent;
    }
    .${prefix}-icon-button:hover { color: var(--hm-text); background: var(--hm-soft); }
    .${prefix}-tabs {
      display: flex;
      gap: 24px;
      padding: 0 24px;
      border-bottom: 1px solid var(--hm-line);
      flex: 0 0 auto;
    }
    .${prefix}-tab {
      padding: 12px 0;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--hm-muted);
    }
    .${prefix}-tab[aria-selected='true'] { color: var(--hm-accent); border-bottom-color: var(--hm-accent); font-weight: 600; }
    .${prefix}-content { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 20px 24px 24px; }
    .${prefix}-actual-status, .${prefix}-hint { margin: 0; font-size: 13px; color: var(--hm-muted); }
    .${prefix}-actual-status { margin-bottom: 16px; }
    .${prefix}-topic-list { list-style: none; margin: 0; padding: 0; }
    .${prefix}-topic-list li { position: relative; border-bottom: 1px solid var(--hm-line); padding: 16px 0; }
    .${prefix}-topic-heading { display: flex; align-items: flex-start; gap: 8px; }
    .${prefix}-topic-link { flex: 1; min-width: 0; color: var(--hm-text); text-decoration: none; font-size: 15px; font-weight: 550; overflow-wrap: anywhere; }
    .${prefix}-topic-link:hover { color: var(--hm-accent); }
    .${prefix}-topic-menu { flex: 0 0 auto; margin: -5px -6px -5px 0; }
    .${prefix}-match { display: block; margin-top: 5px; color: var(--hm-muted); font-size: 12px; overflow-wrap: anywhere; }
    .${prefix}-kept { flex: 0 0 auto; font-size: 12px; color: var(--hm-muted); padding-top: 2px; }
    .${prefix}-records-edit { margin-top: 24px; }
    .${prefix}-text-button { padding: 0; border: 0; background: transparent; color: var(--hm-accent); }
    .${prefix}-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 60px 8px; }
    .${prefix}-empty > .${prefix}-icon { width: 36px; height: 36px; margin-bottom: 16px; color: var(--hm-muted); stroke-width: 1.4; }
    .${prefix}-empty strong { font-size: 15px; font-weight: 550; }
    .${prefix}-empty p { margin: 8px 0 20px; max-width: 320px; color: var(--hm-muted); font-size: 13px; }
    .${prefix}-rule-group { margin-bottom: 16px; padding: 14px; border: 1px solid var(--hm-line); border-radius: 9px; }
    .${prefix}-rule-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 10px; }
    .${prefix}-rule-heading label { font-weight: 600; }
    .${prefix}-rule-heading span { color: var(--hm-muted); font-size: 12px; }
    .${prefix}-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .${prefix}-chips:not(:empty) { margin-bottom: 10px; }
    .${prefix}-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 4px 3px 9px; background: var(--hm-soft); border: 1px solid var(--hm-line); border-radius: 6px; font-size: 13px; }
    .${prefix}-chip-label { overflow-wrap: anywhere; min-width: 0; }
    .${prefix}-chip-remove { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 24px; height: 24px; border: 0; border-radius: 4px; background: transparent; color: var(--hm-muted); }
    .${prefix}-chip-remove .${prefix}-icon { width: 13px; height: 13px; }
    .${prefix}-chip-remove:hover { background: var(--hm-line); color: var(--hm-text); }
    .${prefix}-input-row { display: flex; gap: 8px; }
    .${prefix}-drawer .${prefix}-input { flex: 1; min-width: 0; width: 100%; height: 36px; padding: 7px 10px; border: 1px solid var(--hm-line); border-radius: 6px; background: var(--hm-surface); color: var(--hm-text); font: inherit; font-size: 13px; }
    .${prefix}-drawer .${prefix}-input::placeholder { color: var(--hm-muted); opacity: .85; }
    .${prefix}-add { flex: 0 0 auto; padding: 0 11px; border: 0; border-radius: 6px; background: var(--hm-soft); color: var(--hm-muted); }
    .${prefix}-preview-section { margin-top: 24px; }
    .${prefix}-preview-heading { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .${prefix}-preview-heading h3 { margin: 0; font-size: 14px; font-weight: 600; }
    .${prefix}-status { margin: 0; font-size: 12px; color: var(--hm-muted); }
    .${prefix}-preview-hint { margin-top: 8px; }
    .${prefix}-preview li { padding: 12px 0; }
    .${prefix}-preview .${prefix}-topic-link { font-size: 13px; font-weight: 500; }
    .${prefix}-footer { flex: 0 0 auto; padding: 14px 24px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--hm-line); background: var(--hm-surface); }
    .${prefix}-save-row { display: flex; justify-content: flex-end; gap: 10px; align-items: center; }
    .${prefix}-save-row .${prefix}-hint { flex: 1; font-size: 12px; }
    .${prefix}-button { min-height: 36px; padding: 7px 15px; border: 1px solid var(--hm-line); border-radius: 6px; background: var(--hm-surface); color: var(--hm-text); white-space: nowrap; }
    .${prefix}-save-refresh { border-color: var(--hm-accent); background: var(--hm-accent); color: var(--hm-surface); }
    .${prefix}-error { margin: 0 0 12px; padding: 10px 12px; border-radius: 6px; font-size: 13px; background: var(--danger-low, #fff0f0); color: var(--danger, #be3030); }
    .${prefix}-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; margin: 0 24px 20px; border-radius: 8px; background: #243044; color: #fff; font-size: 13px; }
    .${prefix}-notice .${prefix}-text-button { color: #9cc4ff; white-space: nowrap; }
    .${prefix}-menu {
      position: fixed; inset: auto; margin: 0; width: 208px; max-width: calc(100vw - 24px);
      padding: 5px; border: 1px solid var(--hm-line); border-radius: 9px;
      background: var(--hm-surface); color: var(--hm-text); box-shadow: 0 8px 30px #0f172a24;
    }
    .${prefix}-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 0; border-radius: 5px; text-align: left; background: transparent; color: var(--hm-text); text-decoration: none; font: inherit; font-size: 13px; }
    .${prefix}-menu-item:hover, .${prefix}-menu-item:focus-visible { background: var(--hm-soft); }
    .${prefix}-drawer :is(button, input, a):focus-visible, .${prefix}-launcher:focus-visible { outline: 2px solid var(--hm-accent, #3265b3); outline-offset: 2px; }
    .${prefix}-launcher {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 34px; padding: 6px 11px; margin-right: 8px; border: 1px solid var(--primary-low-mid, #dbe3ee);
      border-radius: 6px; background: var(--secondary, #fff); color: var(--tertiary, #3265b3);
      font: inherit; font-size: 14px; white-space: nowrap; cursor: pointer;
    }
    @media (max-width: 600px) {
      .${prefix}-drawer { width: 100vw; border: 0; }
      .${prefix}-header { padding: max(12px, env(safe-area-inset-top)) 16px 8px; }
      .${prefix}-tabs { gap: 0; padding: 0 16px; }
      .${prefix}-tab { flex: 1; min-height: 44px; }
      .${prefix}-content { padding: 20px 16px; }
      .${prefix}-footer { padding: 12px 16px max(16px, env(safe-area-inset-bottom)); }
      .${prefix}-save-row { flex-wrap: wrap; }
      .${prefix}-save-row .${prefix}-hint { flex-basis: 100%; }
      .${prefix}-button, .${prefix}-input, .${prefix}-icon-button { min-height: 44px; }
      .${prefix}-icon-button { width: 44px; }
      .${prefix}-drawer .${prefix}-input { font-size: 16px; }
      .${prefix}-notice { margin: 0 16px 16px; }
      .${prefix}-menu-item { min-height: 44px; }
      .${prefix}-chip-remove { width: 30px; height: 30px; }
    }
  `;
  document.documentElement.append(style);

  const icon = (name) => {
    const paths = {
      filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
      close: '<path d="m6 6 12 12M6 18 18 6"/>',
      back: '<path d="m14 6-6 6 6 6"/>',
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      file: '<path d="M7 3h7l4 4v14H6V3zM14 3v5h4M9 12h6M9 16h6"/>',
    };
    return `<svg class="${prefix}-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  };
  const control = (name) => drawer.querySelector(`.${prefix}-${name}`);
  const busy = () => savingRules || savingAllowed;

  const closeMenu = () => {
    if (control('menu').matches(':popover-open')) control('menu').hidePopover();
    menuTrigger?.setAttribute('aria-expanded', 'false');
  };

  const openMenu = (trigger, items) => {
    const menu = control('menu');
    closeMenu();
    menuTrigger = trigger;
    menu.replaceChildren();
    for (const { label, href, action, disabled = false } of items) {
      const item = document.createElement(href ? 'a' : 'button');
      item.className = `${prefix}-menu-item`;
      item.textContent = label;
      item.setAttribute('role', 'menuitem');
      if (href) {
        item.href = href;
        item.target = '_blank';
        item.rel = 'noopener noreferrer';
      } else {
        item.type = 'button';
        item.disabled = disabled;
      }
      item.addEventListener('click', () => {
        closeMenu();
        return action?.();
      });
      menu.append(item);
    }
    trigger.setAttribute('aria-expanded', 'true');
    menu.showPopover();
    const anchor = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, pageWindow.innerWidth - bounds.width - 12))}px`;
    menu.style.top = `${Math.max(12, anchor.bottom + bounds.height + 6 > pageWindow.innerHeight ? anchor.top - bounds.height - 6 : anchor.bottom + 6)}px`;
    menu.querySelector('.' + prefix + '-menu-item:not(:disabled)')?.focus();
  };

  const topicItem = ({ href, title, matches = [], topic }, actions = false, retained = false) => {
    const item = document.createElement('li');
    const heading = document.createElement('div');
    heading.className = `${prefix}-topic-heading`;
    const link = document.createElement('a');
    link.className = `${prefix}-topic-link`;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = title;
    heading.append(link);
    const allowed = topic && allowedTopics.has(String(topic.id));
    if (allowed) {
      const state = document.createElement('span');
      state.className = `${prefix}-kept`;
      state.textContent = '已保留';
      heading.append(state);
    }
    if (actions) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = `${prefix}-icon-button ${prefix}-topic-menu`;
      more.innerHTML = icon('more');
      more.setAttribute('aria-label', `更多操作：${title}`);
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      more.disabled = busy();
      more.addEventListener('click', () => openMenu(more, [
        { label: '打开帖子', href },
        {
          label: retained ? '取消保留' : allowed ? '已保留此帖' : '始终保留此帖',
          disabled: !retained && allowed,
          action: () => changeAllowedTopic(topic, !retained),
        },
      ]));
      heading.append(more);
    }
    item.append(heading);
    if (matches.length || retained) {
      const match = document.createElement('span');
      match.className = `${prefix}-match`;
      match.textContent = retained ? '始终保留' : matches.map(({ label, keywords }) =>
        label === '标题' ? `标题包含「${keywords.join('、')}」` : `${label}：${keywords.join('、')}`,
      ).join('；');
      item.append(match);
    }
    return item;
  };

  const showNotice = (message, refresh = false) => {
    control('notice-text').textContent = message;
    control('notice-refresh').hidden = !refresh;
    control('notice').hidden = false;
  };

  const renderRecords = () => {
    const data = pageData();
    control('actual-status').textContent = statusText();
    const fragment = document.createDocumentFragment();
    for (const details of data?.filtered.values() || []) fragment.append(topicItem(details, true));
    control('actual-list').replaceChildren(fragment);
    control('records-empty').hidden = !!data?.filtered.size;
    control('empty-title').textContent = data ? '这一页没有命中规则' : '本页尚未取得帖子数据';
    control('empty-hint').textContent = data ? '后续加载的帖子会继续检查' : '浏览帖子列表后，可在这里查看过滤记录';
    control('empty-settings').textContent = data ? '调整规则' : '设置规则';
    control('records-edit').hidden = !data?.filtered.size;
  };

  const renderRetained = () => {
    const fragment = document.createDocumentFragment();
    for (const topic of allowedTopics.values()) {
      fragment.append(topicItem({ title: topic.title, href: `/t/${topic.id}`, topic }, true, true));
    }
    control('retained-list').replaceChildren(fragment);
    control('retained-empty').hidden = allowedTopics.size > 0;
  };

  const draftRules = () => ({
    ...Object.fromEntries([...editors].map(([key, editor]) => [key,
      parseKeywords([...draft[key], editor.input.value].join('\n')),
    ])),
    allowedTopicIds: new Set(allowedTopics.keys()),
  });

  const renderPreview = () => {
    const rules = draftRules();
    const data = pageData();
    const matches = [...(data?.topics.values() || [])]
      .map((topic) => topicDetails(topic, rules, categoriesById)).filter((entry) => entry.matches.length);
    control('status').textContent = data ? `预计过滤 ${matches.length} 条` : '尚无帖子数据';
    const hasRules = ['title', 'category', 'tag'].some((key) => rules[key].length);
    const hint = !hasRules ? '添加规则后查看命中结果' : !data ? '浏览帖子列表后，可预览命中结果' : !matches.length ? '当前已读取的帖子均未命中草稿规则' : '';
    control('preview-hint').textContent = hint;
    control('preview-hint').hidden = !hint;
    const fragment = document.createDocumentFragment();
    for (const details of matches) fragment.append(topicItem(details));
    control('preview').replaceChildren(fragment);
  };

  const renderChips = (key) => {
    const editor = editors.get(key);
    const fragment = document.createDocumentFragment();
    for (const keyword of draft[key]) {
      const chip = document.createElement('span');
      chip.className = `${prefix}-chip`;
      const label = document.createElement('span');
      label.className = `${prefix}-chip-label`;
      label.textContent = keyword;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = `${prefix}-chip-remove`;
      remove.innerHTML = icon('close');
      remove.setAttribute('aria-label', `移除${editor.label}：${keyword}`);
      remove.disabled = savingRules;
      remove.addEventListener('click', () => {
        draft[key] = draft[key].filter((value) => value !== keyword);
        renderChips(key);
        renderPreview();
        editor.input.focus();
      });
      chip.append(label, remove);
      fragment.append(chip);
    }
    editor.chips.replaceChildren(fragment);
    editor.input.disabled = editor.add.disabled = savingRules;
  };

  const commitInput = (key) => {
    const editor = editors.get(key);
    draft[key] = parseKeywords([...draft[key], editor.input.value].join('\n'));
    editor.input.value = '';
    renderChips(key);
    renderPreview();
  };

  const renderStatus = () => {
    if (statusButton) {
      const label = pageData() ? `过滤 ${pageData().filtered.size}` : '过滤';
      const count = statusButton.querySelector(`.${prefix}-launcher-label`);
      if (count.textContent !== label) count.textContent = label;
      statusButton.title = statusText();
      statusButton.setAttribute('aria-label', `${statusText()}，打开帖子过滤器`);
    }
    if (!drawer?.open) return;
    if (view === 'records') renderRecords();
    if (view === 'rules') renderPreview();
    if (view === 'retained') renderRetained();
  };

  const selectView = (next) => {
    closeMenu();
    if (next === 'retained' && view !== 'retained') previousView = view;
    view = next;
    for (const name of ['records', 'rules', 'retained']) control(`${name}-panel`).hidden = name !== view;
    for (const name of ['records', 'rules']) {
      control(`${name}-tab`).setAttribute('aria-selected', String(name === view));
      control(`${name}-tab`).tabIndex = name === view ? 0 : -1;
    }
    control('heading').textContent = view === 'retained' ? '保留清单' : '帖子过滤';
    control('back').hidden = view !== 'retained';
    control('tabs').hidden = view === 'retained';
    control('header-menu').hidden = view === 'retained';
    control('footer').hidden = view !== 'rules';
    control('content').scrollTop = 0;
    renderStatus();
  };

  const changeAllowedTopic = async (topic, allow) => {
    if (busy()) return;
    savingAllowed = true;
    control('action-error').hidden = true;
    const next = new Map(allowedTopics);
    const id = String(topic.id);
    if (allow) next.set(id, { id, title: topic.title });
    else next.delete(id);
    renderStatus();
    try {
      await GM_setValue(storageKeys.allowed, [...next.values()]);
      allowedTopics = next;
      showNotice(allow ? '已保留此帖，刷新后生效' : '已取消保留，刷新后生效', true);
    } catch {
      control('action-error').textContent = '保存失败，请重试。原有保留设置仍然有效。';
      control('action-error').hidden = false;
    } finally {
      savingAllowed = false;
      renderStatus();
    }
  };

  const saveSettings = async (refresh) => {
    if (busy()) return;
    for (const key of editors.keys()) commitInput(key);
    const next = Object.fromEntries(['title', 'category', 'tag'].map((key) => [key, [...draft[key]]]));
    savingRules = true;
    control('rules-error').hidden = true;
    control('save').disabled = control('save-refresh').disabled = control('close').disabled = true;
    for (const key of editors.keys()) renderChips(key);
    try {
      await Promise.all(['title', 'category', 'tag'].map((key) => GM_setValue(storageKeys[key], next[key].join('\n'))));
      filters = next;
      if (refresh) pageWindow.location.reload();
      else showNotice('已保存，将用于后续加载');
    } catch {
      control('rules-error').textContent = '保存失败，请重试。输入的规则已保留。';
      control('rules-error').hidden = false;
    } finally {
      savingRules = false;
      control('save').disabled = control('save-refresh').disabled = control('close').disabled = false;
      for (const key of editors.keys()) renderChips(key);
    }
  };

  const createDrawer = () => {
    const element = document.createElement('dialog');
    element.className = `${prefix}-drawer`;
    element.setAttribute('aria-labelledby', `${prefix}-heading`);
    element.innerHTML = `
      <div class="${prefix}-shell">
        <header class="${prefix}-header">
          <button type="button" class="${prefix}-icon-button ${prefix}-back" aria-label="返回" hidden>${icon('back')}</button>
          <h2 id="${prefix}-heading" class="${prefix}-heading">帖子过滤</h2>
          <button type="button" class="${prefix}-icon-button ${prefix}-header-menu" aria-label="更多设置" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>
          <button type="button" class="${prefix}-icon-button ${prefix}-close" aria-label="关闭">${icon('close')}</button>
        </header>
        <nav class="${prefix}-tabs" role="tablist" aria-label="帖子过滤">
          <button type="button" id="${prefix}-records-tab" class="${prefix}-tab ${prefix}-records-tab" role="tab" aria-selected="true" aria-controls="${prefix}-records-panel">过滤记录</button>
          <button type="button" id="${prefix}-rules-tab" class="${prefix}-tab ${prefix}-rules-tab" role="tab" aria-selected="false" aria-controls="${prefix}-rules-panel" tabindex="-1">规则设置</button>
        </nav>
        <div class="${prefix}-content">
          <p class="${prefix}-error ${prefix}-action-error" role="alert" hidden></p>
          <section id="${prefix}-records-panel" class="${prefix}-records-panel" role="tabpanel" aria-labelledby="${prefix}-records-tab">
            <p class="${prefix}-actual-status" aria-live="polite"></p>
            <ul class="${prefix}-topic-list ${prefix}-actual-list" aria-label="实际过滤的帖子"></ul>
            <div class="${prefix}-empty ${prefix}-records-empty">
              ${icon('filter')}<strong class="${prefix}-empty-title"></strong><p class="${prefix}-empty-hint"></p>
              <button type="button" class="${prefix}-button ${prefix}-empty-settings">设置规则</button>
            </div>
            <button type="button" class="${prefix}-text-button ${prefix}-records-edit">编辑过滤规则</button>
          </section>
          <section id="${prefix}-rules-panel" class="${prefix}-rules-panel" role="tabpanel" aria-labelledby="${prefix}-rules-tab" hidden>
            <div class="${prefix}-editors"></div>
            <section class="${prefix}-preview-section" aria-label="草稿预览">
              <div class="${prefix}-preview-heading"><h3>草稿预览</h3><p class="${prefix}-status" aria-live="polite"></p></div>
              <p class="${prefix}-hint ${prefix}-preview-hint"></p>
              <ul class="${prefix}-topic-list ${prefix}-preview" aria-label="草稿预计过滤的帖子"></ul>
            </section>
          </section>
          <section class="${prefix}-retained-panel" aria-label="保留清单" hidden>
            <p class="${prefix}-hint">这些帖子优先于过滤规则显示</p>
            <ul class="${prefix}-topic-list ${prefix}-retained-list" aria-label="始终保留的帖子"></ul>
            <div class="${prefix}-empty ${prefix}-retained-empty">${icon('file')}<strong>还没有保留的帖子</strong><p>可从过滤记录的更多菜单中添加</p></div>
          </section>
        </div>
        <div class="${prefix}-notice" role="status" hidden><span class="${prefix}-notice-text"></span><button type="button" class="${prefix}-text-button ${prefix}-notice-refresh">刷新</button></div>
        <footer class="${prefix}-footer" hidden>
          <p class="${prefix}-error ${prefix}-rules-error" role="alert" hidden></p>
          <div class="${prefix}-save-row"><p class="${prefix}-hint">保存用于后续加载<br>刷新应用到当前列表</p><button type="button" class="${prefix}-button ${prefix}-save">保存</button><button type="button" class="${prefix}-button ${prefix}-save-refresh">保存并刷新</button></div>
        </footer>
        <div class="${prefix}-menu" popover="auto" role="menu" aria-label="更多操作"></div>
      </div>`;
    (document.body || document.documentElement).append(element);
    return element;
  };

  const initializeDrawer = () => {
    drawer = createDrawer();
    for (const [key, label, hint] of [
      ['title', '标题关键词', '包含任意关键词'],
      ['category', '类别', '包含子类别'],
      ['tag', '标签', '完整名称匹配'],
    ]) {
      const group = document.createElement('section');
      group.className = `${prefix}-rule-group`;
      group.innerHTML = `<div class="${prefix}-rule-heading"><label for="${prefix}-${key}-input">${label}</label><span>${hint}</span></div>`;
      const chips = document.createElement('div');
      chips.className = `${prefix}-chips ${prefix}-${key}-chips`;
      const row = document.createElement('div');
      row.className = `${prefix}-input-row`;
      const input = document.createElement('input');
      input.type = 'text';
      input.id = `${prefix}-${key}-input`;
      input.className = `${prefix}-input ${prefix}-${key}-input`;
      input.placeholder = '输入后回车添加';
      input.autocomplete = 'off';
      const add = document.createElement('button');
      add.type = 'button';
      add.className = `${prefix}-add ${prefix}-${key}-add`;
      add.textContent = '添加';
      add.setAttribute('aria-label', `添加${label}`);
      editors.set(key, { input, chips, add, label });
      input.addEventListener('input', renderPreview);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          commitInput(key);
        }
      });
      input.addEventListener('paste', (event) => {
        const text = event.clipboardData.getData('text');
        if (!/[\r\n]/.test(text)) return;
        event.preventDefault();
        input.value = input.value.slice(0, input.selectionStart) + text + input.value.slice(input.selectionEnd);
        commitInput(key);
      });
      add.addEventListener('click', () => { commitInput(key); input.focus(); });
      row.append(input, add);
      group.append(chips, row);
      control('editors').append(group);
    }
    for (const name of ['records', 'rules']) {
      control(`${name}-tab`).addEventListener('click', () => selectView(name));
      control(`${name}-tab`).addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'records' : event.key === 'End' ? 'rules' : name === 'records' ? 'rules' : 'records';
        selectView(next);
        control(`${next}-tab`).focus();
      });
    }
    for (const name of ['records-edit', 'empty-settings']) control(name).addEventListener('click', () => { selectView('rules'); control('rules-tab').focus(); });
    control('back').addEventListener('click', () => { selectView(previousView); control(`${previousView}-tab`).focus(); });
    control('header-menu').addEventListener('click', () => openMenu(control('header-menu'), [
      { label: '保留清单', action: () => { selectView('retained'); control('back').focus(); } },
    ]));
    control('close').addEventListener('click', () => { if (!busy()) drawer.close(); });
    drawer.addEventListener('cancel', (event) => { if (busy()) event.preventDefault(); });
    drawer.addEventListener('close', () => { closeMenu(); draft = undefined; });
    drawer.addEventListener('click', (event) => { if (event.target === drawer && !busy()) drawer.close(); });
    control('notice-refresh').addEventListener('click', () => { if (!busy()) pageWindow.location.reload(); });
    control('save').addEventListener('click', () => saveSettings(false));
    control('save-refresh').addEventListener('click', () => saveSettings(true));
    control('menu').addEventListener('toggle', (event) => {
      if (event.newState === 'closed') menuTrigger?.setAttribute('aria-expanded', 'false');
    });
    control('menu').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); menuTrigger?.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...control('menu').querySelectorAll(`.${prefix}-menu-item:not(:disabled)`)];
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    });
  };

  const openDrawer = (next = 'records') => {
    if (!drawer) initializeDrawer();
    if (!drawer.open) {
      draft = Object.fromEntries(['title', 'category', 'tag'].map((key) => [key, [...filters[key]]]));
      for (const [key, editor] of editors) { editor.input.value = ''; renderChips(key); }
      control('rules-error').hidden = control('action-error').hidden = control('notice').hidden = true;
      drawer.showModal();
    }
    selectView(next);
    control(`${next}-tab`).focus();
  };
  const openSettings = () => openDrawer('rules');

  const mountStatus = () => {
    if (statusButton?.isConnected) return;
    const toolbar = document.querySelector('.navigation-controls');
    if (!toolbar) return;
    if (!statusButton) {
      statusButton = document.createElement('button');
      statusButton.type = 'button';
      statusButton.className = `${prefix}-launcher`;
      statusButton.innerHTML = `${icon('filter')}<span class="${prefix}-launcher-label">过滤</span>`;
      statusButton.setAttribute('aria-haspopup', 'dialog');
      statusButton.addEventListener('click', () => openDrawer());
    }
    toolbar.prepend(statusButton);
    renderStatus();
  };

  const installXhrFilter = () => {
    const originalOpen = pageWindow.XMLHttpRequest?.prototype.open;
    if (typeof originalOpen !== 'function') return;
    const processed = new WeakSet();

    pageWindow.XMLHttpRequest.prototype.open = function (...args) {
      const result = originalOpen.apply(this, args);
      const key = listPageKey(args[1], pageWindow.location.origin);
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4 || processed.has(this)) return;
        processed.add(this);

        try {
          const batches = [];
          const collect = (_topics, details) => batches.push(details);
          if (this.responseType === 'json') {
            filterTopicPayload(this.response, activeRules(), categoriesById, collect);
          } else if (!this.responseType || this.responseType === 'text') {
            const payload = JSON.parse(this.responseText);
            if (filterTopicPayload(payload, activeRules(), categoriesById, collect)) {
              Object.defineProperty(this, 'responseText', {
                configurable: true,
                value: JSON.stringify(payload),
              });
            }
          }
          // 响应成功改写后才记录数量，避免将未能交给页面的结果算作已过滤。
          for (const details of batches) rememberTopics(key, details);
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
        const batches = [];
        element.textContent = filterPreloadedData(
          element.textContent,
          activeRules(),
          categoriesById,
          (_topics, details) => batches.push(details),
        );
        for (const details of batches) rememberTopics(currentPage(), details);
        return true;
      } catch {
        // 预载节点可能早于完整 JSON 到达，解析成功后才可停止监听。
        return false;
      }
    };

    if (process()) return;
    const observer = new MutationObserver(() => {
      if (process()) observer.disconnect();
    });
    observer.observe(document, { childList: true, characterData: true, subtree: true });
  };

  installXhrFilter();
  installPreloadedFilter();
  mountStatus();
  // Discourse 切页时会重建工具栏；只挂载入口，不遍历或改动帖子行。
  const toolbarObserver = new MutationObserver(mountStatus);
  toolbarObserver.observe(document, { childList: true, subtree: true });
  // SPA 的地址可能晚于接口响应更新，按列表地址存放记录，切页时只切换展示。
  for (const method of ['pushState', 'replaceState']) {
    const original = pageWindow.history[method];
    pageWindow.history[method] = function (...args) {
      const result = original.apply(this, args);
      renderStatus();
      return result;
    };
  }
  pageWindow.addEventListener('popstate', renderStatus);
  GM_registerMenuCommand('设置帖子过滤词', openSettings);
}());
