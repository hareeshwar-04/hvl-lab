/* HVL Lab viewer logic — plain script, no modules/fetch, works on file:// in all browsers. */
(function () {
  'use strict';

  var exps = window.EXPERIMENTS || [];
  var grid = document.getElementById('grid');
  var empty = document.getElementById('empty');
  var search = document.getElementById('search');
  var count = document.getElementById('count');
  var homeView = document.getElementById('homeView');
  var detailView = document.getElementById('detailView');
  var toastEl = document.getElementById('toast');
  var current = null;
  var toastTimer = null;

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var KW = ('module endmodule interface endinterface class endclass function endfunction ' +
    'task endtask package endpackage program endprogram property endproperty sequence endsequence ' +
    'covergroup endgroup coverpoint cross constraint solve before foreach unique ' +
    'input output inout logic bit reg wire signed unsigned int integer longint shortint byte ' +
    'string real time chandle event semaphore mailbox virtual extends implements ' +
    'rand randc randcase static automatic const ref new this super return break continue ' +
    'if else case endcase default for while do repeat forever fork join join_any join_none ' +
    'begin end always always_comb always_ff always_latch assign initial final ' +
    'posedge negedge edge typedef enum struct union packed localparam parameter ' +
    'import export timescale timeunit timeprecision assert assume cover expect ' +
    'bins binsof illegal_bins ignore_bins wildcard with inside dist null priority').split(' ');

  // Single-pass highlight on escaped text so spans never nest.
  // (Keywords are matched in the SAME pass — a second replace would also
  // match words like "class" inside the inserted <span> tags and corrupt them.)
  function highlight(src) {
    var e = esc(src);
    var re = new RegExp(
      '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)' +          // 1: comment
      '|("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')' + // 2: string
      '|(`[A-Za-z_]\\w*)' +                                // 3: preprocessor
      '|(\\b\\d[\\w\'h_]*)' +                              // 4: number
      '|\\b(' + KW.join('|') + ')\\b',                     // 5: keyword
      'g');
    var out = '';
    var last = 0;
    var m;
    while ((m = re.exec(e)) !== null) {
      out += e.slice(last, m.index);
      if (m[1]) out += '<span class="c-com">' + m[1] + '</span>';
      else if (m[2]) out += '<span class="c-str">' + m[2] + '</span>';
      else if (m[3]) out += '<span class="c-pp">' + m[3] + '</span>';
      else if (m[4]) out += '<span class="c-num">' + m[4] + '</span>';
      else if (m[5]) out += '<span class="c-kw">' + m[5] + '</span>';
      last = m.index + m[0].length;
    }
    out += e.slice(last);
    return out;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 1800);
  }

  function copyText(text, label) {
    function done() { toast(label + ' copied'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (err) { toast('Copy failed — select manually'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function download(filename, text) {
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      if (window.navigator && window.navigator.msSaveBlob) {
        window.navigator.msSaveBlob(blob, filename);
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      toast(filename + ' downloaded');
    } catch (err) {
      toast('Download not supported in this browser');
    }
  }

  function safeName(title, suffix) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + suffix;
  }

  /* ---------- home grid ---------- */

  function renderList() {
    var q = search.value.trim().toLowerCase();
    grid.innerHTML = '';
    var shown = 0;
    for (var i = 0; i < exps.length; i++) {
      var x = exps[i];
      if (q && x.title.toLowerCase().indexOf(q) === -1 &&
          x.desc.toLowerCase().indexOf(q) === -1) continue;
      shown++;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.setAttribute('data-id', x.id);
      b.innerHTML =
        '<h3>' + esc(x.title) + '</h3>' +
        '<p>' + esc(x.desc) + '</p>' +
        '<span class="meta">rtl/top.sv · tb/tb_top.sv</span>';
      (function (id) {
        b.addEventListener('click', function () { openExp(id); });
      })(x.id);
      grid.appendChild(b);
    }
    empty.hidden = shown !== 0;
    count.textContent = shown + ' / ' + exps.length;
  }

  /* ---------- detail ---------- */

  function fillPane(codeId, gutterId, src) {
    var codeEl = document.getElementById(codeId);
    var gutterEl = document.getElementById(gutterId);
    codeEl.innerHTML = highlight(src);
    var n = src.split('\n').length;
    var g = '';
    for (var i = 1; i <= n; i++) g += i + '\n';
    gutterEl.textContent = g;
  }

  function combinedText(x) {
    var tbClean = x.tb.replace(/^\s*`timescale[^\n]*\n+/, '');
    return x.rtl.replace(/\s+$/, '') + '\n\n' + tbClean.replace(/\s+$/, '') + '\n';
  }

  function openExp(id) {
    var x = null;
    for (var i = 0; i < exps.length; i++) {
      if (exps[i].id === id) { x = exps[i]; break; }
    }
    if (!x) return;
    current = x;
    document.getElementById('expTitle').textContent = x.title;
    document.getElementById('expDesc').textContent = x.desc;
    document.getElementById('rtlName').textContent = x.rtlFile;
    document.getElementById('tbName').textContent = x.tbFile;
    fillPane('rtlCode', 'rtlGutter', x.rtl);
    fillPane('tbCode', 'tbGutter', x.tb);
    document.getElementById('rtlScroll').scrollTop = 0;
    document.getElementById('tbScroll').scrollTop = 0;
    homeView.hidden = true;
    detailView.hidden = false;
    try {
      if ('replaceState' in history) history.replaceState(null, '', '#' + x.id);
      else location.hash = x.id;
    } catch (e) { /* file:// hash may throw in old browsers */ }
    window.scrollTo(0, 0);
    document.getElementById('backBtn').focus();
  }

  function goHome() {
    current = null;
    detailView.hidden = true;
    homeView.hidden = false;
    try {
      if ('replaceState' in history) history.replaceState(null, '', location.pathname.split('/').pop() || ' ');
    } catch (e) { /* ignore */ }
    window.scrollTo(0, 0);
    search.focus();
  }

  /* ---------- events ---------- */

  search.addEventListener('input', renderList);
  document.getElementById('backBtn').addEventListener('click', goHome);

  document.getElementById('copyRtlBtn').addEventListener('click', function () {
    if (current) copyText(current.rtl, 'RTL');
  });
  document.getElementById('copyTbBtn').addEventListener('click', function () {
    if (current) copyText(current.tb, 'Testbench');
  });
  document.getElementById('copyAllBtn').addEventListener('click', function () {
    if (current) copyText(combinedText(current), 'RTL + TB');
  });
  document.getElementById('dlRtlBtn').addEventListener('click', function () {
    if (current) download(safeName(current.title, '_rtl.sv'), current.rtl);
  });
  document.getElementById('dlTbBtn').addEventListener('click', function () {
    if (current) download(safeName(current.title, '_tb.sv'), current.tb);
  });
  document.getElementById('dlAllBtn').addEventListener('click', function () {
    if (!current) return;
    download(safeName(current.title, '_rtl.sv'), current.rtl);
    setTimeout(function () { download(safeName(current.title, '_tb.sv'), current.tb); }, 250);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !detailView.hidden) goHome();
  });

  /* ---------- init ---------- */

  renderList();
  var hash = (location.hash || '').replace('#', '');
  if (hash) openExp(hash);
})();
