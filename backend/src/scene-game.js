/* Local table game: visual interaction only. Never grants a portal session or QR challenge. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLS = 8;
  const ROWS = 8;
  const MINES = 10;
  const rowY = [389, 414, 442, 472, 505, 543, 585, 635, 695];
  const topY = [384, 386, 387, 388, 389, 387, 387, 386, 386];
  const bottomY = [696, 694, 693, 692, 692, 693, 695, 698, 700];
  const columnsX = [
    [542, 613, 683, 754, 827, 899, 971, 1050, 1118],
    [526, 600, 675, 750, 826, 903, 978, 1061, 1132],
    [510, 589, 667, 746, 826, 906, 985, 1071, 1147],
    [493, 577, 659, 742, 825, 909, 993, 1081, 1162],
    [474, 563, 650, 738, 825, 913, 1001, 1092, 1179],
    [452, 548, 640, 733, 825, 918, 1010, 1105, 1199],
    [429, 531, 629, 727, 824, 922, 1021, 1120, 1221],
    [400, 511, 616, 720, 824, 928, 1033, 1137, 1247],
    [369, 487, 600, 712, 823, 935, 1048, 1158, 1282],
  ];
  const style = `
    .scene-game-layer{position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;overflow:visible}
    .scene-game-layer .game-tile{fill:transparent;stroke:transparent;pointer-events:all;touch-action:none;cursor:default;-webkit-tap-highlight-color:transparent}
    .scene-game-layer .game-tile.revealed:not(.mine){fill:url(#game-recess);animation:game-sink .38s ease-out both}
    .scene-game-layer .game-tile.mine{fill:#7d303b77}
    .scene-game-layer .game-tile:focus{outline:none}
    .scene-game-layer .game-tile:focus-visible{stroke:#f5d18c;stroke-width:2}
    .scene-game-layer .game-number{fill:#e9d7a9;filter:drop-shadow(1px 2px 1px #1a130f);font-family:Georgia,'Times New Roman',serif;font-weight:700;paint-order:stroke fill;pointer-events:none;stroke:#513b28;stroke-linejoin:round;stroke-width:1.7;text-anchor:middle}
    .scene-game-layer .game-number[data-count="1"]{fill:#e8e1c5}.scene-game-layer .game-number[data-count="2"]{fill:#b8dacb}.scene-game-layer .game-number[data-count="3"]{fill:#f0cf90}.scene-game-layer .game-number[data-count="4"]{fill:#e5ac81}.scene-game-layer .game-flag{fill:#ffd992;font-size:21px;pointer-events:none;text-anchor:middle}.scene-game-layer .game-mine{font-size:23px;pointer-events:none;text-anchor:middle}
    .scene-game-layer .game-effect{pointer-events:none}.scene-game-layer .game-blast{fill:#fff4b5;filter:drop-shadow(0 0 15px #ff8b29);animation:game-blast .75s ease-out forwards;transform-box:fill-box;transform-origin:center}
    .scene-game-layer .game-sweep{fill:#f8e2a6;opacity:0;animation:game-sweep 1.25s ease-in-out both}.scene-game-layer .game-aura{fill:url(#game-aura);opacity:0;animation:game-appear 1.2s ease-out .6s forwards}.scene-game-layer .game-wave{fill:none;stroke:#e9d5a3;stroke-width:2;opacity:0;transform-box:fill-box;transform-origin:center;animation:game-wave 1.55s ease-out both}
    .scene-game-layer .game-orbit{fill:none;stroke:#7fd5df;stroke-width:1.3;opacity:0;animation:game-appear 1s ease-out 1.6s forwards}.scene-game-layer .game-orbit.outer{stroke:#d2b676;stroke-dasharray:3 8}.scene-game-layer .game-orbit.inner{stroke:#d7bd83;stroke-dasharray:2 6}.scene-game-layer .game-planet,.scene-game-layer .game-node{filter:drop-shadow(0 0 6px #54e7ff);opacity:0;animation:game-appear .6s ease-out 1.5s forwards}.scene-game-layer .game-z{fill:url(#game-gold);filter:drop-shadow(1px 2px 3px #081a29) drop-shadow(0 0 8px #bdeaf0);font-family:Georgia,'Times New Roman',serif;font-size:81px;font-style:italic;letter-spacing:-7px;stroke:#6a5d42;stroke-width:.8;paint-order:stroke fill;text-anchor:middle;opacity:0;animation:game-appear 1s ease-out 1.5s forwards}
    @keyframes game-sink{from{fill-opacity:0}to{fill-opacity:1}}@keyframes game-blast{0%{opacity:0;transform:scale(.2)}25%{opacity:1}100%{opacity:0;transform:scale(2.4)}}@keyframes game-sweep{0%{opacity:0}34%{opacity:.72}62%{opacity:.42}100%{opacity:0}}@keyframes game-appear{from{opacity:0}to{opacity:1}}@keyframes game-wave{0%{opacity:0;transform:scale(.15);stroke-width:6}25%{opacity:.85}100%{opacity:0;transform:scale(5.5);stroke-width:.5}}
    @media(prefers-reduced-motion:reduce){.scene-game-layer .game-tile.revealed:not(.mine){animation:none}.scene-game-layer .game-blast,.scene-game-layer .game-sweep,.scene-game-layer .game-wave{display:none}.scene-game-layer .game-aura,.scene-game-layer .game-orbit,.scene-game-layer .game-planet,.scene-game-layer .game-node,.scene-game-layer .game-z{animation:none;opacity:1}}
  `;
  function element(name, attrs = {}) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function seamY(row, column) { return row === 0 ? topY[column] : row === ROWS ? bottomY[column] : rowY[row]; }
  function corners(column, row) {
    return [[columnsX[row][column], seamY(row, column)],
      [columnsX[row][column + 1], seamY(row, column + 1)],
      [columnsX[row + 1][column + 1], seamY(row + 1, column + 1)],
      [columnsX[row + 1][column], seamY(row + 1, column)]];
  }
  function center(index) {
    const points = corners(index % COLS, Math.floor(index / COLS));
    return [points.reduce((sum, point) => sum + point[0], 0) / 4,
      points.reduce((sum, point) => sum + point[1], 0) / 4];
  }
  function around(index) {
    const result = [];
    const x = index % COLS;
    const y = Math.floor(index / COLS);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < COLS && yy >= 0 && yy < ROWS) result.push(yy * COLS + xx);
      }
    }
    return result;
  }
  function installStyle() {
    if (document.getElementById('scene-game-style')) return;
    const sheet = document.createElement('style');
    sheet.id = 'scene-game-style';
    sheet.textContent = style;
    document.head.append(sheet);
  }
  function mount(svg, onUpdate = () => {}) {
    if (!svg || svg.namespaceURI !== NS) throw new Error('Scene game requires an SVG layer');
    installStyle();
    svg.setAttribute('class', 'scene-game-layer');
    svg.setAttribute('viewBox', '0 0 1672 941');
    svg.setAttribute('aria-label', 'Interactive table puzzle');
    let cells;
    let firstMove;
    let finished;
    let safeMoves;
    let revealedCount;
    let won;
    let destroyed = false;
    let suppressUntil = 0;
    const activePointers = new Map();
    const pressTimers = new Map();
    const shapes = [];
    const labels = [];
    function cancelPresses() {
      for (const timer of pressTimers.values()) clearTimeout(timer);
      pressTimers.clear();
    }
    function endPointer(event) {
      activePointers.delete(event.pointerId);
      const timer = pressTimers.get(event.pointerId);
      if (timer) clearTimeout(timer);
      pressTimers.delete(event.pointerId);
    }
    window.addEventListener('pointerup', endPointer, true);
    window.addEventListener('pointercancel', endPointer, true);
    function update() { onUpdate({ safeMoves, revealedCount, finished, won }); }
    function render() {
      cells.forEach((cell, index) => {
        const shape = shapes[index];
        const label = labels[index];
        shape.setAttribute('class', 'game-tile' + (cell.revealed ? ' revealed' : '') +
          (cell.revealed && cell.mine ? ' mine' : ''));
        label.textContent = cell.revealed && cell.mine ? '💣' : cell.flagged ? '◆' :
          cell.revealed && cell.adjacent ? String(cell.adjacent) : '';
        label.setAttribute('class', cell.revealed && cell.mine ? 'game-mine' : cell.flagged ? 'game-flag' : 'game-number');
        label.dataset.count = String(cell.adjacent);
        shape.setAttribute('aria-label', `Row ${Math.floor(index / COLS) + 1}, column ${index % COLS + 1}: ` +
          (cell.flagged ? 'marked' : cell.revealed ? cell.mine ? 'mine' : `${cell.adjacent} nearby mines` : 'hidden'));
      });
      update();
    }
    function placeMines(first) {
      const excluded = new Set([first, ...around(first)]);
      const eligible = cells.map((_, index) => index).filter((index) => !excluded.has(index));
      for (let i = eligible.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
      }
      eligible.slice(0, MINES).forEach((index) => { cells[index].mine = true; });
      cells.forEach((cell, index) => { cell.adjacent = around(index).filter((other) => cells[other].mine).length; });
    }
    function blast(index) {
      const [x, y] = center(index);
      const node = element('circle', { class: 'game-effect game-blast', cx: x, cy: y, r: 23 });
      svg.append(node);
      setTimeout(() => node.remove(), 900);
    }
    function winEffect() {
      const group = element('g', { class: 'game-effect' });
      const defs = element('defs');
      const aura = element('radialGradient', { id: 'game-aura' });
      for (const [offset, color, opacity] of [['0%', '#72d9e8', '.34'], ['65%', '#183b5b', '.17'], ['100%', '#183b5b', '0']])
        aura.append(element('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
      const gold = element('linearGradient', { id: 'game-gold', x2: '0%', y2: '100%' });
      for (const [offset, color] of [['0%', '#fff4ce'], ['40%', '#cfab65'], ['70%', '#f3dfae'], ['100%', '#81613d']])
        gold.append(element('stop', { offset, 'stop-color': color }));
      defs.append(aura, gold);
      group.append(defs);
      const origin = [columnsX[4][4], (rowY[4] + rowY[5]) / 2];
      group.append(element('ellipse', { class: 'game-aura', cx: origin[0], cy: origin[1], rx: 300, ry: 112 }));
      for (let index = 0; index < cells.length; index++) {
        const x = index % COLS;
        const y = Math.floor(index / COLS);
        const tile = element('polygon', { class: 'game-sweep', points: corners(x, y).map((point) => point.join(',')).join(' ') });
        tile.setAttribute('style', `animation-delay:${(.08 + Math.hypot(x - 3.5, y - 3.5) * .14).toFixed(2)}s`);
        group.append(tile);
      }
      for (let i = 0; i < 2; i++) {
        const wave = element('ellipse', { class: 'game-wave', cx: origin[0], cy: origin[1], rx: 45, ry: 17 });
        wave.setAttribute('style', `animation-delay:${.45 + i * .4}s`);
        group.append(wave);
      }
      for (const [i, index] of [2, 5, 9, 14, 19, 22, 27, 35, 39, 44, 49, 53, 58, 61].entries()) {
        const [x, y] = center(index);
        const point = element('circle', { class: 'game-node', cx: x, cy: y, r: i % 3 ? 1.6 : 2.8 });
        point.setAttribute('style', `animation-delay:${.55 + i * .07}s`);
        group.append(point);
      }
      for (const [rx, ry, radius, color, seconds, phase, kind] of [
        [215, 61, 6, '#e1b87b', 13, -4, 'outer'],
        [153, 43, 7, '#8fd8e4', 9, -2, 'middle'],
        [95, 27, 4, '#fff0c2', 6, -5, 'inner'],
      ]) {
        group.append(element('ellipse', { class: `game-orbit ${kind}`, cx: origin[0], cy: origin[1], rx, ry }));
        const planet = element('g', { class: 'game-planet' });
        planet.append(element('circle', { cx: origin[0] + rx, cy: origin[1], r: radius, fill: color, stroke: '#fff1ce', 'stroke-width': .9 }));
        planet.append(element('animateMotion', { dur: `${seconds}s`, begin: `${phase}s`, repeatCount: 'indefinite',
          path: `M 0 0 A ${rx} ${ry} 0 1 1 ${-2 * rx} 0 A ${rx} ${ry} 0 1 1 0 0` }));
        group.append(planet);
      }
      const mark = element('text', { class: 'game-z', x: origin[0], y: origin[1] + 30 });
      mark.textContent = 'Z';
      group.append(mark);
      svg.append(group);
    }
    function reveal(index) {
      const cell = cells[index];
      if (destroyed) return;
      if (finished) { reset(); return; }
      if (cell.flagged || cell.revealed) return;
      if (firstMove) { placeMines(index); firstMove = false; }
      safeMoves++;
      if (cell.mine) {
        cells.forEach((candidate) => { if (candidate.mine) candidate.revealed = true; });
        finished = true;
        won = false;
        render();
        blast(index);
        return;
      }
      const queue = [index];
      while (queue.length) {
        const current = queue.pop();
        const candidate = cells[current];
        if (candidate.revealed || candidate.flagged || candidate.mine) continue;
        candidate.revealed = true;
        revealedCount++;
        if (!candidate.adjacent) queue.push(...around(current));
      }
      if (revealedCount === COLS * ROWS - MINES) {
        finished = true;
        won = true;
        render();
        winEffect();
      } else render();
    }
    function mark(index) {
      const cell = cells[index];
      if (destroyed || finished || cell.revealed) return;
      cell.flagged = !cell.flagged;
      render();
    }
    function reset() {
      if (destroyed) return;
      cancelPresses();
      activePointers.clear();
      svg.replaceChildren();
      shapes.length = 0;
      labels.length = 0;
      cells = Array.from({ length: COLS * ROWS }, () => ({ mine: false, adjacent: 0, revealed: false, flagged: false }));
      firstMove = true;
      finished = false;
      safeMoves = 0;
      revealedCount = 0;
      won = false;
      const defs = element('defs');
      const recess = element('linearGradient', { id: 'game-recess', x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
      for (const [offset, color, opacity] of [['0%', '#211b17', '.43'], ['35%', '#3b3028', '.34'], ['82%', '#594a3b', '.27'], ['100%', '#a8875f', '.17']])
        recess.append(element('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
      defs.append(recess);
      svg.append(defs);
      for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLS; column++) {
        const index = row * COLS + column;
        const [x, y] = center(index);
        const size = 16 + row * 1.45;
        const group = element('g');
        const shape = element('polygon', { points: corners(column, row).map((point) => point.join(',')).join(' '), tabindex: 0, role: 'button' });
        const label = element('text', { x, y: y + size * .32, style: `font-size:${size}px` });
        shapes.push(shape);
        labels.push(label);
        group.append(shape, label);
        svg.append(group);
        shape.addEventListener('pointerdown', (event) => {
          activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (activePointers.size > 1) {
            suppressUntil = performance.now() + 700;
            cancelPresses();
          } else if (event.pointerType === 'touch') {
            pressTimers.set(event.pointerId, setTimeout(() => {
              mark(index);
              suppressUntil = performance.now() + 700;
              pressTimers.delete(event.pointerId);
            }, 550));
          }
        });
        shape.addEventListener('pointermove', (event) => {
          const start = activePointers.get(event.pointerId);
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) {
            suppressUntil = performance.now() + 700;
            cancelPresses();
          }
        });
        shape.addEventListener('pointerleave', cancelPresses);
        shape.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); mark(index); });
        shape.addEventListener('click', (event) => { event.stopPropagation(); if (performance.now() >= suppressUntil) reveal(index); });
        shape.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); reveal(index); }
          if (event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); mark(index); }
        });
      }
      render();
    }
    reset();
    return { reset, destroy() {
      destroyed = true;
      cancelPresses();
      window.removeEventListener('pointerup', endPointer, true);
      window.removeEventListener('pointercancel', endPointer, true);
      svg.replaceChildren();
    }, status() { return { safeMoves, revealedCount, finished, won }; } };
  }
  globalThis.SceneGame = Object.freeze({ mount, backgroundId: 'future-minesweeper-v1' });
})();
