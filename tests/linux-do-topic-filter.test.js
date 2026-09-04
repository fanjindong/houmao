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

test('脚本过滤首屏和后续 XHR；保存后不刷新或改动既有列表', async () => {
  const script = fs.readFileSync(scriptPath, 'utf8');

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = {};
      this.hidden = false;
      this.open = false;
      this.textContent = '';
      this.value = '';
    }

    addEventListener(type, listener) {
      (this.listeners[type] ||= []).push(listener);
    }

    async dispatch(type) {
      for (const listener of this.listeners[type] || []) await listener({ preventDefault() {} });
    }

    append(...children) {
      this.children.push(...children);
    }

    replaceChildren(...children) {
      this.children = children.flatMap((child) => child.tagName === '#fragment' ? child.children : child);
    }

    showModal() {
      this.open = true;
    }

    close() {
      this.open = false;
    }

    focus() {}
  }

  class Dialog extends Element {
    constructor() {
      super('dialog');
      this.controls = {
        '.houmao-linux-do-topic-filter-title-input': new Element('textarea'),
        '.houmao-linux-do-topic-filter-tag-input': new Element('textarea'),
        '.houmao-linux-do-topic-filter-category-input': new Element('textarea'),
        '.houmao-linux-do-topic-filter-status': new Element('p'),
        '.houmao-linux-do-topic-filter-preview': new Element('ul'),
        '.houmao-linux-do-topic-filter-error': new Element('p'),
        '.houmao-linux-do-topic-filter-save': new Element('button'),
      };
      this.controls['.houmao-linux-do-topic-filter-error'].hidden = true;
    }

    querySelector(selector) {
      return this.controls[selector] || null;
    }
  }

  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.readyState = 0;
      this.responseType = '';
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    addEventListener(type, listener) {
      (this.listeners[type] ||= []).push(listener);
    }

    respond(payload) {
      Object.defineProperty(this, 'responseText', {
        configurable: true,
        value: JSON.stringify(payload),
      });
      this.readyState = 4;
      for (const listener of this.listeners.readystatechange || []) listener();
    }
  }
  FakeXHR.DONE = 4;

  let preloadElement;
  let observeCallback;
  let observerDisconnected = false;
  class MutationObserver {
    constructor(callback) {
      observeCallback = callback;
    }

    observe() {}

    disconnect() {
      observerDisconnected = true;
    }
  }

  const body = new Element('body');
  const documentElement = new Element('html');
  const document = {
    body,
    documentElement,
    createDocumentFragment: () => new Element('#fragment'),
    createElement: (tagName) => tagName === 'dialog' ? new Dialog() : new Element(tagName),
    getElementById: (id) => id === 'data-preloaded' ? preloadElement : null,
    querySelectorAll: () => {
      throw new Error('不应扫描帖子 DOM');
    },
  };
  let reloadCount = 0;
  const pageWindow = {
    XMLHttpRequest: FakeXHR,
    location: {
      pathname: '/latest',
      search: '',
      reload: () => { reloadCount += 1; },
    },
  };
  const stored = new Map([
    ['keywords', 'alpha'],
    ['tagKeywords', ''],
    ['categoryKeywords', '福利羊毛'],
  ]);
  let menuCommand;
  const context = {
    document,
    GM_getValue: (key, fallback) => stored.get(key) ?? fallback,
    GM_registerMenuCommand: (_label, callback) => { menuCommand = callback; },
    GM_setValue: (key, value) => { stored.set(key, value); },
    MutationObserver,
    unsafeWindow: pageWindow,
  };

  vm.runInNewContext(script, context);

  preloadElement = new Element('script');
  preloadElement.textContent = JSON.stringify({
    topicList: JSON.stringify({
      topic_list: {
        topics: [
          { id: 1, slug: 'alpha', title: 'Alpha 发布', tags: [], category_id: 12 },
          { id: 2, slug: 'beta', title: 'Beta 指南', tags: [], category_id: 11 },
          { id: 3, slug: 'gamma', title: 'Gamma 记录', tags: [], category_id: 12 },
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
  observeCallback();

  const initialOuter = JSON.parse(preloadElement.textContent);
  const initialList = JSON.parse(initialOuter.topicList);
  const initialPreloadedText = preloadElement.textContent;
  assert.deepEqual(initialList.topic_list.topics.map(({ id }) => id), [3]);
  assert.equal(observerDisconnected, true);

  menuCommand();
  const dialog = body.children.find((child) => child.tagName === 'dialog');
  assert.ok(dialog.innerHTML.indexOf('类别名称') < dialog.innerHTML.indexOf('标签名称'));
  const titleInput = dialog.querySelector('.houmao-linux-do-topic-filter-title-input');
  const tagInput = dialog.querySelector('.houmao-linux-do-topic-filter-tag-input');
  const categoryInput = dialog.querySelector('.houmao-linux-do-topic-filter-category-input');
  const status = dialog.querySelector('.houmao-linux-do-topic-filter-status');
  const preview = dialog.querySelector('.houmao-linux-do-topic-filter-preview');
  const save = dialog.querySelector('.houmao-linux-do-topic-filter-save');
  assert.equal(status.textContent, '当前已加载数据将过滤 2 个帖子');
  assert.deepEqual(preview.children.map((item) => item.children[0].textContent), [
    'Alpha 发布',
    'Beta 指南',
  ]);

  titleInput.value = 'gamma';
  tagInput.value = '';
  categoryInput.value = '';
  await save.dispatch('click');
  assert.equal(reloadCount, 0);
  assert.equal(stored.get('keywords'), 'gamma');
  assert.equal(preloadElement.textContent, initialPreloadedText);

  const xhr = new FakeXHR();
  xhr.open('GET', '/latest.json?page=1');
  xhr.respond({
    topic_list: {
      topics: [
        { id: 4, slug: 'gamma-2', title: '另一个 Gamma 帖子', tags: [], category_id: 12 },
        { id: 5, slug: 'delta', title: 'Delta 帖子', tags: [], category_id: 12 },
      ],
      more_topics_url: '/latest?page=2',
    },
  });
  const nextList = JSON.parse(xhr.responseText);
  assert.deepEqual(nextList.topic_list.topics.map(({ id }) => id), [5]);
  assert.equal(nextList.topic_list.more_topics_url, '/latest?page=2');
});
