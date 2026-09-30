const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.resolve(__dirname, '../scripts/linux-do-topic-filter.user.js');

test('过滤词按行清理，并按标题、标签和类别的既定规则匹配', () => {
  const {
    matchingCategoryKeywords,
    matchingExactKeywords,
    matchingKeywords,
    parseKeywords,
  } = require(scriptPath);

  assert.deepEqual(parseKeywords(' AI \n\n抽奖\nai\nAI 助手 '), ['AI', '抽奖', 'AI 助手']);
  assert.deepEqual(parseKeywords(null), []);
  assert.deepEqual(matchingKeywords('OpenAI 抽奖活动', ['ai', '抽奖', '教程']), ['ai', '抽奖']);
  assert.deepEqual(
    matchingExactKeywords(['人工智能', '开发调优'], ['人工智能', '人工', '开发']),
    ['人工智能'],
  );
  assert.deepEqual(
    matchingCategoryKeywords(['福利羊毛, Lv1'], ['福利羊毛', 'Lv1']),
    ['福利羊毛'],
  );
});

test('列表地址统一分页、标签和类别路径，保留影响列表的查询条件', () => {
  const { listPageKey } = require(scriptPath);
  const key = (value) => listPageKey(value, 'https://linux.do');
  assert.equal(key('/'), key('/latest.json?page=2'));
  assert.equal(key('/tag/444-tag/444'), key('/tag/444/l/latest.json?page=1'));
  assert.equal(key('/c/develop/4'), key('/c/4/l/latest.json'));
  assert.notEqual(key('/tag/444-tag/444/l/new'), key('/tag/444-tag/444'));
  assert.notEqual(key('/latest?order=created'), key('/latest'));
});

test('接口帖子在交给页面前过滤，并保留分页及原始帖子供预览', () => {
  const { filterTopicPayload, indexCategories } = require(scriptPath);
  const categoriesById = new Map();
  indexCategories([
    { id: 10, name: '福利羊毛' },
    { id: 11, name: 'Lv1', parent_category_id: 10 },
    { id: 12, name: '开发调优' },
  ], categoriesById);
  const topics = [
    { id: 1, slug: 'alpha', title: 'OpenAI 发布', tags: [], category_id: 12 },
    { id: 2, slug: 'beta', title: 'Beta 指南', tags: ['站务'], category_id: 11 },
    { id: 3, slug: 'gamma', title: 'Gamma 记录', tags: ['人工智能工具'], category_id: 12 },
  ];
  const payload = {
    users: [{ id: 99, username: 'tester' }],
    topic_list: {
      topics: structuredClone(topics),
      more_topics_url: '/latest?page=1',
    },
  };
  let remembered;

  assert.equal(filterTopicPayload(payload, {
    title: ['openai'],
    tag: ['人工智能'],
    category: ['福利羊毛'],
  }, categoriesById, (value) => { remembered = value; }), true);
  assert.deepEqual(payload.topic_list.topics.map(({ id }) => id), [3]);
  assert.deepEqual(remembered.map(({ id }) => id), [1, 2, 3]);
  assert.equal(payload.topic_list.more_topics_url, '/latest?page=1');
  assert.deepEqual(payload.users, [{ id: 99, username: 'tester' }]);
});

test('首屏预载数据先汇集类别，再过滤其中的帖子列表', () => {
  const { filterPreloadedData } = require(scriptPath);
  const source = JSON.stringify({
    topicList: JSON.stringify({
      topic_list: {
        topics: [
          { id: 1, title: '父类别帖子', tags: [], category_id: 10 },
          { id: 2, title: '子类别帖子', tags: [], category_id: 11 },
          { id: 3, title: '保留帖子', tags: [], category_id: 12 },
        ],
        more_topics_url: '/latest?page=1',
      },
    }),
    site: JSON.stringify({
      categories: [
        { id: 10, name: '福利羊毛' },
        { id: 11, name: 'Lv1', parent_category_id: 10 },
        { id: 12, name: '开发调优' },
      ],
    }),
  });
  const remembered = [];
  const result = JSON.parse(filterPreloadedData(
    source,
    { title: [], tag: [], category: ['福利羊毛'] },
    new Map(),
    (topics) => remembered.push(...topics),
  ));
  const list = JSON.parse(result.topicList);

  assert.deepEqual(list.topic_list.topics.map(({ id }) => id), [3]);
  assert.deepEqual(remembered.map(({ id }) => id), [1, 2, 3]);
  assert.equal(list.topic_list.more_topics_url, '/latest?page=1');
});

test('网盘资源自身有父类别时，首屏、后续帖子及预览均匹配自身和祖先名称', () => {
  const { filterPreloadedData, filterTopicPayload, topicDetails } = require(scriptPath);
  const categories = [
    { id: 14, name: '父类别示例' },
    { id: 94, name: '网盘资源', parent_category_id: 14 },
    { id: 95, name: '网盘资源, Lv1', parent_category_id: 94 },
    { id: 96, name: '网盘资源, Lv2', parent_category_id: 94 },
    { id: 97, name: '其他类别', parent_category_id: 14 },
    { id: 98, name: '网盘资源交流', parent_category_id: 14 },
  ];
  const topics = [
    { id: 2945709, title: '国学堂徐文兵梁冬《黄帝内经》第二季通天篇（完结）', category_id: 94 },
    { id: 2, title: '一级子类帖子', category_id: 95 },
    { id: 3, title: '二级子类帖子', category_id: 96 },
    { id: 4, title: '同级类别帖子', category_id: 97 },
    { id: 5, title: '近似名称帖子', category_id: 98 },
  ];
  const rules = { category: ['网盘资源'] };
  const categoriesById = new Map();
  const result = JSON.parse(filterPreloadedData(JSON.stringify({
    topicList: JSON.stringify({ topic_list: { topics } }),
    site: JSON.stringify({ categories }),
  }), rules, categoriesById));
  assert.deepEqual(JSON.parse(result.topicList).topic_list.topics.map(t => t.id), [4, 5]);

  const payload = { topic_list: { topics: structuredClone(topics) } };
  filterTopicPayload(payload, rules, categoriesById);
  assert.deepEqual(payload.topic_list.topics.map(t => t.id), [4, 5]);
  for (const topic of topics.slice(0, 3)) {
    assert.deepEqual(topicDetails(topic, rules, categoriesById).matches, [
      { label: '类别', keywords: ['网盘资源'] },
    ]);
  }
  const childRules = { category: ['网盘资源, Lv1'] };
  assert.equal(topicDetails(topics[0], childRules, categoriesById).matches.length, 0);
  assert.equal(topicDetails(topics[1], childRules, categoriesById).matches.length, 1);
  assert.equal(topicDetails(topics[2], childRules, categoriesById).matches.length, 0);
});

const createBrowser = ({ initialStored, writeValue, withToolbar = true } = {}) => {
  const script = fs.readFileSync(scriptPath, 'utf8');
  let document;
  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      this.open = false;
      this.popoverOpen = false;
      this.value = '';
      this.className = '';
      this._text = '';
    }
    set textContent(value) { this.children = []; this._text = String(value); }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set innerHTML(value) {
      this.replaceChildren();
      const stack = [this];
      for (const token of value.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (!token.startsWith('<')) { const text = new Element('#text'); text.textContent = token; stack.at(-1).append(text); continue; }
        const tag = token.match(/^<([\w-]+)/)?.[1];
        if (!tag) continue;
        const child = new Element(tag);
        const attrs = token.slice(tag.length + 1, token.endsWith('/>') ? -2 : -1);
        for (const attr of attrs.matchAll(/([\w:-]+)(?:="([^"]*)"|'([^']*)')?/g)) child.setAttribute(attr[1], attr[2] ?? attr[3] ?? '');
        stack.at(-1).append(child);
        if (!token.endsWith('/>') && !['input', 'br', 'hr', 'img'].includes(tag)) stack.push(child);
      }
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'class') this.className = String(value);
      if (name === 'id') this.id = value;
      if (name === 'hidden') this.hidden = true;
      if (name === 'disabled') this.disabled = true;
    }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async dispatch(type, extra = {}) {
      const event = { target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
      for (const listener of this.listeners[type] || []) await listener(event);
      return event;
    }
    append(...children) {
      for (const child of children) {
        if (child.tagName === '#fragment') { this.append(...[...child.children]); continue; }
        if (child.parentNode) child.remove();
        child.parentNode = this;
        this.children.push(child);
      }
    }
    prepend(child) { this.append(child); this.children.unshift(this.children.pop()); }
    remove() { this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
    replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
    get isConnected() { return this === document?.documentElement || !!this.parentNode?.isConnected; }
    matches(selector) {
      if (selector === ':popover-open') return this.popoverOpen;
      const enabled = selector.endsWith(':not(:disabled)');
      if (enabled) selector = selector.replace(':not(:disabled)', '');
      const match = selector.startsWith('.') ? this.className.split(/\s+/).includes(selector.slice(1)) : this.tagName === selector;
      return match && (!enabled || !this.disabled);
    }
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatch('close'); }
    showPopover() { this.popoverOpen = true; }
    hidePopover() { this.popoverOpen = false; this.dispatch('toggle', { newState: 'closed' }); }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return { top: 100, right: 1000, bottom: 136, width: 208, height: 100 }; }
  }
  class FakeXHR {
    constructor() { this.listeners = {}; this.readyState = 0; this.responseType = ''; }
    open(method, url) { this.method = method; this.url = url; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    respond(payload) {
      this.response = payload;
      Object.defineProperty(this, 'responseText', { configurable: true, value: JSON.stringify(payload) });
      this.readyState = 4;
      for (const listener of this.listeners.readystatechange || []) listener();
    }
  }
  let preloadElement;
  const observers = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const body = new Element('body');
  const documentElement = new Element('html');
  document = {
    body, documentElement,
    createDocumentFragment: () => new Element('#fragment'),
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => id === 'data-preloaded' ? preloadElement : null,
    querySelector: (selector) => documentElement.querySelector(selector),
  };
  documentElement.append(body);
  let toolbar;
  const mountToolbar = () => { toolbar = new Element('div'); toolbar.className = 'navigation-controls'; body.append(toolbar); return toolbar; };
  if (withToolbar) mountToolbar();
  let reloadCount = 0;
  const windowListeners = {};
  const pageWindow = {
    XMLHttpRequest: FakeXHR,
    innerWidth: 1280, innerHeight: 900,
    addEventListener: (type, callback) => { windowListeners[type] = callback; },
    history: Object.fromEntries(['pushState', 'replaceState'].map((method) => [method, (_state, _title, value) => {
      if (value != null) { const url = new URL(value, 'https://linux.do'); pageWindow.location.pathname = url.pathname; pageWindow.location.search = url.search; }
    }])),
    location: { origin: 'https://linux.do', pathname: '/latest', search: '', reload: () => { reloadCount += 1; } },
  };
  const stored = new Map(initialStored || [['keywords', 'alpha'], ['tagKeywords', ''], ['categoryKeywords', '福利羊毛']]);
  let menuCommand;
  vm.runInNewContext(script, {
    document, URL, MutationObserver, unsafeWindow: pageWindow,
    GM_getValue: (key, fallback) => stored.get(key) ?? fallback,
    GM_registerMenuCommand: (_label, callback) => { menuCommand = callback; },
    GM_setValue: (key, value) => writeValue ? writeValue(key, value, stored) : stored.set(key, value),
  });
  return {
    Element, FakeXHR, body, documentElement, document, stored, pageWindow, menuCommand, windowListeners, mountToolbar,
    setPreload: (element) => { preloadElement = element; },
    observe: () => { for (const observer of observers) if (!observer.disconnected) observer.callback(); },
    get observerDisconnected() { return observers[0].disconnected; },
    get reloadCount() { return reloadCount; },
    get toolbar() { return toolbar; },
    get launcher() { return documentElement.querySelector('.houmao-linux-do-topic-filter-launcher'); },
    get drawer() { return body.querySelector('dialog'); },
  };
};

const control = (drawer, name) => drawer.querySelector(`.houmao-linux-do-topic-filter-${name}`);
const respondTopics = (browser, topics, url = '/latest.json', type = '') => {
  const xhr = new browser.FakeXHR();
  xhr.responseType = type;
  xhr.open('GET', url);
  const next = new URL(url, 'https://linux.do');
  next.pathname = next.pathname.replace(/\.json$/, '');
  next.searchParams.set('page', '2');
  xhr.respond({ topic_list: { topics, more_topics_url: `${next.pathname}${next.search}` } });
  return type === 'json' ? xhr.response : JSON.parse(xhr.responseText);
};
const titles = (list) => list.querySelectorAll('.houmao-linux-do-topic-filter-topic-link').map((link) => link.textContent);
const addKeyword = async (browser, key, value) => {
  const input = control(browser.drawer, `${key}-input`);
  input.value = value;
  return input.dispatch('keydown', { key: 'Enter' });
};
const removeKeywords = async (browser, key) => {
  for (const button of control(browser.drawer, `${key}-chips`).querySelectorAll('button')) await button.dispatch('click');
};
const openRowMenu = async (browser, list, index = 0) => {
  const trigger = control(browser.drawer, list).querySelectorAll('.houmao-linux-do-topic-filter-topic-menu')[index];
  await trigger.dispatch('click');
  return control(browser.drawer, 'menu');
};
const showRetained = async (browser) => {
  await control(browser.drawer, 'header-menu').dispatch('click');
  await control(browser.drawer, 'menu').querySelector('button').dispatch('click');
};

test('工具栏晚到与 SPA 重建后仍只有一个入口，非列表可从脚本菜单打开', () => {
  const browser = createBrowser({ withToolbar: false });
  assert.equal(browser.launcher, null);
  browser.menuCommand();
  assert.equal(browser.drawer.open, true);
  assert.equal(control(browser.drawer, 'rules-panel').hidden, false);
  browser.mountToolbar();
  browser.observe();
  const launcher = browser.launcher;
  assert.equal(launcher.parentNode, browser.toolbar);
  browser.observe();
  assert.equal(browser.toolbar.children.length, 1);
  browser.toolbar.remove();
  browser.mountToolbar();
  browser.observe();
  assert.equal(browser.launcher, launcher);
  assert.equal(browser.toolbar.children.length, 1);
});

test('首屏分段预载及后续 XHR 均过滤，入口展示实际数量', async () => {
  const browser = createBrowser();
  const preload = new browser.Element('script');
  browser.setPreload(preload);
  browser.observe();
  assert.equal(browser.observerDisconnected, false);
  preload.textContent = '{"site":';
  browser.observe();
  assert.equal(browser.observerDisconnected, false);
  preload.textContent = JSON.stringify({
    topicList: JSON.stringify({ topic_list: { topics: [
      { id: 1, title: 'Alpha 发布', category_id: 12 },
      { id: 2, title: 'Beta 指南', category_id: 11 },
      { id: 3, title: 'Gamma 记录', category_id: 12 },
    ], more_topics_url: '/latest?page=1' } }),
    site: JSON.stringify({ categories: [{ id: 10, name: '福利羊毛' }, { id: 11, name: 'Lv1', parent_category_id: 10 }, { id: 12, name: '开发调优' }] }),
  });
  browser.observe();
  assert.equal(browser.observerDisconnected, true);
  assert.deepEqual(JSON.parse(JSON.parse(preload.textContent).topicList).topic_list.topics.map((t) => t.id), [3]);
  assert.equal(browser.launcher.textContent, '过滤 2');
  await browser.launcher.dispatch('click');
  assert.equal(control(browser.drawer, 'actual-status').textContent, '本页已读取 3 条，已过滤 2 条');
  assert.deepEqual(titles(control(browser.drawer, 'actual-list')), ['Alpha 发布', 'Beta 指南']);
  const payload = respondTopics(browser, [{ id: 6, title: '后续类别帖子', category_id: 11 }], '/latest.json?page=1');
  assert.equal(payload.topic_list.topics.length, 0);
  assert.equal(payload.topic_list.more_topics_url, '/latest?page=2');
  assert.equal(browser.launcher.textContent, '过滤 3');
});

test('空结果与尚无数据分开，重复帖子不增加计数，实际原因不随草稿变化', async () => {
  const browser = createBrowser();
  await browser.launcher.dispatch('click');
  assert.match(control(browser.drawer, 'empty-title').textContent, /尚未取得/);
  respondTopics(browser, []);
  assert.equal(control(browser.drawer, 'empty-title').textContent, '这一页没有命中规则');
  assert.match(control(browser.drawer, 'actual-status').textContent, /已读取 0 条/);
  const topics = [{ id: 1, title: 'Alpha 发布' }, { id: 2, title: 'Beta 指南' }];
  respondTopics(browser, topics);
  respondTopics(browser, topics, '/latest.json?page=1');
  assert.match(control(browser.drawer, 'actual-status').textContent, /已读取 2 条/);
  await control(browser.drawer, 'rules-tab').dispatch('click');
  await removeKeywords(browser, 'title');
  await addKeyword(browser, 'title', 'beta');
  assert.deepEqual(titles(control(browser.drawer, 'preview')), ['Beta 指南']);
  await control(browser.drawer, 'records-tab').dispatch('click');
  assert.deepEqual(titles(control(browser.drawer, 'actual-list')), ['Alpha 发布']);
  assert.equal(control(browser.drawer, 'actual-list').querySelector('.houmao-linux-do-topic-filter-match').textContent, '标题包含「alpha」');
  await control(browser.drawer, 'rules-tab').dispatch('click');
  assert.deepEqual(titles(control(browser.drawer, 'preview')), ['Beta 指南']);
  await control(browser.drawer, 'save').dispatch('click');
  assert.equal(browser.stored.get('keywords'), 'beta');
  assert.equal(browser.reloadCount, 0);
  assert.match(control(browser.drawer, 'notice-text').textContent, /已保存/);
  await control(browser.drawer, 'records-tab').dispatch('click');
  assert.deepEqual(titles(control(browser.drawer, 'actual-list')), ['Alpha 发布']);
  assert.deepEqual(respondTopics(browser, [{ id: 3, title: 'Beta 新帖' }, { id: 4, title: 'Alpha 新帖' }]).topic_list.topics.map((t) => t.id), [4]);
});

test('词条支持去重、多行粘贴与中文输入法；切页签保留草稿，关闭后丢弃', async () => {
  const browser = createBrowser({ initialStored: [] });
  browser.menuCommand();
  assert.equal(control(browser.drawer, 'preview-hint').textContent, '添加规则后查看命中结果');
  const input = control(browser.drawer, 'title-input');
  input.value = '中文';
  const composing = await input.dispatch('keydown', { key: 'Enter', isComposing: true });
  assert.equal(composing.defaultPrevented, false);
  assert.equal(control(browser.drawer, 'title-chips').children.length, 0);
  await input.dispatch('keydown', { key: 'Enter' });
  await addKeyword(browser, 'title', ' AI ');
  await addKeyword(browser, 'title', 'ai');
  input.value = '临时内容'; input.selectionStart = 0; input.selectionEnd = 4;
  const pasted = await input.dispatch('paste', { clipboardData: { getData: () => '抽奖\nAI\n限时领取' } });
  assert.equal(pasted.defaultPrevented, true);
  assert.deepEqual(control(browser.drawer, 'title-chips').querySelectorAll('.houmao-linux-do-topic-filter-chip-label').map((e) => e.textContent), ['中文', 'AI', '抽奖', '限时领取']);
  await addKeyword(browser, 'category', '网盘资源, Lv1');
  assert.equal(control(browser.drawer, 'category-chips').children.length, 1);
  await control(browser.drawer, 'records-tab').dispatch('click');
  await control(browser.drawer, 'rules-tab').dispatch('click');
  assert.equal(control(browser.drawer, 'title-chips').children.length, 4);
  await control(browser.drawer, 'close').dispatch('click');
  browser.menuCommand();
  assert.equal(control(browser.drawer, 'title-chips').children.length, 0);
  assert.equal(control(browser.drawer, 'category-chips').children.length, 0);
  assert.equal(browser.stored.size, 0);
});

test('规则输入尚未按回车时，预览及保存也包含待添加词条', async () => {
  const browser = createBrowser({ initialStored: [] });
  respondTopics(browser, [{ id: 1, title: 'Beta' }]);
  browser.menuCommand();
  control(browser.drawer, 'title-input').value = 'Beta';
  await control(browser.drawer, 'title-input').dispatch('input');
  assert.equal(control(browser.drawer, 'status').textContent, '预计过滤 1 条');
  await control(browser.drawer, 'save').dispatch('click');
  assert.equal(browser.stored.get('keywords'), 'Beta');
  assert.equal(control(browser.drawer, 'title-input').value, '');
});

test('接口先于地址变化和旧页迟到响应均不串页', () => {
  const browser = createBrowser();
  respondTopics(browser, [{ id: 1, title: 'Alpha 首页' }]);
  respondTopics(browser, [{ id: 2, title: '标签页保留' }], '/tag/444/l/latest.json', 'json');
  assert.equal(browser.launcher.textContent, '过滤 1');
  browser.pageWindow.history.pushState({}, '', '/tag/444-tag/444');
  assert.equal(browser.launcher.textContent, '过滤 0');
  respondTopics(browser, [{ id: 3, title: 'Alpha 迟到' }], '/latest.json?page=2');
  assert.equal(browser.launcher.textContent, '过滤 0');
  browser.pageWindow.history.pushState({}, '', '/t/topic/123');
  assert.match(browser.launcher.title, /尚未取得/);
  browser.pageWindow.location.pathname = '/latest'; browser.windowListeners.popstate();
  assert.equal(browser.launcher.textContent, '过滤 2');
});

test('真实标签页分页附带标签参数时，沿 more_topics_url 累计到当前列表', async () => {
  const browser = createBrowser();
  browser.pageWindow.history.pushState({}, '', '/tag/444-tag/444');
  // 来自 LINUX DO 人工智能标签页的预载分页地址，地址栏没有这两项标签参数。
  const moreUrl = (page) => `/tag/444-tag/444?match_all_tags=true&page=${page}&tags%5B%5D=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD`;
  const requestUrl = (page) => moreUrl(page).replace('/444?', '/444.json?');
  const preload = new browser.Element('script');
  preload.textContent = JSON.stringify({ topic_list: JSON.stringify({ topic_list: {
    topics: [{ id: 1, title: 'Alpha 首屏' }, { id: 2, title: '首屏保留' }],
    more_topics_url: moreUrl(1),
  } }) });
  browser.setPreload(preload);
  browser.observe();
  await browser.launcher.dispatch('click');

  const first = new browser.FakeXHR();
  first.open('GET', requestUrl(1));
  first.respond({ topic_list: {
    topics: [{ id: 3, title: 'Alpha 第二页' }, { id: 4, title: '第二页保留' }],
    more_topics_url: moreUrl(2),
  } });
  assert.deepEqual(JSON.parse(first.responseText).topic_list.topics.map((topic) => topic.id), [4]);
  assert.equal(control(browser.drawer, 'actual-status').textContent, '本页已读取 4 条，已过滤 2 条');

  const second = new browser.FakeXHR();
  second.responseType = 'json';
  second.open('GET', requestUrl(2));
  second.respond({ topic_list: {
    topics: [{ id: 4, title: '第二页保留' }, { id: 5, title: 'Alpha 第三页' }, { id: 6, title: '第三页保留' }],
    more_topics_url: null,
  } });
  assert.equal(control(browser.drawer, 'actual-status').textContent, '本页已读取 6 条，已过滤 3 条');
  assert.deepEqual(titles(control(browser.drawer, 'actual-list')), ['Alpha 首屏', 'Alpha 第二页', 'Alpha 第三页']);
  await control(browser.drawer, 'rules-tab').dispatch('click');
  assert.equal(control(browser.drawer, 'status').textContent, '预计过滤 3 条');
});

test('分页归属来自服务器链接，切换排序后迟到的分页仍记回原列表', async () => {
  const browser = createBrowser();
  const pathname = '/tag/444-tag/444';
  const more = `${pathname}?match_all_tags=true&page=1&tags%5B%5D=人工智能`;
  browser.pageWindow.history.pushState({}, '', pathname);
  const first = new browser.FakeXHR();
  first.open('GET', `${pathname}.json`);
  first.respond({ topic_list: { topics: [{ id: 1, title: 'Alpha 最新列表' }], more_topics_url: more } });
  const pending = new browser.FakeXHR();
  pending.open('GET', more.replace('/444?', '/444.json?'));

  browser.pageWindow.history.pushState({}, '', `${pathname}?order=created`);
  const sorted = new browser.FakeXHR();
  sorted.open('GET', `${pathname}.json?order=created`);
  sorted.respond({ topic_list: { topics: [{ id: 2, title: '按创建时间保留' }], more_topics_url: `${more}&order=created` } });
  pending.respond({ topic_list: { topics: [{ id: 3, title: 'Alpha 最新列表迟到分页' }] } });
  await browser.launcher.dispatch('click');
  assert.equal(control(browser.drawer, 'actual-status').textContent, '本页已读取 1 条，已过滤 0 条');

  const sortedPage = new browser.FakeXHR();
  sortedPage.open('GET', `${more.replace('/444?', '/444.json?')}&order=created`);
  sortedPage.respond({ topic_list: { topics: [{ id: 4, title: 'Alpha 创建时间分页' }] } });
  assert.equal(control(browser.drawer, 'actual-status').textContent, '本页已读取 2 条，已过滤 1 条');
  browser.pageWindow.history.pushState({}, '', pathname);
  assert.equal(control(browser.drawer, 'actual-status').textContent, '本页已读取 2 条，已过滤 2 条');
});

test('更多菜单放行单帖，保留清单可撤销；刷新后优先于三类过滤', async () => {
  const browser = createBrowser({ initialStored: [['keywords', 'alpha'], ['tagKeywords', '抽奖'], ['categoryKeywords', '福利羊毛']] });
  const topic = { id: 42, title: 'Alpha 抽奖', tags: ['抽奖'], category_id: 10 };
  const source = JSON.stringify({ site: JSON.stringify({ categories: [{ id: 10, name: '福利羊毛' }] }), topicList: JSON.stringify({ topic_list: { topics: [topic] } }) });
  const preload = new browser.Element('script'); preload.textContent = source; browser.setPreload(preload); browser.observe();
  await browser.launcher.dispatch('click');
  assert.equal(control(browser.drawer, 'actual-list').querySelectorAll('button').length, 1, '每行只显示更多入口');
  const menu = await openRowMenu(browser, 'actual-list');
  assert.equal(menu.popoverOpen, true);
  assert.equal(menu.children[0].textContent, '打开帖子');
  await menu.children[1].dispatch('click');
  assert.equal(menu.popoverOpen, false);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.stored.get('allowedTopics'))), [{ id: '42', title: 'Alpha 抽奖' }]);
  assert.match(control(browser.drawer, 'notice-text').textContent, /已保留此帖/);
  assert.equal(browser.launcher.textContent, '过滤 1');
  await control(browser.drawer, 'rules-tab').dispatch('click');
  assert.equal(control(browser.drawer, 'status').textContent, '预计过滤 0 条');
  await showRetained(browser);
  assert.equal(control(browser.drawer, 'heading').textContent, '保留清单');
  assert.deepEqual(titles(control(browser.drawer, 'retained-list')), ['Alpha 抽奖']);
  await control(browser.drawer, 'back').dispatch('click');
  assert.equal(control(browser.drawer, 'rules-panel').hidden, false);

  const next = createBrowser({ initialStored: [...browser.stored] });
  const nextPreload = new next.Element('script'); nextPreload.textContent = source; next.setPreload(nextPreload); next.observe();
  assert.equal(JSON.parse(JSON.parse(nextPreload.textContent).topicList).topic_list.topics.length, 1);
  assert.equal(respondTopics(next, [topic], '/latest.json?page=1', 'json').topic_list.topics.length, 1);
  await next.launcher.dispatch('click'); await showRetained(next);
  const revoke = await openRowMenu(next, 'retained-list');
  await revoke.children[1].dispatch('click');
  assert.equal(next.stored.get('allowedTopics').length, 0);
  assert.equal(control(next.drawer, 'retained-empty').hidden, false);
  assert.equal(respondTopics(next, [topic]).topic_list.topics.length, 0);
});

test('放行保存失败时显示错误，原过滤仍生效', async () => {
  const browser = createBrowser({ writeValue: () => Promise.reject(new Error('storage failed')) });
  const topic = { id: 1, title: 'Alpha 发布' };
  respondTopics(browser, [topic]); await browser.launcher.dispatch('click');
  const menu = await openRowMenu(browser, 'actual-list'); await menu.children[1].dispatch('click');
  assert.equal(control(browser.drawer, 'action-error').hidden, false);
  assert.equal(respondTopics(browser, [topic]).topic_list.topics.length, 0);
  assert.equal(browser.reloadCount, 0);
});

test('保存并刷新等待写入且阻止重复提交，失败后保留草稿与编辑能力', async () => {
  const writes = [];
  const browser = createBrowser({ writeValue: (key, value, stored) => new Promise((resolve) => writes.push(() => { stored.set(key, value); resolve(); })) });
  browser.menuCommand(); await removeKeywords(browser, 'title');
  control(browser.drawer, 'title-input').value = 'beta';
  const pending = control(browser.drawer, 'save-refresh').dispatch('click');
  assert.equal(control(browser.drawer, 'title-input').disabled, true);
  await control(browser.drawer, 'save-refresh').dispatch('click');
  assert.equal(writes.length, 3);
  assert.equal((await browser.drawer.dispatch('cancel')).defaultPrevented, true);
  writes[0](); writes[1](); assert.equal(browser.reloadCount, 0); writes[2](); await pending;
  assert.equal(browser.reloadCount, 1);
  assert.equal(browser.stored.get('keywords'), 'beta');

  const failed = createBrowser({ writeValue: () => Promise.reject(new Error('storage failed')) });
  failed.menuCommand(); await removeKeywords(failed, 'title'); await addKeyword(failed, 'title', 'beta');
  await control(failed.drawer, 'save-refresh').dispatch('click');
  assert.equal(failed.reloadCount, 0); assert.equal(failed.drawer.open, true);
  assert.equal(control(failed.drawer, 'rules-error').hidden, false);
  assert.equal(control(failed.drawer, 'title-input').disabled, false);
  assert.equal(control(failed.drawer, 'title-chips').textContent, 'beta');
  assert.equal(respondTopics(failed, [{ id: 1, title: 'Alpha' }]).topic_list.topics.length, 0);
});

test('页签及更多菜单支持键盘导航，Escape 关闭菜单并归还焦点', async () => {
  const browser = createBrowser(); respondTopics(browser, [{ id: 1, title: 'Alpha' }]);
  await browser.launcher.dispatch('click');
  await control(browser.drawer, 'records-tab').dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(browser.document.activeElement, control(browser.drawer, 'rules-tab'));
  await control(browser.drawer, 'rules-tab').dispatch('keydown', { key: 'Home' });
  const menu = await openRowMenu(browser, 'actual-list');
  assert.equal(browser.document.activeElement, menu.children[0]);
  await menu.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(browser.document.activeElement, menu.children[1]);
  await menu.dispatch('keydown', { key: 'Escape' });
  assert.equal(menu.popoverOpen, false);
  assert.equal(browser.document.activeElement, control(browser.drawer, 'actual-list').querySelector('button'));
});

test('响应改写失败不会谎报已过滤', () => {
  const browser = createBrowser(); const xhr = new browser.FakeXHR(); xhr.open('GET', '/latest.json');
  Object.defineProperty(xhr, 'responseText', { configurable: false, value: JSON.stringify({ topic_list: { topics: [{ id: 1, title: 'Alpha' }] } }) });
  xhr.readyState = 4; for (const callback of [...xhr.listeners.readystatechange]) callback();
  assert.match(browser.launcher.title, /尚未取得/);
  assert.equal(JSON.parse(xhr.responseText).topic_list.topics.length, 1);
});
