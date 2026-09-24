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
  // HTML 分段到达时，预载节点可能先出现，JSON 内容稍后才写完整。
  observeCallback();
  assert.equal(observerDisconnected, false, '空预载节点不能导致停止监听');
  preloadElement.textContent = '{"site":';
  observeCallback();
  assert.equal(observerDisconnected, false, '未完成的 JSON 不能导致停止监听');
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

  const categoryXhr = new FakeXHR();
  categoryXhr.open('GET', '/latest.json?page=1');
  categoryXhr.respond({
    topic_list: {
      topics: [{ id: 6, title: '后续类别帖子', category_id: 11 }],
    },
  });
  assert.deepEqual(JSON.parse(categoryXhr.responseText).topic_list.topics, []);
  assert.ok(preview.children.some((item) => item.children[0].textContent === '后续类别帖子'));

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
