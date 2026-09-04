const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');

const scriptPath = path.resolve(__dirname, '../scripts/linux-do-topic-filter.user.js');

test('过滤词按行清理、去重并作标题子串匹配', () => {
  const { parseKeywords, matchingKeywords, matchingExactKeywords } = require(scriptPath);

  assert.deepEqual(parseKeywords(' AI \n\n抽奖\nai\nAI 助手 '), ['AI', '抽奖', 'AI 助手']);
  assert.deepEqual(parseKeywords(null), []);
  assert.deepEqual(matchingKeywords('OpenAI 抽奖活动', ['ai', '抽奖', '教程']), ['ai', '抽奖']);
  assert.deepEqual(matchingKeywords('', ['抽奖']), []);
  assert.deepEqual(
    matchingExactKeywords(['人工智能', '开发调优'], ['人工智能', '人工', '开发']),
    ['人工智能'],
  );
});

test('标题、标签和类别独立过滤，草稿预览后保存并处理新增帖子', async () => {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const rowSelector = '.topic-list-item[data-topic-id]';
  const titleSelector = '.title.raw-topic-link[data-topic-id]';
  const tagSelector = '.discourse-tag';
  const categorySelector = '.badge-category__name';
  const activeClass = 'houmao-linux-do-topic-filter-active';
  const hiddenClass = 'houmao-linux-do-topic-filter-hidden';
  const readyClass = 'houmao-linux-do-topic-filter-ready';

  class ClassList {
    constructor() {
      this.values = new Set();
    }

    toggle(value, force) {
      if (force) this.values.add(value);
      else this.values.delete(value);
    }

    contains(value) {
      return this.values.has(value);
    }
  }

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.classList = new ClassList();
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

    appendChild(child) {
      this.append(child);
      return child;
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

  const topic = ({ title, tags = [], category = null }) => {
    const classList = new ClassList();
    const anchor = title === null ? null : { textContent: title, href: `https://linux.do/t/${encodeURIComponent(title)}` };
    const tagElements = tags.map((textContent) => ({ textContent }));
    const categoryElements = category === null ? [] : [{ textContent: category }];
    const row = {
      nodeType: 1,
      classList,
      closest: (selector) => selector === rowSelector ? row : null,
      querySelector: (selector) => selector === titleSelector ? anchor : null,
      querySelectorAll: (selector) => {
        if (selector === tagSelector) return tagElements;
        if (selector === categorySelector) return categoryElements;
        return [];
      },
    };
    return row;
  };

  const alpha = topic({ title: 'Alpha 发布说明', tags: ['人工智能'], category: '开发调优' });
  const tagged = topic({ title: 'Beta 使用指南', tags: ['人工智能'] });
  const categorized = topic({ title: 'Gamma 调优记录', category: '开发调优, Lv1' });
  const partial = topic({ title: 'Delta', tags: ['人工智能工具'], category: '开发调优区' });
  const untitled = topic({ title: null });
  const topics = [alpha, tagged, categorized, partial, untitled];
  const body = new Element('body');
  const documentElement = new Element('html');
  const document = {
    body,
    documentElement,
    createDocumentFragment: () => new Element('#fragment'),
    createElement: (tagName) => tagName === 'dialog' ? new Dialog() : new Element(tagName),
    querySelectorAll: (selector) => {
      assert.equal(selector, rowSelector);
      return topics;
    },
  };

  let observeCallback;
  class MutationObserver {
    constructor(callback) {
      observeCallback = callback;
    }

    observe() {}
  }

  const stored = new Map([
    ['keywords', 'alpha\nALPHA'],
    ['tagKeywords', '人工智能'],
    ['categoryKeywords', '开发调优'],
  ]);
  let menuCommand;
  const saved = [];
  const context = {
    document,
    MutationObserver,
    GM_getValue: (key, fallback) => stored.get(key) ?? fallback,
    GM_setValue: (key, value) => {
      stored.set(key, value);
      saved.push([key, value]);
    },
    GM_registerMenuCommand: (_label, callback) => {
      menuCommand = callback;
    },
  };

  vm.runInNewContext(script, context);

  assert.equal(documentElement.classList.contains(activeClass), true);
  assert.equal(
    documentElement.children[0].textContent.includes(
      `.${activeClass} ${rowSelector}:not(.${readyClass})`,
    ),
    true,
  );
  assert.equal(alpha.classList.contains(hiddenClass), true);
  assert.equal(alpha.classList.contains(readyClass), true);
  assert.equal(tagged.classList.contains(hiddenClass), true);
  assert.equal(categorized.classList.contains(hiddenClass), true);
  assert.equal(partial.classList.contains(hiddenClass), false);
  assert.equal(untitled.classList.contains(hiddenClass), false);

  menuCommand();
  const dialog = body.children.find((child) => child.tagName === 'dialog');
  assert.ok(dialog.innerHTML.indexOf('类别名称') < dialog.innerHTML.indexOf('标签名称'));
  const titleInput = dialog.querySelector('.houmao-linux-do-topic-filter-title-input');
  const tagInput = dialog.querySelector('.houmao-linux-do-topic-filter-tag-input');
  const categoryInput = dialog.querySelector('.houmao-linux-do-topic-filter-category-input');
  const status = dialog.querySelector('.houmao-linux-do-topic-filter-status');
  const preview = dialog.querySelector('.houmao-linux-do-topic-filter-preview');
  const save = dialog.querySelector('.houmao-linux-do-topic-filter-save');
  assert.equal(titleInput.value, 'alpha');
  assert.equal(tagInput.value, '人工智能');
  assert.equal(categoryInput.value, '开发调优');
  assert.equal(status.textContent, '当前页面将过滤 3 个帖子');
  assert.equal(preview.children[0].children[0].textContent, 'Alpha 发布说明');
  assert.equal(
    preview.children[0].children[1].textContent,
    '标题：alpha；标签：人工智能；类别：开发调优',
  );
  assert.equal(preview.children[1].children[1].textContent, '标签：人工智能');
  assert.equal(preview.children[2].children[1].textContent, '类别：开发调优');

  titleInput.value = 'beta';
  tagInput.value = '';
  categoryInput.value = '';
  await titleInput.dispatch('input');
  assert.equal(status.textContent, '当前页面将过滤 1 个帖子');
  assert.equal(preview.children[0].children[0].textContent, 'Beta 使用指南');
  assert.equal(preview.children[0].children[1].textContent, '标题：beta');
  assert.equal(alpha.classList.contains(hiddenClass), true);
  assert.equal(tagged.classList.contains(hiddenClass), true);

  const newBeta = topic({ title: '另一个 Beta 帖子' });
  topics.push(newBeta);
  assert.equal(newBeta.classList.contains(readyClass), false);
  observeCallback([{ addedNodes: [newBeta] }]);
  assert.equal(newBeta.classList.contains(readyClass), true);
  assert.equal(status.textContent, '当前页面将过滤 2 个帖子');
  assert.equal(newBeta.classList.contains(hiddenClass), false);

  dialog.close();
  assert.deepEqual(saved, []);
  menuCommand();
  assert.equal(titleInput.value, 'alpha');
  assert.equal(tagInput.value, '人工智能');
  assert.equal(categoryInput.value, '开发调优');

  titleInput.value = 'beta';
  tagInput.value = '站务';
  categoryInput.value = '搞七捻三';
  await save.dispatch('click');
  assert.deepEqual(saved, [
    ['keywords', 'beta'],
    ['tagKeywords', '站务'],
    ['categoryKeywords', '搞七捻三'],
  ]);
  assert.equal(alpha.classList.contains(hiddenClass), false);
  assert.equal(tagged.classList.contains(hiddenClass), true);
  assert.equal(categorized.classList.contains(hiddenClass), false);
  assert.equal(newBeta.classList.contains(hiddenClass), true);

  const laterTag = topic({ title: '站点公告', tags: ['站务'] });
  const laterCategory = topic({ title: '闲聊', category: '搞七捻三' });
  const similarTag = topic({ title: '近似标签', tags: ['站务公告'] });
  topics.push(laterTag, laterCategory, similarTag);
  observeCallback([{ addedNodes: [laterTag, laterCategory, similarTag] }]);
  assert.equal(laterTag.classList.contains(hiddenClass), true);
  assert.equal(laterCategory.classList.contains(hiddenClass), true);
  assert.equal(similarTag.classList.contains(hiddenClass), false);

  menuCommand();
  titleInput.value = '';
  tagInput.value = '';
  categoryInput.value = '';
  await save.dispatch('click');
  assert.equal(documentElement.classList.contains(activeClass), false);
  assert.equal(stored.get('keywords'), '');
  assert.equal(stored.get('tagKeywords'), '');
  assert.equal(stored.get('categoryKeywords'), '');
  assert.equal(tagged.classList.contains(hiddenClass), false);
  assert.equal(newBeta.classList.contains(hiddenClass), false);
  assert.equal(laterTag.classList.contains(hiddenClass), false);
  assert.equal(laterCategory.classList.contains(hiddenClass), false);
});
