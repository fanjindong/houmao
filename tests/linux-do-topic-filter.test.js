const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');

const scriptPath = path.resolve(__dirname, '../scripts/linux-do-topic-filter.user.js');

test('过滤词按行清理、去重并作标题子串匹配', () => {
  const { parseKeywords, matchingKeywords } = require(scriptPath);

  assert.deepEqual(parseKeywords(' AI \n\n抽奖\nai\nAI 助手 '), ['AI', '抽奖', 'AI 助手']);
  assert.deepEqual(parseKeywords(null), []);
  assert.deepEqual(matchingKeywords('OpenAI 抽奖活动', ['ai', '抽奖', '教程']), ['ai', '抽奖']);
  assert.deepEqual(matchingKeywords('', ['抽奖']), []);
});

test('草稿只更新预览，保存后过滤当前及新增帖子，清空后恢复', async () => {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const rowSelector = '.topic-list-item[data-topic-id]';
  const titleSelector = '.title.raw-topic-link[data-topic-id]';
  const hiddenClass = 'houmao-linux-do-topic-filter-hidden';

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
        '.houmao-linux-do-topic-filter-input': new Element('textarea'),
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

  const topic = (title) => {
    const classList = new ClassList();
    const anchor = title === null ? null : { textContent: title, href: `https://linux.do/t/${encodeURIComponent(title)}` };
    const row = {
      nodeType: 1,
      classList,
      closest: (selector) => selector === rowSelector ? row : null,
      querySelector: (selector) => selector === titleSelector ? anchor : null,
      querySelectorAll: () => [],
    };
    return row;
  };

  const alpha = topic('Alpha 发布说明');
  const beta = topic('Beta 使用指南');
  const untitled = topic(null);
  const topics = [alpha, beta, untitled];
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

  let stored = 'alpha\nALPHA';
  let menuCommand;
  const saved = [];
  const context = {
    document,
    MutationObserver,
    GM_getValue: () => stored,
    GM_setValue: (_key, value) => {
      stored = value;
      saved.push(value);
    },
    GM_registerMenuCommand: (_label, callback) => {
      menuCommand = callback;
    },
  };

  vm.runInNewContext(script, context);

  assert.equal(alpha.classList.contains(hiddenClass), true);
  assert.equal(beta.classList.contains(hiddenClass), false);
  assert.equal(untitled.classList.contains(hiddenClass), false);

  menuCommand();
  const dialog = body.children.find((child) => child.tagName === 'dialog');
  const input = dialog.querySelector('.houmao-linux-do-topic-filter-input');
  const status = dialog.querySelector('.houmao-linux-do-topic-filter-status');
  const preview = dialog.querySelector('.houmao-linux-do-topic-filter-preview');
  const save = dialog.querySelector('.houmao-linux-do-topic-filter-save');
  assert.equal(input.value, 'alpha');
  assert.equal(status.textContent, '当前页面将过滤 1 个帖子');
  assert.equal(preview.children[0].children[0].textContent, 'Alpha 发布说明');
  assert.equal(preview.children[0].children[1].textContent, '命中：alpha');

  input.value = 'beta';
  await input.dispatch('input');
  assert.equal(status.textContent, '当前页面将过滤 1 个帖子');
  assert.equal(preview.children[0].children[0].textContent, 'Beta 使用指南');
  assert.equal(preview.children[0].children[1].textContent, '命中：beta');
  assert.equal(alpha.classList.contains(hiddenClass), true);
  assert.equal(beta.classList.contains(hiddenClass), false);

  const newBeta = topic('另一个 Beta 帖子');
  topics.push(newBeta);
  observeCallback([{ addedNodes: [newBeta] }]);
  assert.equal(status.textContent, '当前页面将过滤 2 个帖子');
  assert.equal(newBeta.classList.contains(hiddenClass), false);

  dialog.close();
  assert.deepEqual(saved, []);
  menuCommand();
  assert.equal(input.value, 'alpha');

  input.value = 'beta';
  await save.dispatch('click');
  assert.deepEqual(saved, ['beta']);
  assert.equal(alpha.classList.contains(hiddenClass), false);
  assert.equal(beta.classList.contains(hiddenClass), true);
  assert.equal(newBeta.classList.contains(hiddenClass), true);

  const laterBeta = topic('稍后加载的 Beta 帖子');
  topics.push(laterBeta);
  observeCallback([{ addedNodes: [laterBeta] }]);
  assert.equal(laterBeta.classList.contains(hiddenClass), true);

  menuCommand();
  input.value = '';
  await save.dispatch('click');
  assert.equal(stored, '');
  assert.equal(beta.classList.contains(hiddenClass), false);
  assert.equal(newBeta.classList.contains(hiddenClass), false);
  assert.equal(laterBeta.classList.contains(hiddenClass), false);
});
