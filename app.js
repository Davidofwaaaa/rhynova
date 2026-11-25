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
  var stage = document.getElementById("stage");
  var readout = document.getElementById("readout");
  var cellNote = document.getElementById("cell-note");
  var aspect = "1:1";
  var mode = "single";
  var photo = null;
  var playing = false;
  var playTimer = 0;

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
    if (withImage) drawCover(ctx, photo, w, h);
    else if (s.bg) {
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
    return { lay: lay, plus: plus, dots: dots, blocked: blocked };
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
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var drawn = paint(canvas, s, {
      w: Math.round(s.vp.w * dpr),
      h: Math.round(s.vp.h * dpr),
      withImage: s.image
    });
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

  ["seed", "avoid", "show-grid", "show-crosses", "show-dots", "show-bg", "show-image", "color-cross", "color-dot", "color-bg"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", render);
    document.getElementById(id).addEventListener("change", render);
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
    playTimer = setInterval(function () {
      frameEl.value = (clamp(frameEl.value, 0, 100) + 1) % 101;
      render();
    }, 80);
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
    if (s.bg) parts.push('<rect width="100%" height="100%" fill="' + s.paper + '"/>');
    dots.forEach(function (d) {
      parts.push('<rect x="' + (d[0] * cell) + '" y="' + (d[1] * cell) + '" width="' + cell + '" height="' + cell + '" fill="' + s.dot + '"/>');
    });
    if (s.crosses) Object.keys(plus).forEach(function (key) {
      var p = key.split(",");
      parts.push('<rect x="' + (Number(p[0]) * cell) + '" y="' + (Number(p[1]) * cell) + '" width="' + cell + '" height="' + cell + '" fill="' + s.cross + '"/>');
    });
    parts.push("</svg>");
    var blob = new Blob([parts.join("")], { type: "image/svg+xml" });
    var url = URL.createObjectURL(blob);
    download("rhynova.svg", url);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  });

  window.addEventListener("resize", render);
  render();
})();
