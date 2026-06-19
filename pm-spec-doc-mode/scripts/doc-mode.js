/**
 * ═══════════════════════════════════════════════════════════
 *  PM Spec - 统一文档模式系统  (doc-mode.js)
 *  ═══════════════════════════════════════════════════════════
 *
 *  两种模式:
 *    1. 浏览模式 (默认) — 干净 HTML，代码可直接复用
 *    2. 文档模式 — 左侧页面预览 + 右侧文档/标注双标签
 *
 *  标注数据存储:
 *    - 编辑时数据存 localStorage（即时生效）
 *    - 点击「完成」→ 自动下载 [页面名].annotations.json 到浏览器
 *    - 将下载的文件保存到 HTML 所在目录即可
 *    - 页面加载优先 fetch 同目录 .annotations.json（始终最新），回退读 localStorage
 *
 *  用法: <script src="../shared/doc-mode.js"></script>
 *
 *  ═══════════════════════════════════════════════════════════
 */
(function(){
  'use strict';

  // ═══════════════════════════════════════════════
  //  状态
  //  ═══════════════════════════════════════════════
  var MODE = 'browse';
  var annotations = [];
  var annotateNextId = 1;
  var hoverHighlightEl = null;  // hover 高亮元素
  var hoverElement = null;     // 当前 hover 的 DOM 元素
  var activeContext = 'main';  // 当前活跃的标注上下文（main / modal的ID）
  var contextObserver = null;  // MutationObserver 监听弹窗变化
  var dragStartMouseX = 0, dragStartMouseY = 0;
  var dragStartBoxX = 0, dragStartBoxY = 0;
  var draggingBox = null;    // 前置声明，repositionAllBoxes 在其赋值前引用
  var resizingBox = null;
  var resizeDirection = '';
  var resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0, resizeStartBX = 0, resizeStartBY = 0;
  var currentPageMd = '';
  var mdContent = '';
  var pageIframe = null;
  var iframeReady = false;
  var annoDescriptions = {};    // 标注说明：{ 1: "文字", 2: "文字" }
  var annoSnapshot = null;     // 进入编辑前的标注快照
  var _docHidden = false;      // 悬浮按钮关闭标志

  (function(){
    var pageName = location.pathname.split('/').pop().replace('.html','');
    currentPageMd = pageName + '.md';
  })();

  // ═══════════════════════════════════════════════
  //  数据存储：localStorage（编辑） + 同目录 .annotations.json（部署）
  //  ═══════════════════════════════════════════════
  function getStorageKey() {
    return 'dm_anno_' + location.pathname;
  }

  /** 获取标注说明MD文件名：页面名标注.md */
  function getAnnoDescFileName() {
    var decoded = decodeURIComponent(location.pathname);
    var pageName = decoded.split('/').pop().replace('.html', '');
    return pageName + '标注.md';
  }

  /** 从同目录的 [页面名]标注.md 加载标注说明文字 */
  function loadAnnoDescriptions(callback) {
    try {
      var url = getAnnoDescFileName();
      fetch(url + '?v=' + Date.now(), { cache: 'no-store' })
        .then(function(r) { if (!r.ok) throw new Error('not found'); return r.text(); })
        .then(function(md) {
          /******************************************
           *  解析标注说明文档
           *  支持格式：
           *    ### 1 或 ### 标注1 或 ### 标注一
           *    ### 2 或 ### 标注2 或 ### 标注二
           *  推荐写法：### 标注1说明
           ******************************************/
          var cnNum = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };
          var result = {};
          var sections = md.split(/^### /gm);
          for (var i = 1; i < sections.length; i++) {
            var lines = sections[i].split('\n');
            var head = lines[0].trim();
            var num = null;
            // 优先匹配 "标注1" 或 "标注一" 后缀
            var m = head.match(/标注(\d+|[一二三四五六七八九十]+)/);
            if (m) {
              num = parseInt(m[1]);
              if (isNaN(num)) num = cnNum[m[1]];
            }
            // 兼容纯数字标题 "### 1"
            if (num === null || isNaN(num)) {
              num = parseInt(head);
              if (isNaN(num)) num = null;
            }
            if (num !== null && !isNaN(num) && lines.length > 1) {
              var text = lines.slice(1).join('\n').trim();
              if (text) result[num] = text;
            }
          }
          annoDescriptions = result;
          callback();
        })
        .catch(function() { annoDescriptions = {}; callback(); });
    } catch(e) { annoDescriptions = {}; callback(); }
  }

  /** 获取 iframe 内容区尺寸（用于百分比计算） */
  function getBodyDim() {
    if (!pageIframe || !pageIframe.contentDocument) return { w: 1, h: 1, scrollY: 0 };
    var doc = pageIframe.contentDocument;
    var w = doc.documentElement.scrollWidth || doc.body.scrollWidth || 1;
    var h = doc.documentElement.scrollHeight || doc.body.scrollHeight || 1;
    var sy = pageIframe.contentWindow.scrollY || 0;
    return { w: w, h: h, scrollY: sy };
  }

  /** 将百分比标注数据转为当前像素值 */
  function pctToPx(a) {
    var dim = getBodyDim();
    return {
      x: a.xPct * dim.w,
      y: a.yPct * dim.h,
      w: a.wPct * dim.w,
      h: a.hPct * dim.h
    };
  }

  /** 从像素值计算百分比并存入标注对象 */
  function updatePct(a) {
    var dim = getBodyDim();
    a.xPct = a.x / dim.w;
    a.yPct = a.y / dim.h;
    a.wPct = a.w / dim.w;
    a.hPct = a.h / dim.h;
  }

  /** 确保标注有百分比数据（向后兼容旧格式） */
  function ensurePct(a) {
    if (a.xPct === undefined) {
      var dim = getBodyDim();
      a.xPct = (a.x || 0) / dim.w;
      a.yPct = (a.y || 0) / dim.h;
      a.wPct = (a.w || 0) / dim.w;
      a.hPct = (a.h || 0) / dim.h;
    }
  }

  // ═══════════════════════════════════════════════
  //  锚点定位系统（XPath + 文本兜底，优于百分比定位）
  //  ═══════════════════════════════════════════════

  /** 为元素生成 XPath（比 CSS 选择器更稳定） */
  function generateXPath(el, doc) {
    doc = doc || document;
    if (!el || el === doc.body || el === doc.documentElement) return null;

    // 优先用 id
    if (el.id && !el.id.startsWith('_dm_')) {
      return '//*[@id="' + el.id + '"]';
    }

    var parts = [];
    var current = el;
    var maxDepth = 8;

    while (current && current !== doc.body && current !== doc.documentElement && maxDepth > 0) {
      var tag = current.tagName.toLowerCase();
      var segment = tag;
      var idx = 1;

      // 有 id 就直接终止
      if (current.id && !current.id.startsWith('_dm_')) {
        parts.unshift('*[@id="' + current.id + '"]');
        break;
      }

      // 计算同标签兄弟中的序号
      var baseClass = '';
      if (current.className && typeof current.className === 'string') {
        var clsParts = current.className.trim().split(/\s+/).filter(function(c) {
          return c && c.length > 0 && !c.startsWith('_dm_') && 
                 !/^\d/.test(c) && c.length <= 30;
        });
        if (clsParts.length > 0) baseClass = clsParts[0];
      }
      
      if (current.parentElement) {
        var siblings = current.parentElement.children;
        var sameTagCount = 0;
        var sameBaseClassCount = 0;
        for (var i = 0; i < siblings.length; i++) {
          if (siblings[i].tagName === current.tagName) {
            sameTagCount++;
            // 也统计同标签+同基础class的序号
            if (baseClass && siblings[i].className && 
                siblings[i].className.split(/\s+/).indexOf(baseClass) >= 0) {
              sameBaseClassCount++;
            }
            if (siblings[i] === current) idx = sameBaseClassCount || sameTagCount;
          }
        }
      }

      // 加入 class（用 contains 而非精确匹配，因为元素可能有 active 等状态类）
      if (baseClass) {
        segment += '[contains(concat(\" \", @class, \" \"), \" ' + baseClass + ' \")]';
      }

      // 多个同类兄弟 → 加位置下标。关键：多Tab场景下同名元素需要下标区分
      if ((sameBaseClassCount > 1) || (sameTagCount > 1 && !baseClass)) {
        segment += '[' + idx + ']';
      }

      parts.unshift(segment);

      // 测试 XPath 唯一性
      if (parts.length >= 2) {
        var xp = '//' + parts.join('/');
        try {
          var result = doc.evaluate(xp, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (result.snapshotLength === 1) break;
        } catch(e) { break; }
      }

      current = current.parentElement;
      maxDepth--;
    }

    var xpath = '//' + parts.join('/');
    // 验证
    try {
      var test = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (test.singleNodeValue) return xpath;
    } catch(e) {}
    return null;
  }

  /** 提取标注区域内关键文本（用于文本兜底定位） */
  function extractKeyTexts(anchorEl, boxX, boxY, boxW, boxH, doc) {
    doc = doc || document;
    var texts = [];
    try {
      // 收集锚点元素内部所有可见文本节点
      var walker = doc.createTreeWalker(anchorEl, NodeFilter.SHOW_TEXT, null, false);
      var node;
      while ((node = walker.nextNode())) {
        var t = node.textContent.trim();
        if (t.length > 0 && t.length < 80) {
          texts.push(t);
        }
      }
    } catch(e) {}

    // 去重，取前 3 个最长的关键文本
    var unique = [];
    var seen = {};
    for (var i = 0; i < texts.length; i++) {
      if (!seen[texts[i]]) {
        seen[texts[i]] = true;
        unique.push(texts[i]);
      }
    }
    unique.sort(function(a, b) { return b.length - a.length; });
    return unique.slice(0, 3);
  }

  /** 通过 XPath 或文本在 iframe 文档中查找锚点元素 */
  function queryByAnchor(a, doc) {
    if (!doc) return null;

    // 1. 优先 XPath
    if (a.xpath) {
      try {
        var result = doc.evaluate(a.xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue) return result.singleNodeValue;
      } catch(e) {}
    }

    // 2. 兼容旧格式：CSS 选择器
    if (a.anchor) {
      try {
        var el = doc.querySelector(a.anchor);
        if (el) return el;
      } catch(e) {}
    }

    // 3. 文本内容兜底
    if (a.keyTexts && a.keyTexts.length > 0) {
      for (var i = 0; i < a.keyTexts.length; i++) {
        var txt = a.keyTexts[i];
        if (!txt || txt.length < 3) continue;
        try {
          // 转义 XPath 字符串中的特殊字符
          var escaped = txt.replace(/"/g, '&quot;').replace(/'/g, '&apos;');
          // 搜索包含该文本的元素（选最小匹配）
          var xp = './/text()[contains(normalize-space(), "' + escaped + '")]/..';
          var result = doc.evaluate(xp, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (result.singleNodeValue) return result.singleNodeValue;
        } catch(e2) {
          // 转义失败尝试原始文本
          try {
            var xp2 = './/text()[contains(., "' + txt.substring(0, 10) + '")]/..';
            var result2 = doc.evaluate(xp2, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            if (result2.singleNodeValue) return result2.singleNodeValue;
          } catch(e3) {}
        }
      }
    }

    return null;
  }

  /** 临时隐藏所有 _dm_ 标注元素（框 + hover高亮），执行回调后恢复。
   *  关键：elementFromPoint 前必须全隐藏，否则标注框自身会挡住背后的页面元素。 */
  function withoutDmElements(doc, fn) {
    var hidden = [];
    // 隐藏 hover 高亮 + 标注框（所有 _dm_ 功能元素）
    var allDm = doc.querySelectorAll('[id^="_dm_hover"], ._dm_hover_highlight, ._dm_box, [id^="_dm_box_"]');
    for (var i = 0; i < allDm.length; i++) {
      if (allDm[i].style.display !== 'none') {
        allDm[i]._prevDisp = allDm[i].style.display;
        allDm[i].style.display = 'none';
        hidden.push(allDm[i]);
      }
    }
    var result;
    try {
      result = fn();
    } catch(e) {
      result = null;
    }
    for (var j = 0; j < hidden.length; j++) {
      hidden[j].style.display = hidden[j]._prevDisp || '';
    }
    return result;
  }

  /** 在标注框区域内找到合适的锚点元素 */
  function findAnchorInIframe(boxX, boxY, boxW, boxH) {
    if (!pageIframe || !pageIframe.contentDocument || !pageIframe.contentWindow) return null;
    var doc = pageIframe.contentDocument;
    var win = pageIframe.contentWindow;
    var scrollY = win.scrollY || 0;

    // 框中心点（body坐标 → viewport坐标）
    var cx = boxX + boxW / 2;
    var cy = boxY + boxH / 2;
    var vpY = cy - scrollY;

    var el = withoutDmElements(doc, function() {
      return doc.elementFromPoint(cx, vpY);
    });

    // 如果框在视口外，临时滚动到该位置再取元素
    if (!el && cy > scrollY + win.innerHeight) {
      var savedScroll = scrollY;
      win.scrollTo(0, cy - win.innerHeight / 2);
      vpY = cy - (win.scrollY || 0);
      el = withoutDmElements(doc, function() {
        return doc.elementFromPoint(cx, Math.max(0, vpY));
      });
      win.scrollTo(0, savedScroll);
    }
    if (!el) return null;

    // 向上找到有意义的容器元素（加入 TD/TH/TR/LI）
    var meaningfulTags = { 
      TD:1, TH:1, TR:1, LI:1,
      SECTION:1, TABLE:1, FORM:1, ARTICLE:1, MAIN:1, NAV:1, ASIDE:1, HEADER:1, FOOTER:1, DIV:1 
    };
    var candidate = el;
    while (candidate && candidate !== doc.body && candidate !== doc.documentElement) {
      // 有 id 就停下
      if (candidate.id && !candidate.id.startsWith('_dm_')) break;
      // 有文本内容的元素也优先
      if (candidate.tagName in meaningfulTags) {
        if (candidate.tagName === 'DIV') {
          if (candidate.className && typeof candidate.className === 'string') {
            var cls = candidate.className.trim().split(/\s+/).filter(function(c) { return c && !c.startsWith('_dm_'); });
            if (cls.length >= 1) break;
          }
          // DIV 没有 class 时不作为锚点，继续向上
        } else {
          break;
        }
      }
      candidate = candidate.parentElement;
    }

    var anchor = (candidate && candidate !== doc.body && candidate !== doc.documentElement) ? candidate : el;
    var xpath = generateXPath(anchor, doc);
    if (!xpath) return null;
    var keyTexts = extractKeyTexts(anchor, boxX, boxY, boxW, boxH, doc);
    return { el: anchor, xpath: xpath, keyTexts: keyTexts };
  }

  /** 设置标注的锚点数据 */
  function setAnchorOnAnnotation(a, boxX, boxY, boxW, boxH) {
    if (!pageIframe || !pageIframe.contentWindow) { updatePct(a); return; }
    var result = findAnchorInIframe(boxX, boxY, boxW, boxH);
    if (result) {
      var scrollY = pageIframe.contentWindow.scrollY || 0;
      var rect = result.el.getBoundingClientRect();
      a.xpath = result.xpath;
      a.keyTexts = result.keyTexts;
      a.anchorOffsetX = boxX - rect.left;
      a.anchorOffsetY = boxY - (rect.top + scrollY);
      // 记录锚点原始尺寸，用于缩放时等比缩放
      a.anchorW = rect.width;
      a.anchorH = rect.height;
      // 框与锚点的尺寸比例（缩放后按此比例还原）
      a.scaleW = (rect.width > 0) ? boxW / rect.width : 1;
      a.scaleH = (rect.height > 0) ? boxH / rect.height : 1;
      // 清除旧格式 anchor 字段（迁移到 xpath）
      delete a.anchor;
    }
    // 总是保存百分比做兜底（锚点失效时才用）
    updatePct(a);
  }

  /** 基于锚点计算标注框像素位置，锚点无效时回退百分比。锚点在隐藏容器中返回 hidden:true */
  function getBoxPosFromAnchor(a) {
    if (pageIframe && pageIframe.contentDocument && pageIframe.contentWindow) {
      try {
        var doc = pageIframe.contentDocument;
        var el = queryByAnchor(a, doc);
        if (el) {
          // 检查锚点本身是否可见（如 Tab 切换导致元素隐藏）
          var elCs = doc.defaultView.getComputedStyle(el);
          if (elCs.display === 'none' || elCs.visibility === 'hidden') {
            // 元素已隐藏 → 用百分比兜底
            return pctToPx(a);
          }
          // 检查祖先容器是否隐藏
          var check = el.parentElement;
          while (check && check !== doc.body && check !== doc.documentElement) {
            var cs = doc.defaultView.getComputedStyle(check);
            if (cs.display === 'none' || cs.visibility === 'hidden') {
              return pctToPx(a);  // 祖先隐藏 → 百分比兜底
            }
            check = check.parentElement;
          }
          var scrollY = pageIframe.contentWindow.scrollY || 0;
          var rect = el.getBoundingClientRect();
          // 计算缩放比例（锚点元素尺寸相对原始尺寸的变化）
          var scaleX = (a.anchorW && a.anchorW > 0) ? rect.width / a.anchorW : 1;
          var scaleY = (a.anchorH && a.anchorH > 0) ? rect.height / a.anchorH : 1;
          // 宽高 = 锚点当前尺寸 × 框与锚点的原始比例（等比跟随锚点）
          var boxScaleW = (a.scaleW !== undefined) ? a.scaleW : 1;
          var boxScaleH = (a.scaleH !== undefined) ? a.scaleH : 1;
          return {
            x: rect.left + (a.anchorOffsetX || 0) * scaleX,
            y: rect.top + scrollY + (a.anchorOffsetY || 0) * scaleY,
            w: rect.width * boxScaleW,
            h: rect.height * boxScaleH
          };
        }
      } catch(e) {}
    }
    // 回退百分比
    return pctToPx(a);
  }

  /** 拖动/缩放后更新锚点偏移量和比例 */
  function updateAnchorOffsetForAnnotation(a, boxX, boxY, boxW, boxH) {
    if (!pageIframe || !pageIframe.contentDocument || !pageIframe.contentWindow) return;
    if (!a.xpath && !a.anchor) return;
    try {
      var el = queryByAnchor(a, pageIframe.contentDocument);
      if (el) {
        var scrollY = pageIframe.contentWindow.scrollY || 0;
        var rect = el.getBoundingClientRect();
        a.anchorOffsetX = boxX - rect.left;
        a.anchorOffsetY = boxY - (rect.top + scrollY);
        a.anchorW = rect.width;
        a.anchorH = rect.height;
        // 更新框与锚点的比例（用户可能拉伸了框）
        if (boxW !== undefined && rect.width > 0) a.scaleW = boxW / rect.width;
        if (boxH !== undefined && rect.height > 0) a.scaleH = boxH / rect.height;
      }
    } catch(e) {}
  }

  /** 获取标注文件名：页面名标注.json */
  function getAnnoFileName() {
    // 用 decodeURIComponent 解码中文路径
    var decoded = decodeURIComponent(location.pathname);
    var pageName = decoded.split('/').pop().replace('.html', '');
    return pageName + '标注.json';
  }

  /** 从同目录的 .annotations.json 加载标注数据 */
  function loadFromAnnotationsFile(callback) {
    try {
      var url = getAnnoFileName();
      // 加时间戳绕过浏览器缓存，确保每次加载最新文件
      fetch(url + '?v=' + Date.now(), { cache: 'no-store' })
        .then(function(r) { if (!r.ok) throw new Error('not found'); return r.json(); })
        .then(function(data) {
          if (data.annotations && Array.isArray(data.annotations) && data.annotations.length > 0) {
            callback(data);
          } else {
            callback(null);
          }
        })
        .catch(function() { callback(null); });
    } catch(e) { callback(null); }
  }

  /** 保存标注到 localStorage */
  function saveAnnotations() {
    try {
      var scrollY = 0;
      if (pageIframe && pageIframe.contentWindow) {
        scrollY = pageIframe.contentWindow.scrollY || pageIframe.contentDocument.documentElement.scrollTop || 0;
      }
      localStorage.setItem(getStorageKey(), JSON.stringify({
        annotations: annotations,
        iframeScrollY: scrollY
      }));
    } catch(e) {}
  }

  /** 加载标注数据：优先读 JSON 文件（最新），回退 localStorage（编辑中未保存的状态） */
  function loadAnnotations(callback) {
    // 1. 优先 fetch 同目录标注.json（始终获取最新文件内容）
    loadFromAnnotationsFile(function(jsonData) {
      if (jsonData && jsonData.annotations && jsonData.annotations.length > 0) {
        annotations = jsonData.annotations;
        migrateAnnotations(annotations);
        // 同步到 localStorage，保持编辑状态一致
        try {
          localStorage.setItem(getStorageKey(), JSON.stringify({
            annotations: annotations,
            iframeScrollY: jsonData.scrollY || 0
          }));
        } catch(e) {}
        callback(jsonData.scrollY || 0);
        return;
      }
      // 2. JSON 文件不存在或为空，回退读 localStorage
      try {
        var stored = localStorage.getItem(getStorageKey());
        if (stored) {
          var parsed = JSON.parse(stored);
          if (parsed && parsed.annotations && Array.isArray(parsed.annotations)) {
            annotations = parsed.annotations;
            migrateAnnotations(annotations);
            callback(parsed.iframeScrollY || 0);
            return;
          }
        }
      } catch(e) {}
      callback(-1);
    });
  }

  function clearSavedAnnotations() {
    try { localStorage.removeItem(getStorageKey()); } catch(e) {}
  }

  // ═══════════════════════════════════════════════
  //  iframe 辅助函数
  //  ═══════════════════════════════════════════════
  function getIframeDoc() {
    return (pageIframe && pageIframe.contentDocument) ? pageIframe.contentDocument : null;
  }

  function iframeAddEvent(type, fn) {
    var doc = getIframeDoc();
    if (doc) doc.addEventListener(type, fn);
  }

  function iframeRemoveEvent(type, fn) {
    var doc = getIframeDoc();
    if (doc) doc.removeEventListener(type, fn);
  }

  function iframeGetEl(id) {
    var doc = getIframeDoc();
    return doc ? doc.getElementById(id) : null;
  }

  // 隐藏当前页面的文档浮动按钮（如果在 iframe 预览中）
  if (location.search.indexOf('dm_nodoc=1') >= 0) {
    function hideDocBtn() {
      var btn = document.getElementById('_dm_float_btn');
      if (btn) { btn.style.display = 'none'; return true; }
      return false;
    }
    if (!hideDocBtn()) {
      var mo = new MutationObserver(function() {
        if (hideDocBtn()) mo.disconnect();
      });
      mo.observe(document.body, { childList: true });
    }
  }

  // ═══════════════════════════════════════════════
  //  事件委托
  //  ═══════════════════════════════════════════════
  document.addEventListener('click', function(e) {
    // 点击关闭按钮不触发文档模式切换
    if (isInside(e.target, '._dm_close')) return;
    if (isInside(e.target, '#_dm_float_btn')) {
      if (MODE === 'browse') enterDocMode(); else exitDocMode();
    }
    if (isInside(e.target, '#_dm_divider')) { toggleSidebar(); return; }
    if (isInside(e.target, '#_dm_annotate_btn')) toggleAnnotate();
    if (isInside(e.target, '#_dm_edit_exit_btn')) { abortAnnotate(); }
  });

  // ═══════════════════════════════════════════════
  //  CSS
  //  ═══════════════════════════════════════════════
  function injectCSS() {
    var css = document.createElement('style');
    css.id = '_dm_styles';
    css.textContent = [
      /* ══ 浏览模式：方块按钮 ══ */
      '._dm_float { position:fixed;right:16px;bottom:16px;z-index:99999;',
      '  display:flex;align-items:center;gap:6px;padding:8px 14px;',
      '  background:#fff;border:1px solid #e0e0e0;border-radius:8px;',
      '  box-shadow:0 2px 10px rgba(0,0,0,.1);cursor:pointer;',
      '  font-size:13px;color:#333;font-weight:500;white-space:nowrap;',
      '  user-select:none;transition:box-shadow .15s; }',
      '._dm_float:hover { box-shadow:0 4px 16px rgba(0,0,0,.15); }',
      '._dm_float ._dm_icon { color:#18A55D;font-size:16px; }',
      '._dm_float ._dm_close { font-size:16px;color:#aaa;cursor:pointer;',
      '  margin-left:4px;line-height:1;transition:color .15s; }',
      '._dm_float ._dm_close:hover { color:#666; }',
      /* ══ 文档模式覆盖层 ══ */
      '._dm_overlay { position:fixed;inset:0;z-index:99990;',
      '  background:#f0f2f5;display:none;flex-direction:row; }',
      '._dm_overlay._dm_show { display:flex; }',

      /* ══ 工具栏 ══ */
      '._dm_tb { position:absolute;top:0;left:0;right:0;height:48px;z-index:99999;',
      '  background:#fff;display:flex;align-items:center;justify-content:space-between;',
      '  padding:0 14px;border-bottom:1px solid #e8e8e8; }',
      '._dm_tb_left { display:flex;align-items:center;gap:8px; }',
      '._dm_tb_right { display:flex;align-items:center;gap:8px; }',
      '._dm_tb_title { font-size:14px;font-weight:600;color:#333; }',
      '._dm_tb_btn { padding:6px 14px;border-radius:6px;border:1px solid #d9d9d9;',
      '  background:#fff;cursor:pointer;font-size:12px;font-weight:500;',
      '  white-space:nowrap;transition:all .15s;color:#555; }',
      '._dm_tb_btn:hover { border-color:#18A55D;color:#18A55D; }',
      '._dm_tb_primary { background:#f5a623;color:#fff;border-color:#f5a623; }',
      '._dm_tb_primary:hover { color:#fff;opacity:.9; }',
      '._dm_tb_danger { background:#ff4d4f;color:#fff;border-color:#ff4d4f; }',
      '._dm_tb_danger:hover { color:#fff;opacity:.9; }',
      '._dm_tb_success { background:#18A55D;color:#fff;border-color:#18A55D; }',
      '._dm_tb_success:hover { color:#fff;opacity:.9; }',

      /* ══ 分隔条 ══ */
      '._dm_divider { width:8px;margin-top:48px;background:#e8e8e8;cursor:col-resize;',
      '  flex-shrink:0;position:relative;z-index:99991;transition:background .15s; }',
      '._dm_divider:hover { background:#aaa; }',
      '._dm_divider._dm_dragging { background:#666; }',

      /* ══ 左侧预览 ══ */
      '._dm_left { flex:1;min-width:300px;margin-top:48px;background:#fff;',
      '  overflow:auto;position:relative; }',
      '._dm_left_viewport { min-height:100%;position:relative; }',
      '._dm_left_viewport iframe { width:100%;height:100%;min-height:calc(100vh - 48px);',
      '  border:none;display:block; }',

      /* 框选相关 */
      '._dm_hover_highlight { position:absolute;pointer-events:none;',
      '  border:2px dashed #18A55D;background:rgba(24,165,93,0.08);',
      '  z-index:10;transition:all .1s ease; }',
      '._dm_box { position:absolute;border:2px solid #f5a623;',
      '  background:rgba(245,166,35,.08);z-index:12;pointer-events:auto; }',
      '._dm_editable ._dm_box { cursor:move; }',
      '._dm_box_handle { display:none;position:absolute;width:8px;height:8px;',
      '  background:#f5a623;border-radius:50%;z-index:14; }',
      '._dm_editable ._dm_box_handle { display:block; }',
      '._dm_box_handle.n { top:-5px;left:50%;margin-left:-4px;cursor:n-resize; }',
      '._dm_box_handle.s { bottom:-5px;left:50%;margin-left:-4px;cursor:s-resize; }',
      '._dm_box_handle.w { left:-5px;top:50%;margin-top:-4px;cursor:w-resize; }',
      '._dm_box_handle.e { right:-5px;top:50%;margin-top:-4px;cursor:e-resize; }',
      '._dm_box_handle.nw { top:-5px;left:-5px;cursor:nw-resize; }',
      '._dm_box_handle.ne { top:-5px;right:-5px;cursor:ne-resize; }',
      '._dm_box_handle.sw { bottom:-5px;left:-5px;cursor:sw-resize; }',
      '._dm_box_handle.se { bottom:-5px;right:-5px;cursor:se-resize; }',
      /* 左上角：方形编号 + 说明标签合并 */
      '._dm_box_header { position:absolute;top:-14px;left:-14px;',
      '  display:flex;align-items:center;gap:3px;z-index:15;',
      '  user-select:none;pointer-events:auto; }',
      '._dm_box_num { min-width:20px;height:22px;padding:0 5px;border-radius:4px;',
      '  background:#f5a623;color:#fff;font-size:12px;font-weight:bold;',
      '  display:flex;align-items:center;justify-content:center;',
      '  box-shadow:0 2px 6px rgba(245,166,35,.4);',
      '  transition:transform .15s; }',
      '._dm_editable ._dm_box_num { cursor:pointer; }',
      /* 说明标签：编号旁边，有说明时显示"说明" */
      '._dm_box_desc { display:none;height:22px;padding:0 5px;border-radius:4px;',
      '  background:#e8a030;color:#fff;font-size:11px;font-weight:bold;',
      '  align-items:center;justify-content:center;line-height:1;',
      '  box-shadow:0 2px 6px rgba(245,166,35,.4);',
      '  cursor:default; }',
      '._dm_box.has_desc ._dm_box_desc { display:flex; }',
      '._dm_editable ._dm_box_desc { display:none !important; }',
      /* tooltip：JS动态定位，默认隐藏 */
      '._dm_desc_tip { display:none;position:absolute;',
      '  background:#333;color:#fff;padding:8px 12px;border-radius:4px;',
      '  font-size:12px;line-height:1.6;min-width:120px;max-width:280px;',
      '  word-break:break-word;white-space:pre-wrap;',
      '  z-index:9999;pointer-events:none;',
      '  box-shadow:0 2px 8px rgba(0,0,0,.25); }',
      '._dm_desc_tip._dm_tip_show { display:block; }',
      '._dm_editable ._dm_desc_tip { display:none !important; }',
      '._dm_desc_tip_arrow { position:absolute;width:0;height:0;',
      '  border:6px solid transparent; }',
      '._dm_desc_tip._dm_tip_above ._dm_desc_tip_arrow { top:100%;margin-top:-1px;border-top-color:#333; }',
      '._dm_desc_tip._dm_tip_below ._dm_desc_tip_arrow { bottom:100%;margin-bottom:-1px;border-bottom-color:#333; }',
      /* 删除按钮：编辑模式下右上角，始终可见 */
      '._dm_box_del { display:none;position:absolute;top:-14px;right:-14px;',
      '  width:24px;height:24px;border-radius:50%;background:#ff4d4f;',
      '  color:#fff;font-size:16px;font-weight:bold;line-height:1;',
      '  align-items:center;justify-content:center;',
      '  box-shadow:0 2px 8px rgba(255,77,79,.4);z-index:16;',
      '  cursor:pointer;transition:transform .15s;',
      '  user-select:none; }',
      '._dm_editable ._dm_box_del { display:flex; }',
      '._dm_box_del:hover { transform:scale(1.3); }',
      '@keyframes _dm_box_pop { 0%{transform:scale(.9);opacity:0}100%{transform:scale(1);opacity:1} }',

      /* ══ 右侧面板 ══ */
      '._dm_right { flex:0 0 420px;min-width:280px;display:flex;flex-direction:column;',
      '  margin-top:48px;background:#fff;transition:flex-basis .25s ease; }',
      '._dm_right._dm_expanded { flex:0 0 50vw !important; }',
      /* Tab 栏 */
      '._dm_tabs { display:flex;border-bottom:1px solid #e8e8e8;flex-shrink:0; }',
      '._dm_tab { flex:1;padding:10px 0;text-align:center;font-size:13px;font-weight:500;',
      '  color:#999;cursor:pointer;border-bottom:2px solid transparent;',
      '  transition:all .15s;user-select:none; }',
      '._dm_tab:hover { color:#555; }',
      '._dm_tab._dm_active { color:#18A55D;border-bottom-color:#18A55D;font-weight:600; }',
      '._dm_right_body { flex:1;overflow-y:auto;padding:18px 22px 40px;display:none;',
      '  font-size:14px;line-height:1.75;color:#333;',
      '  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }',
      '._dm_right_body h1 { font-size:20px;color:#111;margin:0 0 12px;',
      '  border-bottom:2px solid #e0e0e0;padding-bottom:8px; }',
      '._dm_right_body h2 { font-size:16px;color:#222;margin:20px 0 8px;font-weight:600; }',
      '._dm_right_body h3 { font-size:14px;color:#333;margin:14px 0 6px; }',
      '._dm_right_body p { margin:6px 0; }',
      '._dm_right_body table { width:100%;border-collapse:collapse;margin:10px 0;font-size:12px; }',
      '._dm_right_body th,._dm_right_body td { border:1px solid #e0e0e0;padding:6px 10px;text-align:left; }',
      '._dm_right_body th { background:#fafafa;font-weight:600;color:#555; }',
      '._dm_right_body code { background:#f5f5f5;padding:2px 5px;border-radius:3px;font-size:12px; }',
      '._dm_right_body strong { color:inherit;font-weight:700; }',
      '._dm_right_body blockquote { border-left:3px solid #e0e0e0;padding-left:12px;color:#666;margin:8px 0; }',
      '._dm_right_body ._dm_hl { animation:_dm_hl_flash .8s ease 3; }',
      '@keyframes _dm_hl_flash { 0%,100%{background:transparent}50%{background:rgba(24,165,93,.12)} }',
      '._dm_right_body._dm_active { display:block; }',

      '._dm_empty { text-align:center;padding:50px 20px;color:#ccc;font-size:13px; }',

      '@media(max-width:900px){ ._dm_right { width:360px;min-width:280px; } }',
      '@media(max-width:700px){ ._dm_overlay { flex-direction:column; }',
      '  ._dm_right { width:100%;min-width:0;height:45%;margin-top:0; }',
      '  ._dm_left { flex:none;height:55%;margin-top:48px; } }',
    ].join('\n');
    document.head.appendChild(css);
  }

  // ═══════════════════════════════════════════════
  //  DOM 创建
  //  ═══════════════════════════════════════════════
  var overlay, rightBodyPage, rightBodyAnno;

  function createDOM() {
    // 如果已关闭，不创建悬浮按钮
    if (_docHidden) return;

    // 浏览模式按钮
    var btn = document.createElement('div');
    btn.className = '_dm_float';
    btn.id = '_dm_float_btn';
    btn.innerHTML = '<span class="_dm_icon">📄</span><span>文档</span><span class="_dm_close">\u00D7</span>';
    // 关闭按钮事件
    var closeEl = btn.querySelector('._dm_close');
    if (closeEl) {
      closeEl.addEventListener('click', function(e) {
        e.stopPropagation();
        _docHidden = true;
        btn.remove();
      });
    }
    document.body.appendChild(btn);

    // 覆盖层
    overlay = document.createElement('div');
    overlay.className = '_dm_overlay';
    overlay.id = '_dm_overlay';

    // 工具栏
    var tb = document.createElement('div');
    tb.className = '_dm_tb';
    tb.innerHTML =
      '<div class="_dm_tb_left">' +
        '<span class="_dm_tb_title">📄 文档模式</span>' +
      '</div>' +
      '<div class="_dm_tb_right">' +
        '<button class="_dm_tb_btn _dm_tb_primary" id="_dm_annotate_btn">标注</button>' +
        '<button class="_dm_tb_btn" id="_dm_edit_exit_btn" style="display:none;">退出编辑</button>' +
      '</div>';
    overlay.appendChild(tb);

    // 左侧预览
    var left = document.createElement('div');
    left.className = '_dm_left';
    left.id = '_dm_left';
    var vp = document.createElement('div');
    vp.className = '_dm_left_viewport';
    vp.id = '_dm_viewport';
    left.appendChild(vp);
    overlay.appendChild(left);

    // 分隔条（可拖动调整宽度）
    var divider = document.createElement('div');
    divider.className = '_dm_divider';
    divider.id = '_dm_divider';
    overlay.appendChild(divider);

    // 右侧面板（带 Tab）
    var right = document.createElement('div');
    right.className = '_dm_right';
    right.id = '_dm_right';
    // Tab 栏：标注说明（左，默认激活）| 页面说明（右）
    var tabs = document.createElement('div');
    tabs.className = '_dm_tabs';
    tabs.innerHTML =
      '<div class="_dm_tab _dm_active" data-tab="anno">标注说明</div>' +
      '<div class="_dm_tab" data-tab="page">页面说明</div>';
    right.appendChild(tabs);
    // 标注 body（默认激活）
    rightBodyAnno = document.createElement('div');
    rightBodyAnno.className = '_dm_right_body _dm_active';
    rightBodyAnno.id = '_dm_right_body_anno';
    rightBodyAnno.innerHTML = '<div class="_dm_empty">加载标注说明中...</div>';
    right.appendChild(rightBodyAnno);
    // 页面说明 body
    rightBodyPage = document.createElement('div');
    rightBodyPage.className = '_dm_right_body';
    rightBodyPage.id = '_dm_right_body_page';
    rightBodyPage.innerHTML = '<div class="_dm_empty">加载文档中...</div>';
    right.appendChild(rightBodyPage);
    overlay.appendChild(right);
    document.body.appendChild(overlay);

    // Tab 切换事件
    initTabs();
  }

  // ═══════════════════════════════════════════════
  //  Tab 切换
  //  ═══════════════════════════════════════════════
  function initTabs() {
    var tabs = document.querySelectorAll('._dm_tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        // 切换 tab 激活状态
        tabs.forEach(function(t) { t.classList.remove('_dm_active'); });
        tab.classList.add('_dm_active');
        // 切换 body 显示
        var target = tab.getAttribute('data-tab');
        rightBodyPage.classList.toggle('_dm_active', target === 'page');
        rightBodyAnno.classList.toggle('_dm_active', target === 'anno');
      });
    });
  }

  // ═══════════════════════════════════════════════
  //  侧边栏展开/收起切换
  //  ═══════════════════════════════════════════════
  function toggleSidebar() {
    var right = document.getElementById('_dm_right');
    if (!right) return;

    // 清除 inline style，让 CSS class 生效
    right.style.width = '';
    right.style.flex = '';

    var expanded = right.classList.toggle('_dm_expanded');

    setTimeout(function() {
      if (pageIframe && iframeReady && annotations.length > 0) {
        repositionAllBoxes();
      }
    }, 300);
  }

  // ═══════════════════════════════════════════════
  //  保存：File System Access API 自动保存（Chrome/Edge）
  //  首次需授权选文件夹，之后自动保存，无需弹窗
  //  ═══════════════════════════════════════════════
  var savedDirHandle = null;    // 已授权的目录句柄
  var DB_NAME = '_dm_fs_db', DB_STORE = 'handles';

  /** 按页面目录取 IndexedDB key，确保不同目录的句柄不串 */
  function getDbKey() {
    var decoded = decodeURIComponent(location.pathname);
    // 去掉文件名，只保留目录路径
    return decoded.replace(/\/[^/]+$/, '/');
  }

  /** IndexedDB 存取目录句柄 */
  function dbOpen() {
    return new Promise(function(resolve, reject) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function() { r.result.createObjectStore(DB_STORE); };
      r.onsuccess = function() { resolve(r.result); };
      r.onerror = function() { reject(r.error); };
    });
  }

  function dbSaveHandle(handle) {
    return dbOpen().then(function(db) {
      return new Promise(function(resolve) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(handle, getDbKey());
        tx.oncomplete = resolve;
      });
    });
  }

  function dbLoadHandle() {
    return dbOpen().then(function(db) {
      return new Promise(function(resolve) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).get(getDbKey());
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { resolve(null); };
      });
    });
  }

  /** 获取标注数据 JSON */
  function getAnnoDataJson() {
    var scrollY = 0;
    if (pageIframe && pageIframe.contentWindow) {
      scrollY = pageIframe.contentWindow.scrollY || 0;
    }
    return JSON.stringify({
      annotations: annotations,
      scrollY: scrollY
    }, null, 2);
  }

  /** 通过 File System Access API 写入文件 */
  function fsWriteFile(dirHandle, filename, content, callback) {
    dirHandle.getFileHandle(filename, { create: true })
      .then(function(fileHandle) {
        return fileHandle.createWritable();
      })
      .then(function(writable) {
        return writable.write(content).then(function() { return writable.close(); });
      })
      .then(function() { callback(true); })
      .catch(function() { callback(false); });
  }

  /** 尝试自动保存（已有授权句柄） */
  function tryAutoSave(callback) {
    dbLoadHandle().then(function(handle) {
      if (!handle) { callback(false); return; }
      // 验证权限
      handle.queryPermission({ mode: 'readwrite' }).then(function(perm) {
        if (perm === 'granted' || perm === 'prompt') {
          if (perm === 'prompt') {
            handle.requestPermission({ mode: 'readwrite' }).then(function(p) {
              if (p !== 'granted') { callback(false); return; }
              fsWriteFile(handle, getAnnoFileName(), getAnnoDataJson(), callback);
            });
          } else {
            fsWriteFile(handle, getAnnoFileName(), getAnnoDataJson(), callback);
          }
        } else {
          callback(false);
        }
      }).catch(function() { callback(false); });
    }).catch(function() { callback(false); });
  }

  /** 首次授权：弹出文件夹选择器 */
  function fsAuthorize(callback) {
    if (!window.showDirectoryPicker) { callback(false); return; }
    window.showDirectoryPicker({ mode: 'readwrite' })
      .then(function(handle) {
        savedDirHandle = handle;
        dbSaveHandle(handle).then(function() {
          fsWriteFile(handle, getAnnoFileName(), getAnnoDataJson(), callback);
        });
      })
      .catch(function() { callback(false); });
  }

  /** 下载回退 */
  function fallbackDownload() {
    var filename = getAnnoFileName();
    var blob = new Blob([getAnnoDataJson()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ═══════════════════════════════════════════════
  //  模式切换
  //  ═══════════════════════════════════════════════
  function enterDocMode() {
    MODE = 'doc';
    overlay.classList.add('_dm_show');
    loadMdDoc();
    loadAnnoDoc();
    loadAnnoDescriptions(function() {
      reRenderDescriptions();
    });
    iframeReady = false;
    renderPagePreview();
    // 文档模式按钮变绿色
    var btn = document.getElementById('_dm_float_btn');
    if (btn) btn.style.background = '#e6f7ee';
  }

  function exitDocMode() {
    MODE = 'browse';
    overlay.classList.remove('_dm_show');
    if (annotateMode) toggleAnnotate();
    saveAnnotations();
    // 恢复按钮颜色
    var btn = document.getElementById('_dm_float_btn');
    if (btn) btn.style.background = '';
    // 清除 iframe 内的标注框 DOM
    try {
      if (pageIframe && pageIframe.contentDocument) {
        var body = pageIframe.contentDocument.body;
        var boxes = body.querySelectorAll('._dm_box, ._dm_hover_highlight');
        for (var i = 0; i < boxes.length; i++) boxes[i].parentNode.removeChild(boxes[i]);
        var style = pageIframe.contentDocument.getElementById('_dm_iframe_styles');
        if (style) style.parentNode.removeChild(style);
        if (body._resizeBound) { body._resizeBound = false; }
      }
    } catch(e) {}
    removeHoverHighlight();
    var left = document.getElementById('_dm_left');
    if (left) {
      var boxes = left.querySelectorAll('._dm_box');
      for (var i = 0; i < boxes.length; i++) boxes[i].parentNode.removeChild(boxes[i]);
    }
    pageIframe = null;
    iframeReady = false;
    updateBadge();
  }

  // ═══════════════════════════════════════════════
  //  标注模式切换
  //  ═══════════════════════════════════════════════
  function toggleAnnotate() {
    if (annotateMode) {
      saveAnnotations();
      if (annotations.length > 0) {
        // 1. 先尝试自动保存（已授权直接保存）
        tryAutoSave(function(ok) {
          if (ok) { exitAnnotateMode(); return; }
          // 2. 未授权尝试 FS API 授权（直接弹文件夹选择器，无弹窗）
          if (window.showDirectoryPicker) {
            fsAuthorize(function(ok2) {
              if (ok2) { exitAnnotateMode(); return; }
              // 3. 授权失败 → 直接下载
              fallbackDownload();
              exitAnnotateMode();
            });
          } else {
            // 4. 不支持 FS API → 直接下载
            fallbackDownload();
            exitAnnotateMode();
          }
        });
      } else {
        exitAnnotateMode();
      }
    } else {
      enterAnnotateMode();
    }
  }

  /** 进入标注编辑模式（hover 元素 + 点击创建框） */
  function enterAnnotateMode() {
    if (!pageIframe || !iframeReady) { alert('预览页面加载中，请稍后再试'); return; }
    // 快照：保存进入编辑前的标注数据
    annoSnapshot = annotations.slice().map(function(a) {
      return { id: a.id, x: a.x, y: a.y, w: a.w, h: a.h };
    });
    annotateMode = true;
    var btn = document.getElementById('_dm_annotate_btn');
    btn.className = '_dm_tb_btn _dm_tb_danger';
    btn.textContent = '✓ 完成';
    var exitBtn = document.getElementById('_dm_edit_exit_btn');
    if (exitBtn) exitBtn.style.display = '';
    try {
      var doc = pageIframe.contentDocument;
      if (!doc) { annotateMode = false; return; }
      doc.body.classList.add('_dm_editable');
      doc.body.style.cursor = 'crosshair';
      doc.addEventListener('mousemove', onHoverElement, { passive: true });
      // capture：拦截 + 创建标注（一步到位，隔离页面交互）
      doc.addEventListener('click', onCaptureClick, true);
    } catch(e) { annotateMode = false; }
  }

  /** 退出标注编辑模式（通用） */
  function exitAnnotateMode() {
    annotateMode = false;
    annoSnapshot = null;
    var btn = document.getElementById('_dm_annotate_btn');
    btn.className = '_dm_tb_btn _dm_tb_primary';
    btn.textContent = '标注';
    var exitBtn = document.getElementById('_dm_edit_exit_btn');
    if (exitBtn) exitBtn.style.display = 'none';
    try {
      if (pageIframe && pageIframe.contentDocument) {
        var doc = pageIframe.contentDocument;
        doc.body.classList.remove('_dm_editable');
        doc.body.style.cursor = '';
        doc.removeEventListener('mousemove', onHoverElement);
        doc.removeEventListener('click', onCaptureClick, true);
      }
    } catch(e) {}
    removeHoverHighlight();
  }

  /** 放弃编辑恢复快照（退出编辑按钮触发） */
  function abortAnnotate() {
    // 恢复到进入编辑前的数据
    if (annoSnapshot) {
      annotations = annoSnapshot.slice();
      var maxId = 0;
      annotations.forEach(function(a) { if (a.id > maxId) maxId = a.id; });
      annotateNextId = maxId + 1;
      saveAnnotations();
      reRenderAllBoxes();
      updateBadge();
    }
    exitAnnotateMode();
  }

  // ═══════════════════════════════════════════════
  //  加载产品文档 MD
  //  ═══════════════════════════════════════════════
  function loadMdDoc() {
    fetch(currentPageMd + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { if (!r.ok) throw new Error('404'); return r.text(); })
      .then(function(text) { mdContent = text; rightBodyPage.innerHTML = mdToHtml(text); })
      .catch(function() {
        rightBodyPage.innerHTML = '<div class="_dm_empty"><p>⚠ 未找到文档</p><p style="font-size:12px;">当前页：' + currentPageMd + '</p></div>';
      });
  }

  /** 加载标注说明MD到标注Tab（带缓存绕过） */
  function loadAnnoDoc() {
    fetch(getAnnoDescFileName() + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function(r) { if (!r.ok) throw new Error('404'); return r.text(); })
      .then(function(text) { rightBodyAnno.innerHTML = mdToHtml(text); })
      .catch(function() {
        rightBodyAnno.innerHTML = '<div class="_dm_empty"><p>暂无标注说明</p><p style="font-size:12px;">文件：' + getAnnoDescFileName() + '</p></div>';
      });
  }

  function mdToHtml(md) {
    var h = md;
    h = h.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    h = h.replace(/^### (.+)/gm, '<h3>$1</h3>');
    h = h.replace(/^## (.+)/gm, '<h2>$1</h2>');
    h = h.replace(/^# (.+)/gm, '<h1>$1</h1>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    var lines = h.split('\n'), result = [], inTable = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('|') === 0 && line.lastIndexOf('|') === line.length - 1) {
        if (line.indexOf('---') >= 0 || line.indexOf('--:') >= 0) continue;
        if (!inTable) { result.push('<table>'); inTable = true; }
        var cells = line.split('|').filter(function(c,i,a) { return i > 0 && i < a.length - 1; });
        result.push('<tr>' + cells.map(function(c) { return '<td>' + c.trim() + '</td>'; }).join('') + '</tr>');
      } else {
        if (inTable) { result.push('</table>'); inTable = false; }
        result.push(line);
      }
    }
    if (inTable) result.push('</table>');
    h = result.join('\n');
    h = h.replace(/^(?!<[ht]|<table|<\/table)(.+)/gm, '<p>$1</p>');
    h = h.replace(/<p>\s*<\/p>/g, '');
    return h;
  }

  /** 监听 iframe 内容变化（弹窗开闭），自动刷新标注显示 */
  function startContextWatcher(iframe) {
    try {
      var doc = iframe.contentDocument;
      if (!doc) return;
      // MutationObserver 监听属性/class 变化
      if (contextObserver) contextObserver.disconnect();
      contextObserver = new doc.defaultView.MutationObserver(function(mutations) {
        var needsRefresh = false;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
            var el = m.target;
            if (el && el.nodeType === 1) {
              var cls = el.className || '';
              // 检测 Tab 按钮、Tab 内容面板、弹窗/遮罩层的 class 变化
              if (/(^|\s)(config-tab|config-tab-content|tab|tab-item|tab-content|tab-pane|tab-btn|tab-panel)(\s|$)/.test(' ' + cls + ' ') ||
                  el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'tabpanel') {
                needsRefresh = true; break;
              }
              // 检测 overlay/modal 的 show/visible 状态切换
              if (/overlay|modal|dialog|popup/i.test(el.id || '') ||
                  (/(^|\s)(show|visible|open|active)(\s|$)/.test(' ' + cls + ' '))) {
                needsRefresh = true; break;
              }
              var cs = doc.defaultView.getComputedStyle(el);
              // 关注大尺寸容器（弹窗/覆盖层级别）的 display 变化
              if (parseInt(cs.width) > 200 || parseInt(cs.height) > 200) {
                needsRefresh = true; break;
              }
            }
          }
          // 子节点增删（弹窗插入/移除）
          if (m.type === 'childList') {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n.nodeType === 1) {
                needsRefresh = true; break;
              }
            }
            if (!needsRefresh) {
              for (var k = 0; k < m.removedNodes.length; k++) {
                var r = m.removedNodes[k];
                if (r.nodeType === 1) {
                  needsRefresh = true; break;
                }
              }
            }
          }
          if (needsRefresh) break;
        }
        if (needsRefresh && annotations.length > 0) {
          repositionAllBoxes();
        }
      });
      contextObserver.observe(doc.body, {
        attributes: true, attributeFilter: ['style', 'class'],
        childList: true, subtree: true
      });
    } catch(e) {}
  }

  // ═══════════════════════════════════════════════
  //  页面预览（iframe）
  //  ═══════════════════════════════════════════════
  function renderPagePreview() {
    var vp = document.getElementById('_dm_viewport');
    vp.innerHTML = '';
    var iframe = document.createElement('iframe');
    pageIframe = iframe;
    iframe.src = location.pathname + '?dm_nodoc=1';
    iframe.style.width = '100%';
    iframe.style.height = '100%';

    iframe.onload = function() {
      iframeReady = true;
      injectIframeCSS(iframe);
      try {
        iframe.contentDocument.addEventListener('click', function(ev) {
          if (isInside(ev.target, '._dm_box_del')) {
            var b = ev.target.closest ? ev.target.closest('._dm_box') : null;
            if (b) {
              var id = parseInt(b.getAttribute('data-id'));
              if (!isNaN(id)) deleteBox(id);
            }
          }
        });
      } catch(e) {}
      startContextWatcher(iframe);
      loadAnnotations(function(savedScrollY) {
        if (savedScrollY >= 0 && annotations.length > 0) {
          try { iframe.contentWindow.scrollTo(0, savedScrollY); } catch(e) {}
          reRenderAllBoxes();
          updateBadge();
        } else {
          annotations = [];
          annotateNextId = 1;
          updateBadge();
        }
      });
    };

    vp.appendChild(iframe);
  }

  function injectIframeCSS(iframe) {
    try {
      var doc = iframe.contentDocument;
      if (!doc) return;
      var style = doc.createElement('style');
      style.id = '_dm_iframe_styles';
      style.textContent = [
        '._dm_hover_highlight { position:absolute;pointer-events:none;',
        '  border:2px dashed #18A55D;background:rgba(24,165,93,0.08);',
        '  z-index:2147483643;transition:all .1s ease; }',
        '._dm_box { position:absolute;border:2px solid #f5a623;',
        '  background:rgba(245,166,35,.08);z-index:2147483645;pointer-events:auto; }',
        '._dm_editable ._dm_box { cursor:move; }',
        '._dm_box_handle { display:none;position:absolute;width:8px;height:8px;',
        '  background:#f5a623;border-radius:50%;z-index:2147483646; }',
        '._dm_editable ._dm_box_handle { display:block; }',
        '._dm_box_handle.n { top:-5px;left:50%;margin-left:-4px;cursor:n-resize; }',
        '._dm_box_handle.s { bottom:-5px;left:50%;margin-left:-4px;cursor:s-resize; }',
        '._dm_box_handle.w { left:-5px;top:50%;margin-top:-4px;cursor:w-resize; }',
        '._dm_box_handle.e { right:-5px;top:50%;margin-top:-4px;cursor:e-resize; }',
        '._dm_box_handle.nw { top:-5px;left:-5px;cursor:nw-resize; }',
        '._dm_box_handle.ne { top:-5px;right:-5px;cursor:ne-resize; }',
        '._dm_box_handle.sw { bottom:-5px;left:-5px;cursor:sw-resize; }',
        '._dm_box_handle.se { bottom:-5px;right:-5px;cursor:se-resize; }',
        /* 左上角：方形编号 + 说明标签合并 */
        '._dm_box_header { position:absolute;top:-14px;left:-14px;',
        '  display:flex;align-items:center;gap:3px;z-index:2147483647;',
        '  user-select:none; }',
        '._dm_box_num { min-width:20px;height:22px;padding:0 5px;border-radius:4px;',
        '  background:#f5a623;color:#fff;font-size:12px;font-weight:bold;',
        '  display:flex;align-items:center;justify-content:center;',
        '  box-shadow:0 2px 6px rgba(245,166,35,.4);',
        '  transition:transform .15s; }',
        '._dm_editable ._dm_box_num { cursor:pointer; }',
        '._dm_box_desc { display:none;height:22px;padding:0 5px;border-radius:4px;',
        '  background:#e8a030;color:#fff;font-size:11px;font-weight:bold;',
        '  align-items:center;justify-content:center;line-height:1;',
        '  box-shadow:0 2px 6px rgba(245,166,35,.4); }',
        '._dm_box.has_desc ._dm_box_desc { display:flex; }',
        '._dm_editable ._dm_box_desc { display:none !important; }',
        /* tooltip：JS动态定位，默认隐藏 */
        '._dm_desc_tip { display:none;position:absolute;',
        '  background:#333;color:#fff;padding:8px 12px;border-radius:4px;',
        '  font-size:12px;line-height:1.6;min-width:120px;max-width:280px;',
        '  word-break:break-word;white-space:pre-wrap;',
        '  z-index:9999;pointer-events:none;',
        '  box-shadow:0 2px 8px rgba(0,0,0,.25); }',
        '._dm_desc_tip._dm_tip_show { display:block; }',
        '._dm_editable ._dm_desc_tip { display:none !important; }',
        '._dm_desc_tip_arrow { position:absolute;width:0;height:0;',
        '  border:6px solid transparent; }',
        '._dm_desc_tip._dm_tip_above ._dm_desc_tip_arrow { top:100%;margin-top:-1px;border-top-color:#333; }',
        '._dm_desc_tip._dm_tip_below ._dm_desc_tip_arrow { bottom:100%;margin-bottom:-1px;border-bottom-color:#333; }',
        '._dm_box_del { display:none;position:absolute;top:-14px;right:-14px;',
        '  width:24px;height:24px;border-radius:50%;background:#ff4d4f;',
        '  color:#fff;font-size:16px;font-weight:bold;line-height:1;',
        '  align-items:center;justify-content:center;',
        '  box-shadow:0 2px 8px rgba(255,77,79,.4);z-index:2147483648;',
        '  cursor:pointer;transition:transform .15s;',
        '  user-select:none; }',
        '._dm_editable ._dm_box_del { display:flex; }',
        '._dm_box_del:hover { transform:scale(1.3); }',
        '@keyframes _dm_box_pop { 0%{transform:scale(.9);opacity:0}100%{transform:scale(1);opacity:1} }',
      ].join('\n');
      doc.head.appendChild(style);
    } catch(e) {}
  }

  // ═══════════════════════════════════════════════
  //  标注模式（hover 高亮 + 点击创建框 + 拖动/拉伸扩大）
  //  ═══════════════════════════════════════════════
  var annotateMode = false;

  /** 找到鼠标下「可标注」的元素（向上走到有意义的容器） */
  function findHoverTarget(doc, cx, vpY) {
    // 先检查鼠标是否在已有标注框内 → 直接跳过，避免 elementFromPoint 找框
    var boxes = doc.querySelectorAll('._dm_box');
    for (var i = 0; i < boxes.length; i++) {
      var bRect = boxes[i].getBoundingClientRect();
      if (cx >= bRect.left && cx <= bRect.right && vpY >= bRect.top && vpY <= bRect.bottom) {
        return null;
      }
    }

    // 只隐藏 hover 高亮（不隐藏标注框，防止闪烁），然后找元素
    var hoverEl = doc.querySelector('._dm_hover_highlight');
    var hoverWasVis = false;
    if (hoverEl && hoverEl.style.display !== 'none') { hoverWasVis = true; hoverEl.style.display = 'none'; }

    var el = doc.elementFromPoint(cx, vpY);

    if (hoverEl && hoverWasVis) { hoverEl.style.display = ''; }

    if (!el || el === doc.body || el === doc.documentElement) return null;

    // 跳过已有标注框内的子元素
    if (el.closest('._dm_box')) return null;

    // 向上找到有意义的容器（TD/TH/TR/LI/DIV/SECTION/TABLE/BUTTON/A/SPAN/P...）
    var meaningfulTags = {
      TD:1, TH:1, TR:1, LI:1,
      SECTION:1, TABLE:1, FORM:1, ARTICLE:1, MAIN:1, NAV:1, ASIDE:1, HEADER:1, FOOTER:1, DIV:1,
      BUTTON:1, A:1, INPUT:1, SELECT:1, TEXTAREA:1, SPAN:1, P:1, LABEL:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1
    };
    var candidate = el;
    while (candidate && candidate !== doc.body && candidate !== doc.documentElement) {
      if (candidate.id && !candidate.id.startsWith('_dm_')) break;
      if (candidate.tagName in meaningfulTags) {
        if (candidate.tagName === 'DIV') {
          if (candidate.className && typeof candidate.className === 'string') {
            var cls = candidate.className.trim().split(/\s+/).filter(function(c) { return c && !c.startsWith('_dm_'); });
            if (cls.length >= 1) break;
          }
        } else {
          break;
        }
      }
      candidate = candidate.parentElement;
    }
    return (candidate && candidate !== doc.body && candidate !== doc.documentElement) ? candidate : null;
  }

  /** 隐藏 hover 高亮（不删 DOM，避免回流导致已有标注框闪烁） */
  function hideHoverHighlight() {
    if (hoverHighlightEl) {
      hoverHighlightEl.style.display = 'none';
    }
    hoverElement = null;
  }

  /** 移除 hover 高亮 DOM（退出编辑/文档模式时彻底清理） */
  function removeHoverHighlight() {
    if (hoverHighlightEl && hoverHighlightEl.parentNode) {
      hoverHighlightEl.parentNode.removeChild(hoverHighlightEl);
    }
    hoverHighlightEl = null;
    hoverElement = null;
  }

  /** 显示 hover 高亮（原地更新样式，不删除重建） */
  function showHoverHighlight(el) {
    if (!pageIframe || !pageIframe.contentDocument || !pageIframe.contentWindow) return;
    var doc = pageIframe.contentDocument;
    if (!el || el === doc.body || el === doc.documentElement) { hideHoverHighlight(); return; }
    if (el === hoverElement) return;

    var scrollY = pageIframe.contentWindow.scrollY || 0;
    var rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) { hideHoverHighlight(); return; }

    if (!hoverHighlightEl) {
      hoverHighlightEl = doc.createElement('div');
      hoverHighlightEl.className = '_dm_hover_highlight';
      doc.body.appendChild(hoverHighlightEl);
    }

    // 原地更新样式（不删除重建，不触发 DOM 回流）
    hoverHighlightEl.style.cssText =
      'display:block;position:absolute;pointer-events:none;z-index:2147483643;' +
      'border:2px dashed #18A55D;background:rgba(24,165,93,0.08);' +
      'left:' + rect.left + 'px;top:' + (rect.top + scrollY) + 'px;' +
      'width:' + rect.width + 'px;height:' + rect.height + 'px;';
    hoverElement = el;
    doc.body.style.cursor = 'pointer';
  }

  /** 安全检测 target 是否在指定选择器下 */
  function isInside(el, selector) {
    return el && typeof el.closest === 'function' && el.closest(selector);
  }

  var _hoverPending = false;

  /** mousemove：检测鼠标下的元素，显示高亮（不删 DOM 防闪烁） */
  function onHoverElement(e) {
    if (!pageIframe || !pageIframe.contentWindow || _hoverPending) return;
    var doc = pageIframe.contentDocument;
    if (!doc) return;

    // 鼠标在已有标注框上 → 隐藏高亮（只 display:none，不删 DOM）
    if (isInside(e.target, '._dm_box')) { hideHoverHighlight(); return; }

    _hoverPending = true;
    var clientX = e.clientX, clientY = e.clientY;
    requestAnimationFrame(function() {
      _hoverPending = false;
      if (!pageIframe || !pageIframe.contentDocument) return;
      var target = findHoverTarget(doc, clientX, clientY);
      if (target) {
        showHoverHighlight(target);
      } else {
        hideHoverHighlight();
        if (doc.body) doc.body.style.cursor = 'crosshair';
      }
    });
  }

  /** 自动识别元素所处容器（页面 / 弹窗 + Tab） */
  function getElementContext(el, doc) {
    var containerId = 'main';
    var tabId = '';

    // 1. 找容器（弹窗/覆盖层）
    var candidate = el;
    while (candidate && candidate !== doc.body && candidate !== doc.documentElement) {
      if (candidate !== el && candidate.nodeType === 1) {
        var cs = doc.defaultView.getComputedStyle(candidate);
        if (cs.position === 'fixed' || cs.position === 'absolute') {
          var w = parseInt(cs.width), h = parseInt(cs.height);
          if (w > 200 && h > 200 && cs.display !== 'none') {
            containerId = candidate.id || candidate.className.split(' ')[0];
          }
        }
        var id = candidate.id || '';
        if (/overlay|modal|popup|dialog/i.test(id)) containerId = id;
      }
      candidate = candidate.parentElement;
    }

    // 1.5 如果没有弹窗容器，检测元素是否在可切换视图内（如 boundView/unboundView）
    //     这类视图通过 JS 设置 display:none/block 切换，需要独立 context
    if (containerId === 'main') {
      candidate = el;
      while (candidate && candidate !== doc.body && candidate !== doc.documentElement) {
        if (candidate.id && candidate !== el && candidate.nodeType === 1) {
          // 如果该祖先有 style.display 属性（inline），说明它是 JS 可切换的视图容器
          // 或者它内部的兄弟视图显式设置了 display:none（如 boundView 初始隐藏）
          if (candidate.style.display === 'none' || candidate.style.display === 'block' || candidate.style.display === '') {
            var cs2 = doc.defaultView.getComputedStyle(candidate);
            if (parseInt(cs2.width) > 100 || parseInt(cs2.height) > 100) {
              containerId = candidate.id;
              break;
            }
          }
        }
        candidate = candidate.parentElement;
      }
    }

    // 2. 从文档根查找 active Tab（Tab 栏在 config-tabs 中，不是标注元素的祖先）
    if (containerId !== 'main') {
      var activeTab = doc.querySelector('.config-tab.active, .tab.active');
      if (!activeTab) {
        activeTab = doc.querySelector('[role=\"tab\"][aria-selected=\"true\"]');
      }
      if (activeTab) {
        tabId = activeTab.getAttribute('data-tab') || activeTab.textContent.trim().replace(/\s+/g, '').substring(0, 10);
      }
    }

    return tabId ? containerId + '|' + tabId : containerId;
  }

  /** 计算元素所有可滚动祖先的累计滚动偏移 */
  function getScrollOffset(el, doc) {
    var offsetX = 0, offsetY = 0;
    var current = el.parentElement;
    while (current && current !== doc.body && current !== doc.documentElement) {
      if (current.scrollTop || current.scrollLeft) {
        // 检查是否可滚动
        var cs = doc.defaultView.getComputedStyle(current);
        if (cs.overflow === 'auto' || cs.overflow === 'scroll' || cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
          offsetY -= current.scrollTop;
          offsetX -= current.scrollLeft;
        }
      }
      current = current.parentElement;
    }
    return { x: offsetX, y: offsetY };
  }

  /** capture 阶段：拦截页面交互 + 创建标注框 */
  function onCaptureClick(e) {
    if (!annotateMode) return;
    // 放行标注框自身操作（拖拽/删除/改名）
    if (isInside(e.target, '._dm_box')) return;

    // 拦截页面交互
    e.stopPropagation();
    e.preventDefault();

    if (!pageIframe || !pageIframe.contentDocument || !pageIframe.contentWindow) return;
    var doc = pageIframe.contentDocument;
    var win = pageIframe.contentWindow;
    var scrollY = win.scrollY || 0;

    // 直接用 elementFromPoint 获取点击位置元素（不依赖异步 hoverElement）
    var target = findHoverTarget(doc, e.clientX, e.clientY);

    if (!target) return;
    var rect = target.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;

    var x = rect.left;
    var y = rect.top + scrollY;
    var w = rect.width;
    var h = rect.height;

    var ctx = getElementContext(target, doc);
    var a = { id: annotateNextId, x: x, y: y, w: w, h: h, context: ctx };
    setAnchorOnAnnotation(a, x, y, w, h);

    // 防重复：同一元素（相同 XPath）只能标注一次
    var isDuplicate = false;
    for (var di = 0; di < annotations.length; di++) {
      if (annotations[di].xpath === a.xpath) { isDuplicate = true; break; }
    }
    if (isDuplicate) { hideHoverHighlight(); return; }

    annotations.push(a);
    annotateNextId++;
    renderBox(a);
    updateBadge();
    saveAnnotations();

    hideHoverHighlight();
    // 更新 hoverElement 保持高亮同步
    hoverElement = target;
  }

  /** 动态计算 tooltip 位置：根据 iframe viewport 自动选择最佳展示位置 */
  function positionTooltip(box, tip) {
    if (!pageIframe || !pageIframe.contentWindow) return;
    var win = pageIframe.contentWindow;
    var vw = win.innerWidth;
    var vh = win.innerHeight;
    var boxRect = box.getBoundingClientRect();

    // 移除旧状态
    tip.classList.remove('_dm_tip_above', '_dm_tip_below');
    tip.style.left = '';
    tip.style.top = '';
    tip.style.maxWidth = '';
    tip.style.display = 'block';
    tip.style.visibility = 'hidden'; // 先隐藏测尺寸

    // 测量 tip 尺寸
    var tipW = tip.offsetWidth || 200;
    var tipH = tip.offsetHeight || 50;

    // 约束最大宽度（视口内留 20px 边距）
    var maxW = Math.min(280, vw - 20);
    tip.style.maxWidth = maxW + 'px';
    // 重新测量（max-width 可能影响换行后的宽度和高度）
    tipW = Math.min(tip.offsetWidth || tipW, maxW);
    tipH = tip.offsetHeight || tipH;

    // 水平定位：优先居中，超出则靠边
    var tipLeft = (boxRect.width - tipW) / 2;
    var boxLeftRel = boxRect.left;
    var overflowLeft = -(boxLeftRel + tipLeft);
    var overflowRight = (boxLeftRel + tipLeft + tipW) - vw;
    if (overflowLeft > 0) { tipLeft = -boxLeftRel + 8; }
    else if (overflowRight > 0) { tipLeft = boxRect.width - tipW - overflowRight + 8; }

    // 垂直定位：优先上方，空间不够则下方
    var gap = 10;
    var aboveSpace = boxRect.top - gap;
    var belowSpace = vh - boxRect.bottom - gap;

    if (aboveSpace >= tipH + 6 || aboveSpace >= belowSpace) {
      // 显示在上方
      tip.style.top = -(tipH + gap) + 'px';
      tip.classList.add('_dm_tip_above');
    } else {
      // 显示在下方
      tip.style.top = (boxRect.height + gap) + 'px';
      tip.classList.add('_dm_tip_below');
    }

    // 箭头水平位置：指向框中心
    var arrow = tip.querySelector('._dm_desc_tip_arrow');
    if (arrow) {
      var arrowX = Math.max(6, Math.min(tipW - 12, tipW / 2 - tipLeft));
      arrow.style.left = arrowX + 'px';
    }

    tip.style.left = tipLeft + 'px';
    tip.style.visibility = '';
  }

  /** 隐藏 tooltip */
  function hideTooltip(tip) {
    if (!tip) return;
    tip.classList.remove('_dm_tip_show', '_dm_tip_above', '_dm_tip_below');
    tip.style.display = 'none';
  }

  /** 检查标注所属 context 容器是否当前可见 */
  /** 从 context 字符串提取容器名（去掉 |tab 后缀） */
  function getContainerId(ctx) {
    if (!ctx || ctx === 'main') return 'main';
    return ctx.split('|')[0]; // 'configOverlay|tab1' → 'configOverlay'
  }

  /** 从 context 字符串提取 Tab 标识 */
  function getTabId(ctx) {
    if (!ctx) return '';
    var parts = ctx.split('|');
    return parts.length > 1 ? parts[1] : '';
  }

  /** 在 iframe 中查找容器元素 */
  function findContainer(containerId) {
    if (!pageIframe || !pageIframe.contentDocument) return null;
    var doc = pageIframe.contentDocument;
    var container = doc.getElementById(containerId);
    if (!container) {
      try { container = doc.querySelector('.' + containerId); } catch(e) {}
    }
    return container;
  }

  /** 获取容器内当前激活的 Tab ID（data-tab 或截取文本前10字） */
  function getActiveTabId(container, doc) {
    if (!container || !doc) return '';
    // 容器内 → 父级 → 文档级搜索活跃 Tab
    var activeTab = container.querySelector('.config-tab.active, .tab.active, [role="tab"][aria-selected="true"]');
    if (!activeTab && container.parentElement) {
      activeTab = container.parentElement.querySelector('.config-tab.active, .tab.active, [role="tab"][aria-selected="true"]');
    }
    if (!activeTab) {
      activeTab = doc.querySelector('.config-tab.active, .tab.active, [role="tab"][aria-selected="true"]');
    }
    if (!activeTab) return '';
    return activeTab.getAttribute('data-tab') || activeTab.textContent.trim().replace(/\s+/g, '').substring(0, 10);
  }

  /** 标注是否应该显示：
   *  1. main 永远显示
   *  2. 容器不可见 → 隐藏
   *  3. 有Tab上下文但Tab不匹配 → 隐藏
   *  4. 锚点元素或其祖先不可见 → 隐藏（防止跨Tab显示） */
  function shouldShowAnnotation(a) {
    if (!a.context) a.context = 'main';
    if (a.context === 'main') return true;
    if (!pageIframe || !pageIframe.contentDocument) return false;
    var doc = pageIframe.contentDocument;

    var containerId = getContainerId(a.context);
    var tabId = getTabId(a.context);

    // 1. 容器可见性
    var container = findContainer(containerId);
    if (!container) return false;
    var cs = doc.defaultView.getComputedStyle(container);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;

    // 2. Tab 匹配检查
    if (tabId) {
      var currentTabId = getActiveTabId(container, doc);
      if (currentTabId && currentTabId !== tabId) return false;
    }

    // 3. 锚点元素自身可见性检查（不检查祖先，XPath可能匹配到其他Tab中的同名元素）
    if (a.xpath) {
      var anchorEl = queryByAnchor(a, doc);
      if (anchorEl) {
        var elCs = doc.defaultView.getComputedStyle(anchorEl);
        if (elCs.display === 'none' || elCs.visibility === 'hidden') return false;
      }
      // anchorEl 为 null 时也返回 true，用百分比兜底
    }

    return true;
  }

  function renderBox(a) {
    if (!pageIframe || !pageIframe.contentDocument) return null;
    // 确保有百分比数据（兜底）+ 向后兼容 context
    ensurePct(a);
    if (!a.context) a.context = 'main';

    var visible = shouldShowAnnotation(a);
    var pos = visible ? getBoxPosFromAnchor(a) : { x: 0, y: 0, w: 0, h: 0 };

    var body = pageIframe.contentDocument.body;
    var box = document.createElement('div');
    box.className = '_dm_box';
    box.id = '_dm_box_' + a.id;
    box.setAttribute('data-id', a.id);
    box.setAttribute('data-context', a.context);
    // 内联动画（只播一次，不会因父元素类变更重播）
    box.style.animation = '_dm_box_pop .25s ease';
    // context 不匹配 → 隐藏标注框（返回 null 防止外层覆盖位置数据）
    if (!visible) {
      box.style.display = 'none';
      box.style.left = '0'; box.style.top = '0'; box.style.width = '0'; box.style.height = '0';
    } else {
      box.style.left = pos.x + 'px';
      box.style.top = pos.y + 'px';
      box.style.width = pos.w + 'px';
      box.style.height = pos.h + 'px';
    }

    // 左上角 header：方形编号 + 说明标签
    var header = document.createElement('div');
    header.className = '_dm_box_header';

    var num = document.createElement('div');
    num.className = '_dm_box_num';
    num.textContent = a.id;
    num.title = '编辑模式下点击可改编号';
    num.addEventListener('click', function(e) {
      if (!annotateMode) return;
      e.stopPropagation();
      e.preventDefault();
      changeAnnoId(a.id);
    });
    header.appendChild(num);

    // 如果有说明文字，添加"说明"标签 + tooltip + 箭头
    var tip = null;
    if (annoDescriptions[a.id]) {
      box.classList.add('has_desc');
      var desc = document.createElement('div');
      desc.className = '_dm_box_desc';
      desc.textContent = '说明';
      header.appendChild(desc);
      tip = document.createElement('div');
      tip.className = '_dm_desc_tip';
      tip.textContent = annoDescriptions[a.id];
      var arrow = document.createElement('div');
      arrow.className = '_dm_desc_tip_arrow';
      tip.appendChild(arrow);
      header.appendChild(tip);
    }
    box.appendChild(header);

    // 删除按钮（编辑模式可见）
    var delBtn = document.createElement('div');
    delBtn.className = '_dm_box_del';
    delBtn.textContent = '\u00D7';  // ×
    box.appendChild(delBtn);

    var dirs = ['n','s','w','e','nw','ne','sw','se'];
    dirs.forEach(function(dir) {
      var h = document.createElement('div');
      h.className = '_dm_box_handle ' + dir;
      h.setAttribute('data-dir', dir);
      box.appendChild(h);
    });

    // hover 事件：动态定位 tooltip
    (function(t) {
      if (!t) return;
      box.addEventListener('mouseenter', function() {
        if (annotateMode) return;
        positionTooltip(box, t);
        t.classList.add('_dm_tip_show');
      });
      box.addEventListener('mouseleave', function() {
        hideTooltip(t);
      });
    })(tip);

    box.addEventListener('mousedown', function(e) {
      if (isInside(e.target, '._dm_box_desc')) return;
      if (isInside(e.target, '._dm_box_del')) return;
      if (e.target && e.target.classList && e.target.classList.contains('_dm_box_num')) return;
      if (e.target && e.target.classList && e.target.classList.contains('_dm_box_handle')) return;
      startDragBox(e, a.id);
    });

    // 非编辑模式下点击穿透：转发 click 到下层元素
    box.addEventListener('click', function(e) {
      if (annotateMode) return;
      var doc = pageIframe.contentDocument;
      if (!doc) return;
      box.style.pointerEvents = 'none';
      var behind = doc.elementFromPoint(e.clientX, e.clientY);
      box.style.pointerEvents = 'auto';
      if (behind && behind !== box && !behind.closest('._dm_box')) {
        behind.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
      }
    });

    body.appendChild(box);
    return visible ? pos : null; // 隐藏时返回 null，防止外层覆盖标注位置数据
  }

  // ═══ 拖动标注框 ═══
  function startDragBox(e, id) {
    if (e.button !== 0) return;
    var box = iframeGetEl('_dm_box_' + id);
    if (!box) return;
    draggingBox = id;
    dragStartMouseX = e.clientX;
    dragStartMouseY = e.clientY;
    dragStartBoxX = parseInt(box.style.left);
    dragStartBoxY = parseInt(box.style.top);
    iframeAddEvent('mousemove', onDragMove);
    iframeAddEvent('mouseup', onDragEnd);
    e.preventDefault();
  }

  function onDragMove(e) {
    if (draggingBox === null) return;
    var dx = e.clientX - dragStartMouseX;
    var dy = e.clientY - dragStartMouseY;
    var box = iframeGetEl('_dm_box_' + draggingBox);
    if (box) {
      box.style.left = (dragStartBoxX + dx) + 'px';
      box.style.top  = (dragStartBoxY + dy) + 'px';
    }
  }

  function onDragEnd() {
    if (draggingBox === null) return;
    var box = iframeGetEl('_dm_box_' + draggingBox);
    if (box) {
      var idx = findAnnoIndex(draggingBox);
      if (idx >= 0) {
        var nx = parseInt(box.style.left);
        var ny = parseInt(box.style.top);
        annotations[idx].x = nx;
        annotations[idx].y = ny;
        updateAnchorOffsetForAnnotation(annotations[idx], nx, ny);
        updatePct(annotations[idx]);
        saveAnnotations();
      }
    }
    draggingBox = null;
    iframeRemoveEvent('mousemove', onDragMove);
    iframeRemoveEvent('mouseup', onDragEnd);
  }

  // ═══ 调整大小 ═══
  function startResizeBox(e, id, dir) {
    if (e.button !== 0) return;
    resizingBox = id;
    resizeDirection = dir;
    var box = iframeGetEl('_dm_box_' + id);
    if (!box) return;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartBX = parseInt(box.style.left);
    resizeStartBY = parseInt(box.style.top);
    resizeStartW  = parseInt(box.style.width);
    resizeStartH  = parseInt(box.style.height);
    iframeAddEvent('mousemove', onResizeMove);
    iframeAddEvent('mouseup', onResizeEnd);
    e.stopPropagation();
    e.preventDefault();
  }

  function onResizeMove(e) {
    if (resizingBox === null) return;
    var dx = e.clientX - resizeStartX;
    var dy = e.clientY - resizeStartY;
    var box = iframeGetEl('_dm_box_' + resizingBox);
    if (!box) return;
    var nl = resizeStartBX, nt = resizeStartBY, nw = resizeStartW, nh = resizeStartH;
    if (resizeDirection.indexOf('e') >= 0) nw = Math.max(20, resizeStartW + dx);
    if (resizeDirection.indexOf('s') >= 0) nh = Math.max(20, resizeStartH + dy);
    if (resizeDirection.indexOf('w') >= 0) { nw = Math.max(20, resizeStartW - dx); nl = resizeStartBX + dx; }
    if (resizeDirection.indexOf('n') >= 0) { nh = Math.max(20, resizeStartH - dy); nt = resizeStartBY + dy; }
    box.style.left   = nl + 'px';
    box.style.top    = nt + 'px';
    box.style.width  = nw + 'px';
    box.style.height = nh + 'px';
  }

  function onResizeEnd() {
    if (resizingBox === null) return;
    var box = iframeGetEl('_dm_box_' + resizingBox);
    if (box) {
      var idx = findAnnoIndex(resizingBox);
      if (idx >= 0) {
        var nx = parseInt(box.style.left);
        var ny = parseInt(box.style.top);
        var nw = parseInt(box.style.width);
        var nh = parseInt(box.style.height);
        annotations[idx].x = nx;
        annotations[idx].y = ny;
        annotations[idx].w = nw;
        annotations[idx].h = nh;
        updateAnchorOffsetForAnnotation(annotations[idx], nx, ny, nw, nh);
        updatePct(annotations[idx]);
        saveAnnotations();
      }
    }
    resizingBox = null;
    iframeRemoveEvent('mousemove', onResizeMove);
    iframeRemoveEvent('mouseup', onResizeEnd);
  }

  function findAnnoIndex(id) {
    for (var i = 0; i < annotations.length; i++) {
      if (annotations[i].id === id) return i;
    }
    return -1;
  }

  /** 自定义弹窗（替代原生 prompt，兼容 webview 沙箱） */
  function showPromptDialog(title, defaultVal, callback) {
    // 在 iframe 内创建 HTML 弹窗，支持 Enter/Escape/点击遮罩关闭
    // ... (完整实现见 doc-mode.js)
  }

  /** 为标注分配内部唯一标识（不随编号修改变化） */
  function assignUid(a) {
    if (a._uid) {
      var n = parseInt(a._uid.slice(1));
      if (!isNaN(n) && n > _dm_uid_counter) _dm_uid_counter = n;
    } else {
      _dm_uid_counter++;
      a._uid = 'u' + _dm_uid_counter;
    }
  }

  /** 获取当前最大显示编号 */
  function getMaxDisplayId() {
    var max = 0;
    annotations.forEach(function(a) { if (a.id > max) max = a.id; });
    return max;
  }

  /** 编辑模式下点击编号 → 修改显示编号（不影响其他标注） */
  function changeAnnoId(uid) {
    var target = null;
    for (var i = 0; i < annotations.length; i++) {
      if (annotations[i]._uid === uid) { target = annotations[i]; break; }
    }
    if (!target) return;
    showPromptDialog('修改编号', target.id, function(newIdStr) {
      if (!newIdStr) return;
      var newId = parseInt(newIdStr);
      if (isNaN(newId) || newId < 1) return;
      target.id = newId;
      annotateNextId = getMaxDisplayId() + 1;
      saveAnnotations();
      reRenderAllBoxes();
    });
  }

  function deleteBox(uid) {
    // 只删除指定 _uid 的那一个标注，不影响其他编号
    annotations = annotations.filter(function(a) { return a._uid !== uid; });
    annotateNextId = getMaxDisplayId() + 1;
    reRenderAllBoxes();
    updateBadge();
    saveAnnotations();
    if (annotations.length === 0) clearSavedAnnotations();
  }

  /** 刷新所有标注框上的说明图标 */
  function reRenderDescriptions() {
    if (!pageIframe || !pageIframe.contentDocument) return;
    var boxes = pageIframe.contentDocument.querySelectorAll('._dm_box');
    boxes.forEach(function(box) {
      var id = parseInt(box.getAttribute('data-id'));
      var header = box.querySelector('._dm_box_header');
      // 移除旧说明标签和 tip
      var oldDesc = header ? header.querySelector('._dm_box_desc') : null;
      var oldTip = header ? header.querySelector('._dm_desc_tip') : null;
      if (oldDesc) oldDesc.parentNode.removeChild(oldDesc);
      if (oldTip) oldTip.parentNode.removeChild(oldTip);
      box.classList.remove('has_desc');

      if (!header || isNaN(id) || !annoDescriptions[id]) return;

      // 添加说明标签 + tooltip + 箭头 + 事件
      box.classList.add('has_desc');
      var desc = document.createElement('div');
      desc.className = '_dm_box_desc';
      desc.textContent = '说明';
      header.appendChild(desc);
      var tip = document.createElement('div');
      tip.className = '_dm_desc_tip';
      tip.textContent = annoDescriptions[id];
      var arrow = document.createElement('div');
      arrow.className = '_dm_desc_tip_arrow';
      tip.appendChild(arrow);
      header.appendChild(tip);

      // 绑定 hover 事件（动态定位 tooltip）
      (function(t) {
        if (!t) return;
        var enterFn = function() {
          if (annotateMode) return;
          positionTooltip(box, t);
          t.classList.add('_dm_tip_show');
        };
        var leaveFn = function() { hideTooltip(t); };
        // 先清除旧事件（通过克隆节点方式）
        box.removeEventListener('mouseenter', enterFn);
        box.removeEventListener('mouseleave', leaveFn);
        box.addEventListener('mouseenter', enterFn);
        box.addEventListener('mouseleave', leaveFn);
      })(tip);
    });
  }

  function reRenderAllBoxes() {
    if (!pageIframe || !pageIframe.contentDocument) return;
    var body = pageIframe.contentDocument.body;
    var boxes = body.querySelectorAll('._dm_box');
    for (var i = 0; i < boxes.length; i++) boxes[i].parentNode.removeChild(boxes[i]);

    annotateNextId = 1;
    annotations.forEach(function(a) {
      a.id = annotateNextId;
      annotateNextId++;
      var pos = renderBox(a);
      // 同步更新像素值（百分比保持不变）
      if (pos) {
        a.x = pos.x;
        a.y = pos.y;
        a.w = pos.w;
        a.h = pos.h;
      }
    });
    bindResizeHandlers();
  }

  function bindResizeHandlers() {
    if (!pageIframe || !pageIframe.contentDocument) return;
    var body = pageIframe.contentDocument.body;
    if (body._resizeBound) return;
    body.addEventListener('mousedown', function(e) {
      var handle = e.target && typeof e.target.closest === 'function' ? e.target.closest('._dm_box_handle') : null;
      if (!handle) return;
      var box = handle.closest('._dm_box');
      if (!box) return;
      var id = parseInt(box.getAttribute('data-id'));
      var dir = handle.getAttribute('data-dir');
      startResizeBox(e, id, dir);
    });
    body._resizeBound = true;
  }

  function updateBadge() {
    // 不显示角标数字
  }

  // ═══════════════════════════════════════════════
  //  窗口 resize → 重新渲染标注框（适配不同分辨率）
  //  ═══════════════════════════════════════════════
  var _resizeTimer = null;
  /** 只更新已有标注框位置（不删 DOM，编辑模式下安全） */
  function repositionAllBoxes() {
    if (!pageIframe || !pageIframe.contentDocument) return;
    // 拖动/缩放时跳过自动重定位，避免与用户操作冲突
    if (draggingBox !== null || resizingBox !== null) return;
    annotations.forEach(function(a) {
      ensurePct(a);
      if (!a.context) a.context = 'main';
      var box = pageIframe.contentDocument.getElementById('_dm_box_' + a.id);
      if (box) {
        var pos = getBoxPosFromAnchor(a);
        var visible = shouldShowAnnotation(a);
        if (!visible) {
          box.style.display = 'none';
        } else {
          box.style.display = '';
          box.style.left = pos.x + 'px';
          box.style.top = pos.y + 'px';
          box.style.width = pos.w + 'px';
          box.style.height = pos.h + 'px';
        }
      }
    });
  }

  window.addEventListener('resize', function() {
    if (MODE !== 'doc') return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function() {
      if (pageIframe && iframeReady && annotations.length > 0) {
        if (annotateMode) {
          repositionAllBoxes(); // 编辑模式：只更新位置，不删 DOM
        } else {
          reRenderAllBoxes();   // 浏览模式：完整重建
        }
      }
    }, 200);
  });

  // ═══════════════════════════════════════════════
  //  初始化
  //  ═══════════════════════════════════════════════
  injectCSS();
  createDOM();

})();

