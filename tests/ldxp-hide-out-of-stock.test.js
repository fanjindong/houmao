const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts/ldxp-hide-out-of-stock.user.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const fixtureDir = path.join(__dirname, 'fixtures/ldxp-hide-out-of-stock');
const pages = fs.readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.html'))
  .map((name) => fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
const masonryPage = pages.find((page) => page.includes('class="goods_item'));
const groupedPage = pages.find((page) => page.includes('class="goods-group-item'));

test('两种真实页面的缺货契约保持稳定', () => {
  assert.equal(masonryPage?.match(/class="goods_item\b/g)?.length, 20);
  assert.equal(masonryPage?.match(/class="stock rank0\b/g)?.length, 16);
  assert.equal(groupedPage?.match(/class="goods-group-item\b/g)?.length, 2);
  assert.equal(groupedPage?.match(/class="stock rank0\b/g)?.length, 2);
  assert.match(script, /@version\s+0\.1\.3/);
  assert.match(script, /:is\(\.goods_item, \.goods-group-item\):has\(\.stock\.rank0\)/);
  assert.match(script, /\[item-selector="\.goods_item"\] \{[\s\S]*display: flex !important/);
  assert.match(script, /position: static !important/);
  assert.match(script, /transform: none !important/);
  assert.doesNotMatch(script, /\[item-selector="\.goods_item"\]:has/);
});

test('按钮位于商品列表尾部，点击后展示全部且不再出现', () => {
  class ClassList {
    constructor() {
      this.values = new Set();
    }

    add(value) {
      this.values.add(value);
    }

    contains(value) {
      return this.values.has(value);
    }
  }

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.classList = new ClassList();
      this.listeners = {};
      this.parentElement = null;
      this.hasOutOfStock = false;
    }

    appendChild(child) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }

    querySelector(selector) {
      if (selector === ':is(.goods_item, .goods-group-item) .stock.rank0') return this.hasOutOfStock ? {} : null;
      if (selector.startsWith(':scope > .')) {
        const className = selector.slice(':scope > .'.length);
        return this.children.find((child) => child.className === className) || null;
      }
      return null;
    }

    get lastElementChild() {
      return this.children.at(-1) || null;
    }
  }

  const root = new Element('html');
  const list = new Element('div');
  const grid = new Element('div');
  list.hasOutOfStock = true;
  list.appendChild(grid);
  const observers = [];
  const document = {
    documentElement: root,
    createElement: (tagName) => new Element(tagName),
    querySelectorAll: (selector) => {
      assert.equal(selector, '.goods_content ._index .list, .goods-group-content');
      return [list];
    },
  };

  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe() {}
  }

  vm.runInNewContext(script, { document, MutationObserver });

  const button = list.lastElementChild;
  assert.equal(button.tagName, 'button');
  assert.equal(button.type, 'button');
  assert.equal(button.textContent, '显示所有缺货商品');

  grid.appendChild(new Element('div'));
  observers[0].callback();
  assert.equal(list.lastElementChild, button);

  button.listeners.click();
  assert.equal(root.classList.contains('houmao-show-out-of-stock'), true);
  assert.equal(button.parentElement, null);

  observers[0].callback();
  assert.equal(list.children.some((child) => child.className === 'houmao-show-out-of-stock-button'), false);
});
