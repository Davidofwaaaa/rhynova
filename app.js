(function () {
  var cellEl = document.getElementById("cell");
  var cellRange = document.getElementById("cell-range");
  var colsEl = document.getElementById("cols");
  var rowsEl = document.getElementById("rows");
  var fillEl = document.getElementById("fill");
  var fillRange = document.getElementById("fill-range");
  var seedEl = document.getElementById("seed");
  var canvas = document.getElementById("board");
  var stage = document.getElementById("stage");
  var readout = document.getElementById("readout");
  var aspect = "1:1";
  var mode = "single";

  function clamp(n, min, max) {
    n = Math.round(Number(n));
    if (!isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function state() {
    return {
      cell: clamp(cellEl.value, 4, 80),
      cols: clamp(colsEl.value, 3, 120),
      rows: clamp(rowsEl.value, 3, 120),
      fill: clamp(fillEl.value, 0, 100),
      seed: clamp(seedEl.value, 0, 999999),
      mode: mode,
      avoid: document.getElementById("avoid").checked,
      grid: document.getElementById("show-grid").checked,
      crosses: document.getElementById("show-crosses").checked,
      dots: document.getElementById("show-dots").checked,
      bg: document.getElementById("show-bg").checked,
      cross: document.getElementById("color-cross").value,
      dot: document.getElementById("color-dot").value,
      paper: document.getElementById("color-bg").value
    };
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function crossCenters(s) {
    var list = [];
    if (s.mode === "repeat") {
      var pitch = 3;
      var y;
      var x;
      for (y = 1; y + 1 < s.rows; y += pitch) {
        for (x = 1; x + 1 < s.cols; x += pitch) list.push([x, y]);
      }
      return list;
    }
    return [[Math.floor((s.cols - 1) / 2), Math.floor((s.rows - 1) / 2)]];
  }

  function crossKey(x, y) {
    return x + "," + y;
  }

  function crossCells(s) {
    var set = {};
    crossCenters(s).forEach(function (c) {
      var cx = c[0];
      var cy = c[1];
      [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (d) {
        var x = cx + d[0];
        var y = cy + d[1];
        if (x >= 0 && y >= 0 && x < s.cols && y < s.rows) set[crossKey(x, y)] = true;
      });
    });
    return set;
  }

  function dotCells(s, blocked) {
    var dots = [];
    if (!s.dots || s.fill <= 0) return dots;
    var rand = mulberry32(s.seed);
    var y;
    var x;
    for (y = 0; y < s.rows; y++) {
      for (x = 0; x < s.cols; x++) {
        var roll = rand();
        if (s.avoid && blocked[crossKey(x, y)]) continue;
        if (roll < s.fill / 100) dots.push([x, y]);
      }
    }
    return dots;
  }

  function model(s) {
    var blocked = crossCells(s);
    return { crosses: blocked, dots: dotCells(s, blocked) };
  }

  function paint(target, s, m) {
    var w = s.cols * s.cell;
    var h = s.rows * s.cell;
    target.width = w;
    target.height = h;
    var ctx = target.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (s.bg) {
      ctx.fillStyle = s.paper;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = s.cross;
    if (s.crosses) Object.keys(m.crosses).forEach(function (key) {
      var parts = key.split(",");
      ctx.fillRect(Number(parts[0]) * s.cell, Number(parts[1]) * s.cell, s.cell, s.cell);
    });
    ctx.fillStyle = s.dot;
    m.dots.forEach(function (d) {
      ctx.fillRect(d[0] * s.cell, d[1] * s.cell, s.cell, s.cell);
    });
    if (s.grid) {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      var i;
      for (i = 0; i <= s.cols; i++) {
        ctx.moveTo(i * s.cell + 0.5, 0);
        ctx.lineTo(i * s.cell + 0.5, h);
      }
      for (i = 0; i <= s.rows; i++) {
        ctx.moveTo(0, i * s.cell + 0.5);
        ctx.lineTo(w, i * s.cell + 0.5);
      }
      ctx.stroke();
    }
    if (s.mode === "single" && s.crosses) {
      var c = crossCenters(s)[0];
      ctx.strokeStyle = s.cross;
      ctx.lineWidth = Math.max(1, Math.round(s.cell / 10));
      ctx.strokeRect(
        (c[0] - 1) * s.cell + 0.5,
        (c[1] - 1) * s.cell + 0.5,
        s.cell * 3 - 1,
        s.cell * 3 - 1
      );
    }
  }

  function render() {
    var s = state();
    cellEl.value = s.cell;
    cellRange.value = s.cell;
    colsEl.value = s.cols;
    rowsEl.value = s.rows;
    fillEl.value = s.fill;
    fillRange.value = s.fill;
    seedEl.value = s.seed;
    stage.classList.toggle("is-solid", s.bg);
    var m = model(s);
    paint(canvas, s, m);
    var box = stage.getBoundingClientRect();
    var availW = Math.max(80, box.width - 24);
    var availH = Math.max(80, box.height - 24);
    var scale = Math.min(availW / canvas.width, availH / canvas.height);
    canvas.style.width = Math.max(1, Math.floor(canvas.width * scale)) + "px";
    canvas.style.height = Math.max(1, Math.floor(canvas.height * scale)) + "px";
    readout.textContent = s.cols + "×" + s.rows + "  ·  " + (s.cols * s.cell) + "×" + (s.rows * s.cell) + " PX";
    return { s: s, m: m };
  }

  function applyAspect(kind) {
    aspect = kind;
    document.querySelectorAll("[data-aspect]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-aspect") === kind ? "true" : "false");
    });
    if (kind === "custom") {
      render();
      return;
    }
    var cols = clamp(colsEl.value, 3, 120);
    var ratio = kind === "4:5" ? [4, 5] : kind === "16:9" ? [16, 9] : [1, 1];
    var rows = Math.round(cols * ratio[1] / ratio[0]);
    rowsEl.value = clamp(rows, 3, 120);
    if (mode === "repeat") snapPitch();
    render();
  }

  function snapPitch() {
    var cols = clamp(colsEl.value, 3, 120);
    var rows = clamp(rowsEl.value, 3, 120);
    colsEl.value = Math.max(3, Math.round(cols / 3) * 3);
    rowsEl.value = Math.max(3, Math.round(rows / 3) * 3);
  }

  function setMode(next) {
    mode = next;
    document.getElementById("mode-single").setAttribute("aria-pressed", next === "single" ? "true" : "false");
    document.getElementById("mode-repeat").setAttribute("aria-pressed", next === "repeat" ? "true" : "false");
    if (next === "repeat") snapPitch();
    render();
  }

  function syncPair(a, b) {
    a.addEventListener("input", function () {
      b.value = a.value;
      if (a === colsEl && aspect !== "custom") applyAspect(aspect);
      else render();
    });
  }

  syncPair(cellEl, cellRange);
  syncPair(cellRange, cellEl);
  syncPair(fillEl, fillRange);
  syncPair(fillRange, fillEl);
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
  ["seed", "avoid", "show-grid", "show-crosses", "show-dots", "show-bg", "color-cross", "color-dot", "color-bg"].forEach(function (id) {
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

  function download(filename, href) {
    var a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.click();
  }

  document.getElementById("export-png").addEventListener("click", function () {
    var drawn = render();
    download("rhynova-" + drawn.s.cols + "x" + drawn.s.rows + ".png", canvas.toDataURL("image/png"));
  });

  document.getElementById("export-svg").addEventListener("click", function () {
    var drawn = render();
    var s = drawn.s;
    var m = drawn.m;
    var w = s.cols * s.cell;
    var h = s.rows * s.cell;
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" shape-rendering="crispEdges">');
    if (s.bg) parts.push('<rect width="100%" height="100%" fill="' + s.paper + '"/>');
    if (s.crosses) Object.keys(m.crosses).forEach(function (key) {
      var p = key.split(",");
      parts.push('<rect x="' + (Number(p[0]) * s.cell) + '" y="' + (Number(p[1]) * s.cell) + '" width="' + s.cell + '" height="' + s.cell + '" fill="' + s.cross + '"/>');
    });
    m.dots.forEach(function (d) {
      parts.push('<rect x="' + (d[0] * s.cell) + '" y="' + (d[1] * s.cell) + '" width="' + s.cell + '" height="' + s.cell + '" fill="' + s.dot + '"/>');
    });
    if (s.grid) {
      var d = "";
      var i;
      for (i = 0; i <= s.cols; i++) d += "M" + (i * s.cell) + " 0V" + h;
      for (i = 0; i <= s.rows; i++) d += "M0 " + (i * s.cell) + "H" + w;
      parts.push('<path d="' + d + '" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="1"/>');
    }
    parts.push("</svg>");
    var blob = new Blob([parts.join("")], { type: "image/svg+xml" });
    var url = URL.createObjectURL(blob);
    download("rhynova-" + s.cols + "x" + s.rows + ".svg", url);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  window.addEventListener("resize", render);
  render();
})();
