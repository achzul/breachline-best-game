// Keyboard and mouse state. `pressed` is an edge queue: wasPressed(code)
// consumes, so one physical press reaches exactly one consumer — the buy
// menu and the weapon slots never fight over the number keys, because only
// one of them polls per phase.

export const input = {
  keys: new Set(),
  pressed: new Set(),
  mouseDown: false,
  rmb: false,
  locked: false,
  dx: 0,
  dy: 0,
  _edge: false,

  init(target) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; this.rmb = false; });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouseDown = true; this._edge = true; }
      if (e.button === 2) this.rmb = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rmb = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === target;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
  },

  wasPressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  },

  takeMouse() {
    const d = { x: this.dx, y: this.dy };
    this.dx = 0; this.dy = 0;
    return d;
  },

  takeEdge() {
    const e = this._edge;
    this._edge = false;
    return e;
  },
};
