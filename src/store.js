// Tiny JSON file store with debounced writes.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, defaults) {
    this.file = file;
    this.timer = null;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    this.data = { ...defaults, ...data };
  }
  get(k) { return this.data[k]; }
  set(patch) { Object.assign(this.data, patch); this.save(); return this.data; }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch {}
  }
}

module.exports = Store;
