(function () {
  var cellEl = document.getElementById("cell");
  var cellRange = document.getElementById("cell-range");
  var colsEl = document.getElementById("cols");
  var rowsEl = document.getElementById("rows");
  var fillEl = document.getElementById("fill");
  var fillRange = document.getElementById("fill-range");
  var seedEl = document.getElementById("seed");
  var frameEl = document.getElementById("frame");
  var frameRange = document.getElementById("frame-range");
  var canvas = document.getElementById("board");
  var frameBox = document.getElementById("frame-box");
  var stage = document.getElementById("stage");
  var readout = document.getElementById("readout");
  var cellNote = document.getElementById("cell-note");
  var aspect = "1:1";
  var mode = "single";
  var photo = null;
  var playing = false;
  var playTimer = 0;
  var keys = [];
  var scrubbing = false;
  var wordmark = new Image();
  wordmark.onload = function () {
    var copy = document.createElement("canvas");
    copy.width = wordmark.naturalWidth;
    copy.height = wordmark.naturalHeight;
    copy.getContext("2d").drawImage(wordmark, 0, 0);
    wordmark.dataUrl = copy.toDataURL("image/png");
    render();
  };
  wordmark.src = "wordmark.png";
  var MARK = { x: 489, y: 26, size: 76, w: 1024, h: 130 };

  function clamp(n, min, max) {
    n = Math.round(Number(n));
    if (!isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function ratioOf(kind, cols, rows) {
    if (kind === "4:5") return [4, 5];
    if (kind === "16:9") return [16, 9];
    if (kind === "1:1") return [1, 1];
    return [Math.max(1, cols), Math.max(1, rows)];
  }

  function viewportCss() {
    var box = stage.getBoundingClientRect();
    var availW = Math.max(80, box.width);
    var availH = Math.max(80, box.height);
    var ratio = ratioOf(aspect, clamp(colsEl.value, 3, 80), clamp(rowsEl.value, 3, 80));
    var scale = Math.min(availW / ratio[0], availH / ratio[1]);
    return {
      w: Math.max(1, Math.floor(ratio[0] * scale)),
      h: Math.max(1, Math.floor(ratio[1] * scale))
    };
  }

  function cellCap(vp, cols, rows) {
    return Math.max(4, Math.floor(Math.min(vp.w / cols, vp.h / rows)));
  }

  function state() {
    var cols = clamp(colsEl.value, 3, 80);
    var rows = clamp(rowsEl.value, 3, 80);
    var vp = viewportCss();
    var cap = Math.min(64, cellCap(vp, cols, rows));
    var cell = clamp(cellEl.value, 4, cap);
    return {
      cell: cell,
      cap: cap,
      cols: cols,
      rows: rows,
      fill: clamp(fillEl.value, 0, 100),
      seed: clamp(seedEl.value, 0, 999999),
      frame: clamp(frameEl.value, 0, 100),
      mode: mode,
      avoid: document.getElementById("avoid").checked,
      grid: document.getElementById("show-grid").checked,
      crosses: document.getElementById("show-crosses").checked,
      dots: document.getElementById("show-dots").checked,
      bg: document.getElementById("show-bg").checked,
      clear: document.getElementById("transparent").checked,
      wordmark: document.getElementById("show-word").checked,
      image: document.getElementById("show-image").checked && !!photo,
      cross: document.getElementById("color-cross").value,
      dot: document.getElementById("color-dot").value,
      paper: document.getElementById("color-bg").value,
      vp: vp
    };
  }

  function hash01(x, y, seed) {
    var n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function crossCenters(s) {
    var list = [];
    if (s.mode === "repeat") {
      var y;
      var x;
      for (y = 1; y + 1 < s.rows; y += 3) {
        for (x = 1; x + 1 < s.cols; x += 3) list.push([x, y]);
      }
      return list;
    }
    return [[Math.floor((s.cols - 1) / 2), Math.floor((s.rows - 1) / 2)]];
  }

  function focalCenter(s) {
    var list = crossCenters(s);
    var best = list[0];
    var midX = (s.cols - 1) / 2;
    var midY = (s.rows - 1) / 2;
    list.forEach(function (c) {
      var d = Math.abs(c[0] - midX) + Math.abs(c[1] - midY);
      var db = Math.abs(best[0] - midX) + Math.abs(best[1] - midY);
      if (d < db) best = c;
    });
    return best;
  }

  function moduleCells(s) {
    var set = {};
    crossCenters(s).forEach(function (c) {
      var dy;
      var dx;
      for (dy = -1; dy <= 1; dy++) {
        for (dx = -1; dx <= 1; dx++) {
          var x = c[0] + dx;
          var y = c[1] + dy;
          if (x >= 0 && y >= 0 && x < s.cols && y < s.rows) set[x + "," + y] = true;
        }
      }
    });
    return set;
  }

  function plusCells(s) {
    var set = {};
    crossCenters(s).forEach(function (c) {
      [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (d) {
        var x = c[0] + d[0];
        var y = c[1] + d[1];
        if (x >= 0 && y >= 0 && x < s.cols && y < s.rows) set[x + "," + y] = true;
      });
    });
    return set;
  }

  function dotList(s, blocked) {
    var dots = [];
    if (!s.dots || s.fill <= 0) return dots;
    var y;
    var x;
    for (y = 0; y < s.rows; y++) {
      for (x = 0; x < s.cols; x++) {
        if (s.avoid && blocked[x + "," + y]) continue;
        var roll = (hash01(x, y, s.seed) + s.frame / 100) % 1;
        if (roll < s.fill / 100) dots.push([x, y]);
      }
    }
    return dots;
  }

  function layout(s, width, height) {
    var cell = Math.max(1, Math.floor(Math.min(width / s.cols, height / s.rows, s.cell * (width / s.vp.w))));
    var gridW = cell * s.cols;
    var gridH = cell * s.rows;
    return {
      cell: cell,
      ox: Math.floor((width - gridW) / 2),
      oy: Math.floor((height - gridH) / 2)
    };
  }

  function drawCover(ctx, image, w, h) {
    var scale = Math.max(w / image.width, h / image.height);
    var dw = image.width * scale;
    var dh = image.height * scale;
    ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function paint(target, s, opts) {
    var w = opts.w;
    var h = opts.h;
    var withImage = !!opts.withImage && photo;
    target.width = w;
    target.height = h;
    var ctx = target.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    var paperOn = s.bg && !s.clear;
    if (withImage) drawCover(ctx, photo, w, h);
    else if (paperOn) {
      ctx.fillStyle = s.paper;
      ctx.fillRect(0, 0, w, h);
    }
    var lay = layout(s, w, h);
    var blocked = moduleCells(s);
    var plus = plusCells(s);
    var dots = dotList(s, blocked);
    ctx.fillStyle = s.dot;
    dots.forEach(function (d) {
      ctx.fillRect(lay.ox + d[0] * lay.cell, lay.oy + d[1] * lay.cell, lay.cell, lay.cell);
    });
    if (s.crosses) {
      ctx.fillStyle = s.cross;
      Object.keys(plus).forEach(function (key) {
        var p = key.split(",");
        ctx.fillRect(lay.ox + Number(p[0]) * lay.cell, lay.oy + Number(p[1]) * lay.cell, lay.cell, lay.cell);
      });
    }
    if (s.grid) {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      var i;
      for (i = 0; i <= s.cols; i++) {
        var x = lay.ox + i * lay.cell + 0.5;
        ctx.moveTo(x, lay.oy);
        ctx.lineTo(x, lay.oy + s.rows * lay.cell);
      }
      for (i = 0; i <= s.rows; i++) {
        var y = lay.oy + i * lay.cell + 0.5;
        ctx.moveTo(lay.ox, y);
        ctx.lineTo(lay.ox + s.cols * lay.cell, y);
      }
      ctx.stroke();
    }
    if (s.wordmark && wordmark.complete && wordmark.naturalWidth) {
      var focal = focalCenter(s);
      var dest = lay.cell * 3;
      var scale = dest / MARK.size;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        wordmark,
        lay.ox + (focal[0] - 1) * lay.cell - MARK.x * scale,
        lay.oy + (focal[1] - 1) * lay.cell - MARK.y * scale,
        MARK.w * scale,
        MARK.h * scale
      );
      ctx.imageSmoothingEnabled = false;
    }
    return { lay: lay, plus: plus, dots: dots, blocked: blocked };
  }

  function snapshot() {
    var s = state();
    return {
      mode: s.mode, cols: s.cols, rows: s.rows, cell: s.cell, fill: s.fill,
      seed: s.seed, frame: s.frame, avoid: s.avoid, grid: s.grid, crosses: s.crosses,
      dots: s.dots, bg: s.bg, clear: s.clear, wordmark: s.wordmark,
      image: document.getElementById("show-image").checked,
      cross: s.cross, dot: s.dot, paper: s.paper, aspect: aspect
    };
  }

  function cloneState(snap) {
    var live = state();
    var s = Object.assign({}, snap);
    s.vp = live.vp;
    s.cap = live.cap;
    s.image = !!(snap.image && photo);
    return s;
  }

  function mixAt(u) {
    var x = Math.max(0, Math.min(0.9999, u)) * (keys.length - 1);
    var i = Math.min(keys.length - 2, Math.floor(x));
    return { a: cloneState(keys[i]), b: cloneState(keys[i + 1]), t: x - i };
  }

  function drawKeyList() {
    var list = document.getElementById("kf-list");
    list.innerHTML = "";
    keys.forEach(function (snap, index) {
      var li = document.createElement("li");
      var load = document.createElement("button");
      load.type = "button";
      load.className = "kf-load";
      load.textContent = String(index + 1) + "  " + snap.cols + "×" + snap.rows + "  " + snap.fill + "%";
      load.addEventListener("click", function () { recall(snap); });
      var del = document.createElement("button");
      del.type = "button";
      del.className = "kf-del";
      del.textContent = "×";
      del.addEventListener("click", function () {
        keys.splice(index, 1);
        drawKeyList();
      });
      li.appendChild(load);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  function recall(snap) {
    scrubbing = false;
    mode = snap.mode;
    aspect = snap.aspect;
    document.getElementById("mode-single").setAttribute("aria-pressed", mode === "single" ? "true" : "false");
    document.getElementById("mode-repeat").setAttribute("aria-pressed", mode === "repeat" ? "true" : "false");
    document.querySelectorAll("[data-aspect]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-aspect") === aspect ? "true" : "false");
    });
    colsEl.value = snap.cols;
    rowsEl.value = snap.rows;
    cellEl.value = snap.cell;
    fillEl.value = snap.fill;
    seedEl.value = snap.seed;
    frameEl.value = snap.frame;
    document.getElementById("avoid").checked = snap.avoid;
    document.getElementById("show-grid").checked = snap.grid;
    document.getElementById("show-crosses").checked = snap.crosses;
    document.getElementById("show-dots").checked = snap.dots;
    document.getElementById("show-bg").checked = snap.bg;
    document.getElementById("transparent").checked = snap.clear;
    document.getElementById("show-word").checked = snap.wordmark;
    document.getElementById("show-image").checked = snap.image && !!photo;
    document.getElementById("color-cross").value = snap.cross;
    document.getElementById("color-dot").value = snap.dot;
    document.getElementById("color-bg").value = snap.paper;
    render();
  }

  function paintBlend(target, a, b, t, opts) {
    paint(target, a, opts);
    if (t <= 0.001) return;
    var tmp = paintBlend.buffer || (paintBlend.buffer = document.createElement("canvas"));
    paint(tmp, b, opts);
    var ctx = target.getContext("2d");
    ctx.globalAlpha = t;
    ctx.drawImage(tmp, 0, 0);
    ctx.globalAlpha = 1;
  }

  function render() {
    var s = state();
    cellEl.value = s.cell;
    cellRange.value = s.cell;
    cellRange.max = String(s.cap);
    cellEl.max = String(s.cap);
    colsEl.value = s.cols;
    rowsEl.value = s.rows;
    fillEl.value = s.fill;
    fillRange.value = s.fill;
    seedEl.value = s.seed;
    frameEl.value = s.frame;
    frameRange.value = s.frame;
    canvas.style.width = s.vp.w + "px";
    canvas.style.height = s.vp.h + "px";
    frameBox.style.width = s.vp.w + "px";
    frameBox.style.height = s.vp.h + "px";
    var showPaper = s.bg && !s.clear;
    frameBox.classList.toggle("is-clear", !showPaper && !s.image);
    frameBox.style.backgroundColor = showPaper ? s.paper : "";
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var opts = {
      w: Math.round(s.vp.w * dpr),
      h: Math.round(s.vp.h * dpr),
      withImage: s.image
    };
    var drawn;
    if (scrubbing && keys.length >= 2) {
      var mix = mixAt(Number(document.getElementById("kf-scrub").value) / 1000);
      paintBlend(canvas, mix.a, mix.b, mix.t, opts);
      drawn = { lay: { cell: s.cell } };
    } else {
      drawn = paint(canvas, s, opts);
    }
    readout.textContent = aspect + "  ·  " + s.vp.w + "×" + s.vp.h + "  ·  CELL " + drawn.lay.cell;
    cellNote.textContent = "Fits the frame. Max " + s.cap + " px before the grid would leave the viewport.";
    document.getElementById("export-png-image").disabled = !photo;
    return { s: s, drawn: drawn };
  }

  function applyAspect(kind) {
    aspect = kind;
    document.querySelectorAll("[data-aspect]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-aspect") === kind ? "true" : "false");
    });
    if (kind !== "custom") {
      var cols = clamp(colsEl.value, 3, 80);
      var ratio = ratioOf(kind, cols, cols);
      var rows = Math.max(3, Math.round(cols * ratio[1] / ratio[0]));
      rows = Math.min(80, rows);
      if (mode === "repeat") {
        cols = Math.max(3, Math.round(cols / 3) * 3);
        rows = Math.max(3, Math.round(rows / 3) * 3);
      }
      colsEl.value = cols;
      rowsEl.value = rows;
    }
    render();
  }

  function setMode(next) {
    mode = next;
    document.getElementById("mode-single").setAttribute("aria-pressed", next === "single" ? "true" : "false");
    document.getElementById("mode-repeat").setAttribute("aria-pressed", next === "repeat" ? "true" : "false");
    if (next === "repeat") {
      colsEl.value = Math.max(3, Math.round(clamp(colsEl.value, 3, 80) / 3) * 3);
      rowsEl.value = Math.max(3, Math.round(clamp(rowsEl.value, 3, 80) / 3) * 3);
    }
    render();
  }

  function bindPair(a, b) {
    a.addEventListener("input", function () {
      b.value = a.value;
      render();
    });
  }

  bindPair(cellEl, cellRange);
  bindPair(cellRange, cellEl);
  bindPair(fillEl, fillRange);
  bindPair(fillRange, fillEl);
  bindPair(frameEl, frameRange);
  bindPair(frameRange, frameEl);

  colsEl.addEventListener("input", function () {
    if (aspect !== "custom") applyAspect(aspect);
    else render();
  });
  rowsEl.addEventListener("input", function () {
    aspect = "custom";
    document.querySelectorAll("[data-aspect]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-aspect") === "custom" ? "true" : "false");
    });
    render();
  });

  ["seed", "avoid", "show-grid", "show-crosses", "show-dots", "show-bg", "transparent", "show-word", "show-image", "color-cross", "color-dot", "color-bg"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", function () { scrubbing = false; render(); });
    document.getElementById(id).addEventListener("change", function () { scrubbing = false; render(); });
  });

  document.getElementById("mode-single").addEventListener("click", function () { setMode("single"); });
  document.getElementById("mode-repeat").addEventListener("click", function () { setMode("repeat"); });
  document.querySelectorAll("[data-aspect]").forEach(function (btn) {
    btn.addEventListener("click", function () { applyAspect(btn.getAttribute("data-aspect")); });
  });
  document.getElementById("reroll").addEventListener("click", function () {
    seedEl.value = Math.floor(Math.random() * 1000000);
    render();
  });

  document.getElementById("play").addEventListener("click", function () {
    playing = !playing;
    this.setAttribute("aria-pressed", playing ? "true" : "false");
    this.textContent = playing ? "PAUSE" : "PLAY";
    clearInterval(playTimer);
    if (!playing) return;
    if (keys.length >= 2) {
      scrubbing = true;
      var scrub = document.getElementById("kf-scrub");
      playTimer = setInterval(function () {
        var next = Number(scrub.value) + 12;
        if (next > 1000) next = 0;
        scrub.value = String(next);
        render();
      }, 80);
      return;
    }
    playTimer = setInterval(function () {
      frameEl.value = (clamp(frameEl.value, 0, 100) + 1) % 101;
      render();
    }, 80);
  });

  document.getElementById("kf-add").addEventListener("click", function () {
    scrubbing = false;
    keys.push(snapshot());
    drawKeyList();
  });
  document.getElementById("kf-scrub").addEventListener("input", function () {
    scrubbing = keys.length >= 2;
    render();
  });

  document.getElementById("image-file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var img = new Image();
    img.onload = function () {
      photo = img;
      document.getElementById("show-image").checked = true;
      render();
    };
    img.src = URL.createObjectURL(file);
  });
  document.getElementById("image-clear").addEventListener("click", function () {
    photo = null;
    document.getElementById("show-image").checked = false;
    document.getElementById("image-file").value = "";
    render();
  });

  function download(filename, href) {
    var a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function exportViewport(withImage) {
    var s = state();
    var longEdge = 1600;
    var ratio = ratioOf(aspect, s.cols, s.rows);
    var scale = longEdge / Math.max(ratio[0], ratio[1]);
    var w = Math.round(ratio[0] * scale);
    var h = Math.round(ratio[1] * scale);
    var board = document.createElement("canvas");
    paint(board, s, { w: w, h: h, withImage: withImage });
    download(
      "rhynova-" + aspect.replace(":", "x") + (withImage ? "-image" : "") + ".png",
      board.toDataURL("image/png")
    );
  }

  document.getElementById("export-png").addEventListener("click", function () { exportViewport(false); });
  document.getElementById("export-png-image").addEventListener("click", function () {
    if (photo) exportViewport(true);
  });

  document.getElementById("export-svg").addEventListener("click", function () {
    var s = state();
    var cell = s.cell;
    var w = s.cols * cell;
    var h = s.rows * cell;
    var blocked = moduleCells(s);
    var plus = plusCells(s);
    var dots = dotList(s, blocked);
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" shape-rendering="crispEdges">');
    if (s.bg && !s.clear) parts.push('<rect width="100%" height="100%" fill="' + s.paper + '"/>');
    dots.forEach(function (d) {
      parts.push('<rect x="' + (d[0] * cell) + '" y="' + (d[1] * cell) + '" width="' + cell + '" height="' + cell + '" fill="' + s.dot + '"/>');
    });
    if (s.crosses) Object.keys(plus).forEach(function (key) {
      var p = key.split(",");
      parts.push('<rect x="' + (Number(p[0]) * cell) + '" y="' + (Number(p[1]) * cell) + '" width="' + cell + '" height="' + cell + '" fill="' + s.cross + '"/>');
    });
    if (s.wordmark && wordmark.dataUrl) {
      var focal = focalCenter(s);
      var dest = cell * 3;
      var markScale = dest / MARK.size;
      parts.push('<image href="' + wordmark.dataUrl + '" x="' + ((focal[0] - 1) * cell - MARK.x * markScale) + '" y="' + ((focal[1] - 1) * cell - MARK.y * markScale) + '" width="' + (MARK.w * markScale) + '" height="' + (MARK.h * markScale) + '"/>');
    }
    parts.push("</svg>");
    var blob = new Blob([parts.join("")], { type: "image/svg+xml" });
    var url = URL.createObjectURL(blob);
    download("rhynova.svg", url);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  });

  function crc32(bytes) {
    if (!crc32.table) {
      var table = new Uint32Array(256);
      var n;
      var k;
      for (n = 0; n < 256; n++) {
        var c = n;
        for (k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
      }
      crc32.table = table;
    }
    var crc = 0xffffffff;
    var i;
    for (i = 0; i < bytes.length; i++) crc = crc32.table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function pngChunk(type, data) {
    var out = new Uint8Array(12 + data.length);
    var view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    var t;
    for (t = 0; t < 4; t++) out[4 + t] = type.charCodeAt(t);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  function pngParts(bytes) {
    var parts = [];
    var i = 8;
    while (i + 8 <= bytes.length) {
      var len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
      var type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      parts.push({ type: type, data: bytes.slice(i + 8, i + 8 + len) });
      i += 12 + len;
    }
    return parts;
  }

  function apngBlob(frames, rate) {
    var first = pngParts(frames[0]);
    var ihdr = first.filter(function (p) { return p.type === "IHDR"; })[0].data;
    var view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
    var w = view.getUint32(0);
    var h = view.getUint32(4);
    var chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr)];
    var ac = new Uint8Array(8);
    var acv = new DataView(ac.buffer);
    acv.setUint32(0, frames.length);
    acv.setUint32(4, 0);
    chunks.push(pngChunk("acTL", ac));
    var seq = 0;
    var delay = Math.max(1, Math.round(100 / rate));
    frames.forEach(function (frame, index) {
      var parts = index === 0 ? first : pngParts(frame);
      var fc = new Uint8Array(26);
      var fv = new DataView(fc.buffer);
      fv.setUint32(0, seq++);
      fv.setUint32(4, w);
      fv.setUint32(8, h);
      fv.setUint16(20, delay);
      fv.setUint16(22, 100);
      chunks.push(pngChunk("fcTL", fc));
      parts.forEach(function (p) {
        if (p.type !== "IDAT") return;
        if (index === 0) chunks.push(pngChunk("IDAT", p.data));
        else {
          var fd = new Uint8Array(4 + p.data.length);
          new DataView(fd.buffer).setUint32(0, seq++);
          fd.set(p.data, 4);
          chunks.push(pngChunk("fdAT", fd));
        }
      });
    });
    chunks.push(pngChunk("IEND", new Uint8Array(0)));
    return new Blob(chunks, { type: "image/png" });
  }

  function pngBytes(url) {
    var bin = atob(url.split(",")[1]);
    var bytes = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  document.getElementById("export-video").addEventListener("click", async function () {
    var btn = this;
    var note = document.getElementById("export-note");
    btn.disabled = true;
    var seconds = clamp(document.getElementById("kf-len").value, 1, 8);
    var fps = 12;
    var count = seconds * fps;
    var live = state();
    var ratio = ratioOf(aspect, live.cols, live.rows);
    var edge = 720;
    var fit = edge / Math.max(ratio[0], ratio[1]);
    var w = Math.round(ratio[0] * fit);
    var h = Math.round(ratio[1] * fit);
    if (w % 2) w += 1;
    if (h % 2) h += 1;
    var board = document.createElement("canvas");
    var alpha = live.clear || !live.bg;
    try {
      note.textContent = "LOADING ENCODER";
      var frames = [];
      var i;
      for (i = 0; i < count; i++) {
        note.textContent = "FRAME " + (i + 1) + " / " + count;
        var u = count === 1 ? 0 : i / (count - 1);
        if (keys.length >= 2) {
          var mix = mixAt(u);
          alpha = alpha || mix.a.clear || !mix.a.bg || mix.b.clear || !mix.b.bg;
          paintBlend(board, mix.a, mix.b, mix.t, { w: w, h: h, withImage: mix.a.image || mix.b.image });
        } else {
          var frameState = Object.assign({}, live, { frame: Math.round(u * 100) });
          alpha = alpha || frameState.clear || !frameState.bg;
          paint(board, frameState, { w: w, h: h, withImage: frameState.image });
        }
        frames.push(pngBytes(board.toDataURL("image/png")));
      }
      var saved = false;
      try {
        var ffmpegMod = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
        var utilMod = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js");
        var ffmpeg = new ffmpegMod.FFmpeg();
        var base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
        var worker = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js";
        var loaded = ffmpeg.load({
          classWorkerURL: await utilMod.toBlobURL(worker, "text/javascript"),
          coreURL: await utilMod.toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
          wasmURL: await utilMod.toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm")
        });
        var timeout = new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error("encoder timed out")); }, 20000);
        });
        await Promise.race([loaded, timeout]);
        note.textContent = "ENCODING";
        for (i = 0; i < frames.length; i++) {
          await ffmpeg.writeFile("f" + String(i + 1).padStart(4, "0") + ".png", frames[i]);
        }
        var outName = alpha ? "rhynova.mov" : "rhynova.mp4";
        var args = alpha
          ? ["-framerate", String(fps), "-i", "f%04d.png", "-c:v", "qtrle", "-pix_fmt", "argb", outName]
          : ["-framerate", String(fps), "-i", "f%04d.png", "-c:v", "mpeg4", "-q:v", "4", "-pix_fmt", "yuv420p", outName];
        await ffmpeg.exec(args);
        var data = await ffmpeg.readFile(outName);
        var blob = new Blob([new Uint8Array(data)], { type: alpha ? "video/quicktime" : "video/mp4" });
        download(outName, URL.createObjectURL(blob));
        note.textContent = alpha
          ? "Saved a QuickTime movie with alpha. H.264 MP4 cannot store transparency."
          : "Saved an MP4. Turn transparent on for an alpha movie.";
        saved = true;
      } catch (err) {
        saved = false;
      }
      if (!saved) {
        download(alpha ? "rhynova-alpha.png" : "rhynova.png", URL.createObjectURL(apngBlob(frames, fps)));
        note.textContent = alpha
          ? "Saved an animated PNG with alpha. The MP4 encoder did not load in this browser, and H.264 cannot store transparency."
          : "Saved an animated PNG. The MP4 encoder did not load in this browser.";
      }
    } catch (err) {
      note.textContent = "Video export failed. " + (err && err.message ? err.message : "Encoder unavailable.");
    }
    btn.disabled = false;
  });

  window.addEventListener("resize", render);
  render();
})();
